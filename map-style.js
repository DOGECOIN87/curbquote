import { AERIAL_ENDPOINT, hasAerialCoverage } from './property-view.js';

export const MAP_DATA_URL = 'https://tiles.openfreemap.org/planet';
export const MAP_GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
export const MAP_AERIAL_TILES = `${AERIAL_ENDPOINT}?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&f=image`;
export const emptySelection = () => ({ type: 'FeatureCollection', features: [] });

/** Display layers only. A building in these tiles is never an estimator input. */
export function propertyMapStyle(location) {
  const { lat, lon } = location.coordinates;
  const aerial = hasAerialCoverage(location.coordinates);
  return {
    version: 8, glyphs: MAP_GLYPHS_URL,
    sources: {
      openmaptiles: { type: 'vector', url: MAP_DATA_URL },
      ...(aerial ? { naip: { type: 'raster', tiles: [MAP_AERIAL_TILES], tileSize: 256, minzoom: 14, maxzoom: 19 } } : {}),
      selected: { type: 'geojson', data: emptySelection() },
      address: { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lon, lat] } } }
    },
    layers: [
      { id: 'paper', type: 'background', paint: { 'background-color': '#eef0e6' } },
      { id: 'land', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover', paint: { 'fill-color': '#d5e2cc', 'fill-opacity': .65 } },
      { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-color': '#a6cbd4' } },
      ...(aerial ? [{ id: 'aerial', type: 'raster', source: 'naip', paint: { 'raster-fade-duration': 0 } }] : []),
      { id: 'roads', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', filter: ['!=', ['get', 'class'], 'rail'], paint: { 'line-color': '#f8faf0', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 2, 20, 13], 'line-opacity': .5 } },
      { id: 'building-fill', type: 'fill', source: 'openmaptiles', 'source-layer': 'building', minzoom: 14, paint: { 'fill-color': '#779a76', 'fill-opacity': .22 } },
      { id: 'building-outline', type: 'line', source: 'openmaptiles', 'source-layer': 'building', minzoom: 14, paint: { 'line-color': '#d4ffac', 'line-width': 1.6, 'line-opacity': .9 } },
      { id: 'housenumber', type: 'symbol', source: 'openmaptiles', 'source-layer': 'housenumber', minzoom: 15, layout: { 'text-field': ['get', 'housenumber'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-allow-overlap': false, 'text-ignore-placement': false }, paint: { 'text-color': '#102303', 'text-halo-color': '#fff', 'text-halo-width': 1.6, 'text-halo-blur': 0.5 } },
      { id: 'selected-fill', type: 'fill', source: 'selected', paint: { 'fill-color': '#89C63F', 'fill-opacity': .3 } },
      { id: 'selected-outline', type: 'line', source: 'selected', paint: { 'line-color': '#89C63F', 'line-width': 4 } },
      { id: 'street-labels', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation_name', minzoom: 14, layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name'], ''], 'text-font': ['Noto Sans Regular'], 'text-size': 11 }, paint: { 'text-color': '#173d36', 'text-halo-color': '#fffff0', 'text-halo-width': 2 } },
      { id: 'address-halo', type: 'circle', source: 'address', paint: { 'circle-radius': 16, 'circle-color': '#89C63F', 'circle-opacity': .2, 'circle-stroke-color': '#89C63F', 'circle-stroke-width': 1 } },
      { id: 'address-point', type: 'circle', source: 'address', paint: { 'circle-radius': 5, 'circle-color': '#89C63F', 'circle-stroke-color': '#102303', 'circle-stroke-width': 2 } }
    ]
  };
}

/** Copy only a bounded polygon for temporary highlighting; omit every provider property. */
export function buildingHighlight(feature) {
  const geometry = feature?.geometry;
  if (!['Polygon', 'MultiPolygon'].includes(geometry?.type)) return null;
  let points = 0;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(polygons) || !polygons.length) return null;
  for (const rings of polygons) {
    if (!Array.isArray(rings) || !rings.length) return null;
    for (const ring of rings) {
      if (!Array.isArray(ring) || ring.length < 4) return null;
      for (const point of ring) {
        if (++points > 5000 || !Array.isArray(point) || point.length !== 2 || point.some(n => typeof n !== 'number' || !Number.isFinite(n)) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) return null;
      }
      if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) return null;
    }
  }
  return { type: 'Feature', properties: {}, geometry: JSON.parse(JSON.stringify(geometry)) };
}
