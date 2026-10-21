#!/usr/bin/env python3
"""Build a small exterior preview from public EPT lidar and a reviewed footprint.

Offline preprocessing only. Browser users receive the resulting GLB, never a
whole survey. This is an original implementation; no 3D_houses code is included.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path
from urllib.request import urlopen

import laspy
import numpy as np
from pyproj import Transformer
from scipy.spatial import Delaunay, cKDTree
from shapely.geometry import Polygon, Point, shape
from shapely import transform
import trimesh


def node_intersects(key, bounds, clip):
    depth, x, y, z = map(int, key.split("-"))
    size = (np.asarray(bounds[3:]) - bounds[:3]) / 2**depth
    low = np.asarray(bounds[:3]) + np.asarray([x, y, z]) * size
    return bool(np.all(low <= clip[3:]) and np.all(low + size >= clip[:3]))


def fetch_points(base, lon, lat, radius, cache):
    # This prototype supports USGS's public Web Mercator / LASzip EPT layout.
    if not base.startswith("https://usgs-lidar-public.s3.amazonaws.com/") or not base.endswith("/"):
        raise ValueError("Use a public USGS EPT collection URL ending in /.")
    cache = cache / hashlib.sha256(base.encode()).hexdigest()[:16]
    cache.mkdir(parents=True, exist_ok=True)

    def get(name):
        path = cache / name.replace("/", "_")
        if not path.exists():
            with urlopen(base + name, timeout=35) as response:
                data = response.read(25_000_001)
            if len(data) > 25_000_000:
                raise ValueError("EPT node exceeds the prototype download limit.")
            path.write_bytes(data)
        return path.read_bytes()

    meta = json.loads(get("ept.json"))
    if meta["dataType"] != "laszip" or meta.get("hierarchyType", "json") != "json" or str(meta["srs"].get("horizontal")) != "3857":
        raise ValueError("Expected JSON hierarchy, LASzip nodes and EPSG:3857.")
    cx, cy = Transformer.from_crs(4326, 3857, always_xy=True).transform(lon, lat)
    r = radius / np.cos(np.radians(lat))
    conforming = meta["boundsConforming"]
    clip = np.array([cx-r, cy-r, conforming[2], cx+r, cy+r, conforming[5]])
    if not (conforming[0] <= cx <= conforming[3] and conforming[1] <= cy <= conforming[4]):
        raise ValueError("The chosen collection does not cover this property.")
    pending, seen, nodes = ["0-0-0-0"], set(), {}
    while pending:
        key = pending.pop()
        if key in seen:
            continue
        seen.add(key)
        for child, count in json.loads(get("ept-hierarchy/" + key + ".json")).items():
            if not node_intersects(child, meta["bounds"], clip):
                continue
            if count == -1:
                pending.append(child)
            elif count > 0:
                nodes[child] = count
        if len(nodes) > 160 or len(seen) > 40:
            raise ValueError("Query exceeds the small-property prototype limit.")

    def read(key):
        las = laspy.read(io.BytesIO(get("ept-data/" + key + ".laz")))
        xyz = np.column_stack((las.x, las.y, las.z))
        keep = np.all(xyz >= clip[:3], axis=1) & np.all(xyz <= clip[3:], axis=1)
        keep &= ~np.asarray(las.withheld, dtype=bool)
        return np.column_stack((xyz[keep], np.asarray(las.classification)[keep]))

    with ThreadPoolExecutor(max_workers=6) as pool:
        chunks = list(pool.map(read, sorted(nodes)))
    points = np.vstack(chunks) if chunks else np.empty((0, 4))
    if len(points) < 100:
        raise ValueError("Not enough lidar observations for this property.")
    return points, {"url": base, "nodeCount": len(nodes), "nodes": sorted(nodes), "pointCount": len(points)}


def roof_mesh(points, footprint, cell=0.6, max_gap=3.0):
    """Triangulate classified building returns; never bridge large missing areas."""
    keep = (points[:, 3] == 6) & (points[:, 2] > 2)
    selected = points[keep, :3]
    selected = selected[[footprint.covers(Point(p[:2])) for p in selected]]
    if len(selected) < 80:
        raise ValueError("Insufficient class-6 building returns inside the reviewed footprint.")
    # Retain the upper surface per cell so wall returns do not pull the roof down.
    cells = {}
    for p in selected:
        key = tuple(np.floor(p[:2] / cell).astype(int))
        if key not in cells or p[2] > cells[key][2]:
            cells[key] = p
    samples = np.asarray(list(cells.values()))
    tree = cKDTree(samples[:, :2])
    _, near = tree.query(samples[:, :2], k=min(8, len(samples)))
    # Remove low wall points where nearby classified returns show a higher roof.
    high = np.percentile(samples[near, 2], 75, axis=1)
    samples = samples[samples[:, 2] >= high - 1.2]
    tree = cKDTree(samples[:, :2])
    # Boundary elevations are inferred from nearby returns, not observed facades.
    ring = footprint.exterior
    count = int(np.ceil(ring.length / cell))
    edge = np.array([ring.interpolate(i * ring.length / count).coords[0] for i in range(count)])
    distances, near = tree.query(edge, k=3)
    if np.max(distances[:, 0]) > max_gap:
        raise ValueError("Roof boundary has a gap too large to infer safely for this prototype.")
    heights = np.percentile(samples[near, 2], 75, axis=1)
    vertices = np.vstack((samples, np.column_stack((edge, heights))))
    faces = Delaunay(vertices[:, :2]).simplices
    valid = []
    for face in faces:
        xy = vertices[face, :2]
        lengths = np.linalg.norm(xy - np.roll(xy, 1, axis=0), axis=1)
        if lengths.max() <= max_gap and footprint.buffer(1e-6).covers(Polygon(xy)):
            valid.append(face)
    if not valid:
        raise ValueError("No supported roof surface could be reconstructed.")
    surface_area = sum(Polygon(vertices[f, :2]).area for f in valid)
    support = surface_area / footprint.area
    if support < 0.85:
        raise ValueError("Less than 85% of the footprint supports a roof surface.")
    return vertices, np.asarray(valid), edge, heights, {"buildingReturns": len(selected), "roofSamples": len(samples), "roofCoverage": round(support, 4), "maxBoundaryInterpolationM": round(float(distances[:, 0].max()), 3)}


def mesh(vertices, faces, color):
    # glTF is Y-up: local east, up, south. No Web Mercator scale distortion.
    vertices = np.asarray(vertices)[:, [0, 2, 1]] * [1, 1, -1]
    result = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    result.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(
        baseColorFactor=color, metallicFactor=0, roughnessFactor=0.95, doubleSided=True))
    return result


def build(config, output, cache):
    lon, lat = config["center"]["lon"], config["center"]["lat"]
    points, source = fetch_points(config["lidar"]["url"], lon, lat, 42, cache)
    # An azimuthal equidistant CRS gives true local metres centered on the house.
    local = f"+proj=aeqd +lat_0={lat} +lon_0={lon} +datum=WGS84 +units=m"
    points[:, 0], points[:, 1] = Transformer.from_crs(3857, local, always_xy=True).transform(points[:, 0], points[:, 1])
    footprint = transform(shape(config["footprint"]["geometry"]), Transformer.from_crs(4326, local, always_xy=True).transform, interleaved=False)
    if footprint.geom_type != "Polygon" or not footprint.is_valid or footprint.interiors:
        raise ValueError("This prototype requires one valid footprint without holes.")
    ground = points[(points[:, 3] == 2) & (np.linalg.norm(points[:, :2], axis=1) < 28), :3]
    if len(ground) < 30:
        raise ValueError("Insufficient classified ground returns.")
    ground_z = float(np.median(ground[:, 2]))
    points[:, 2] -= ground_z
    vertices, faces, edge, heights, stats = roof_mesh(points, footprint)
    scene = trimesh.Scene()
    scene.add_geometry(mesh(vertices, faces, [167, 185, 179, 255]), node_name="observed-roof", geom_name="observed-roof")
    wall_vertices, wall_faces = [], []
    for i in range(len(edge)):
        j = (i + 1) % len(edge)
        n = len(wall_vertices)
        wall_vertices.extend([[*edge[i], 0], [*edge[j], 0], [*edge[j], heights[j]], [*edge[i], heights[i]]])
        wall_faces.extend([[n, n+1, n+2], [n, n+2, n+3]])
    scene.add_geometry(mesh(wall_vertices, wall_faces, [224, 215, 189, 255]), node_name="inferred-walls", geom_name="inferred-walls")
    output.mkdir(parents=True, exist_ok=True)
    # Building-only mesh is reusable as a coarse prior; it has no invented textures.
    (output / "prior.glb").write_bytes(scene.export(file_type="glb", include_normals=True))
    pad = 22
    scene.add_geometry(mesh([[-pad,-pad,-.1],[pad,-pad,-.1],[pad,pad,-.1],[-pad,pad,-.1]], [[0,1,2],[0,2,3]], [65, 89, 66, 255]), node_name="presentation-ground", geom_name="presentation-ground")
    # Normals are required for the renderer to light roof slopes correctly.
    model = scene.export(file_type="glb", include_normals=True)
    (output / "model.glb").write_bytes(model)
    manifest = {
        "schemaVersion": 1, "id": config["id"], "name": config["name"], "address": config["address"],
        "center": config["center"], "units": "metres", "axes": "glTF: +X east, +Y up, +Z south",
        "groundElevationM": round(ground_z, 3), "groundDatum": "Source lidar datum; local display only, no ellipsoid placement",
        "lidar": {**config["lidar"], **source}, "footprint": config["footprint"]["source"],
        "processing": {**stats, "gridCellM": 0.6, "maxRoofTriangleEdgeM": 3.0, "groundReturns": len(ground)},
        "model": {"url": "model.glb", "sha256": hashlib.sha256(model).hexdigest(), "bytes": len(model)},
        "limitations": ["2017 survey and 2023 footprint can differ from today's building.", "Roof triangles interpolate classified lidar returns; small gaps and trees can affect the result.", "Walls are inferred vertical surfaces. No windows, doors, siding, textures or dimensions are verified.", "The ground pad is a presentation surface, not a parcel boundary or terrain model.", "Visualization only. No geometry feeds renovation estimates."],
        "generation": {"method": "measured-lidar", "aiGenerated": False},
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"modelBytes": len(model), "sourcePoints": source["pointCount"], **stats}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    args = parser.parse_args()
    build(json.loads(args.config.read_text()), args.output, args.cache)
