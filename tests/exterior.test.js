import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { EXTERIOR_EXAMPLE, exteriorForLocation } from '../exterior-catalog.js';
import { PUBLIC_ASSETS } from '../lib/web.mjs';

test('the exterior catalog accepts the reviewed example and its Census street offset only', () => {
  assert.equal(exteriorForLocation(EXTERIOR_EXAMPLE), EXTERIOR_EXAMPLE);
  assert.equal(exteriorForLocation({ matchedAddress: '2310 San Gabriel Street, Austin, TX 78705', coordinates: { lon: -97.747963879123, lat: 30.287395025807 } }), EXTERIOR_EXAMPLE);
  for (const matchedAddress of ['2312 SAN GABRIEL ST, AUSTIN, TX, 78705', '2310 SAN GABRIEL ST UNIT 2, AUSTIN, TX, 78705', '2310 SAN GABRIEL ST, DALLAS, TX, 78705']) {
    assert.equal(exteriorForLocation({ ...EXTERIOR_EXAMPLE, matchedAddress }), null);
  }
  for (const coordinates of [{ lon: -76.9, lat: 38.84 }, { lon: NaN, lat: 30 }, { lon: '-97.74825', lat: 30.28748 }, null]) {
    assert.equal(exteriorForLocation({ ...EXTERIOR_EXAMPLE, coordinates }), null);
  }
  assert.equal(exteriorForLocation(null), null);
});

test('the shipped GLB matches its provenance, contains local geometry, and needs no external assets', async () => {
  const bytes = await readFile(new URL(`../${EXTERIOR_EXAMPLE.model}`, import.meta.url));
  const manifest = JSON.parse(await readFile(new URL(`../${EXTERIOR_EXAMPLE.manifest}`, import.meta.url), 'utf8'));
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.equal(manifest.model.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(manifest.model.bytes, bytes.length);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  assert.ok(json.nodes.some(node => node.name === 'observed-roof'));
  assert.ok(json.nodes.some(node => node.name === 'inferred-walls'));
  assert.ok(json.meshes.every(mesh => mesh.primitives.every(primitive => Number.isInteger(primitive.attributes.NORMAL))), 'Surface normals make roof slopes visible under lighting');
  assert.ok(json.buffers.every(buffer => !buffer.uri));
  assert.equal(json.images, undefined);
  for (const accessor of json.accessors.filter(a => a.type === 'VEC3')) {
    assert.ok([...accessor.min, ...accessor.max].every(Number.isFinite));
    assert.ok(accessor.min.every(n => n > -100) && accessor.max.every(n => n < 100), 'Local metres, not global Mercator coordinates');
  }
  assert.equal(manifest.generation.aiGenerated, false);
  assert.equal(manifest.lidar.surveyYear, 2017);
  assert.ok(manifest.processing.buildingReturns > 1000);
  assert.ok(manifest.processing.roofCoverage >= .85);
  assert.ok(PUBLIC_ASSETS.includes(EXTERIOR_EXAMPLE.model));
  assert.ok(PUBLIC_ASSETS.includes(EXTERIOR_EXAMPLE.manifest));
  assert.ok(bytes.length < 250_000, 'Keep the example small enough for phones');
});
