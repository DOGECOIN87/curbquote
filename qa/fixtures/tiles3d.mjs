/**
 * Synthetic 3D Tiles for renderer QA, served in place of Google's tileset: a flat lot with one
 * box-shaped house, placed near a test coordinate. It is not a property record or shipped public asset.
 */
const A = 6378137, E2 = 6.69437999014e-3;

/** Earth-fixed position and east/north/up axes at a point (WGS84). */
function frame(lon, lat, height) {
  const l = lon * Math.PI / 180, p = lat * Math.PI / 180, n = A / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
  return {
    origin: [(n + height) * Math.cos(p) * Math.cos(l), (n + height) * Math.cos(p) * Math.sin(l), (n * (1 - E2) + height) * Math.sin(p)],
    east: [-Math.sin(l), Math.cos(l), 0],
    north: [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)],
    up: [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)]
  };
}

/** An axis-aligned box in east/north/up metres, as triangles with flat normals. */
function box([x0, y0, z0], [x1, y1, z1]) {
  const faces = [
    [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]], [[0, 0, -1], [[x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]]],
    [[1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]], [[-1, 0, 0], [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]]],
    [[0, 1, 0], [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]]], [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]]
  ];
  const positions = [], normals = [], indices = [];
  for (const [normal, quad] of faces) {
    const first = positions.length / 3;
    for (const [x, y, z] of quad) { positions.push(x, z, -y); normals.push(normal[0], normal[2], -normal[1]); }   // glTF is y-up.
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
  return { positions, normals, indices };
}

/** A binary glTF with one coloured primitive per box. */
function glb(parts) {
  const chunks = [], views = [], accessors = [], primitives = [];
  let offset = 0;
  const add = (array, target) => {
    const bytes = Buffer.from(array.buffer); chunks.push(bytes, Buffer.alloc((4 - bytes.length % 4) % 4));
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target }); offset += bytes.length + (4 - bytes.length % 4) % 4;
    return views.length - 1;
  };
  parts.forEach(({ positions, normals, indices }, material) => {
    const min = [0, 1, 2].map(i => Math.min(...positions.filter((_, j) => j % 3 === i))), max = [0, 1, 2].map(i => Math.max(...positions.filter((_, j) => j % 3 === i)));
    accessors.push({ bufferView: add(new Float32Array(positions), 34962), componentType: 5126, count: positions.length / 3, type: 'VEC3', min, max });
    accessors.push({ bufferView: add(new Float32Array(normals), 34962), componentType: 5126, count: normals.length / 3, type: 'VEC3' });
    accessors.push({ bufferView: add(new Uint16Array(indices), 34963), componentType: 5123, count: indices.length, type: 'SCALAR' });
    primitives.push({ attributes: { POSITION: accessors.length - 3, NORMAL: accessors.length - 2 }, indices: accessors.length - 1, material });
  });
  const json = {
    asset: { version: '2.0', generator: 'CurbQuote QA' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives }],
    materials: [[0.42, 0.55, 0.34], [0.86, 0.8, 0.7]].map(color => ({ pbrMetallicRoughness: { baseColorFactor: [...color, 1], metallicFactor: 0, roughnessFactor: 1 } })),
    accessors, bufferViews: views, buffers: [{ byteLength: offset }]
  };
  let text = Buffer.from(JSON.stringify(json)); text = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 0x20)]);
  const bin = Buffer.concat(chunks), header = Buffer.alloc(12), jsonHead = Buffer.alloc(8), binHead = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + text.length + 8 + bin.length, 8);
  jsonHead.writeUInt32LE(text.length, 0); jsonHead.writeUInt32LE(0x4e4f534a, 4); binHead.writeUInt32LE(bin.length, 0); binHead.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHead, text, binHead, bin]);
}

/**
 * The lot is centred on the test coordinate at `groundHeight` metres; the house is `house` metres
 * (east, north, height) with its centre `northOffset` metres north of the point, as an address point
 * on the street side would be. Returns the tileset JSON, the content and the house's outline ring.
 */
export function syntheticTileset({ lon, lat, groundHeight = 30, house = [16, 10, 8.5], northOffset = 12 }) {
  const { origin, east, north, up } = frame(lon, lat, groundHeight), [w, d, h] = house;
  const transform = [...east, 0, ...north, 0, ...up, 0, ...origin, 1];
  const content = glb([box([-60, -60, -0.5], [60, 60, 0]), box([-w / 2, northOffset - d / 2, 0], [w / 2, northOffset + d / 2, h])]);
  const tileset = { asset: { version: '1.1' }, geometricError: 64, root: { transform, boundingVolume: { sphere: [0, 0, 4, 90] }, geometricError: 0, refine: 'REPLACE', content: { uri: 'house.glb' } } };
  const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540, at = (x, y) => [lon + x / kx, lat + y / ky];
  const outline = [at(-w / 2, northOffset - d / 2), at(w / 2, northOffset - d / 2), at(w / 2, northOffset + d / 2), at(-w / 2, northOffset + d / 2), at(-w / 2, northOffset - d / 2)];
  return { tileset, content, outline };
}
