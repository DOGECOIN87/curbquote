import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChangeRequest, describeChange } from '../intent.js';

test('plain requests choose trades, colour, style, finish level and budget', () => {
  const navy = parseChangeRequest('Navy siding and new windows, under $30k');
  assert.deepEqual(navy.trades, { siding: true, windows: true, doors: false });
  assert.equal(navy.color, 'navy');
  assert.equal(navy.budget, 30000);
  assert.equal(describeChange(navy), 'Siding and windows · Deep navy siding · budget about $30,000');
  assert.deepEqual(parseChangeRequest('just the front door').trades, { siding: false, windows: false, doors: true });
  assert.deepEqual(parseChangeRequest('everything but no doors').trades, { siding: true, windows: true, doors: false });
  assert.deepEqual(parseChangeRequest('under $45,000 for all three').trades, { siding: true, windows: true, doors: true });
  assert.equal(parseChangeRequest('under $45,000 for all three').budget, 45000);
  const farmhouse = parseChangeRequest('make it a modern farmhouse in white');
  assert.equal(farmhouse.homeStyle, 'modern-farmhouse');
  assert.equal(farmhouse.color, 'white');
  assert.equal(parseChangeRequest('dutch colonial').homeStyle, 'dutch-colonial');
  assert.equal(parseChangeRequest('premium vinyl windows').tier, 'premium');
  assert.deepEqual(parseChangeRequest('replace the windows').trades, { siding: false, windows: true, doors: false });
});

test('describing a trade does not drop the others from the project', () => {
  for (const text of ['premium vinyl windows', 'fiber cement siding in sage', 'how much for siding?']) assert.equal(parseChangeRequest(text).trades, null, text);
});

test('studio finishes and features are understood, and a colour before "roof" or "trim" stays there', () => {
  const modern = parseChangeRequest('modern exterior with a black metal roof and black trim');
  assert.equal(modern.homeStyle, 'contemporary-gable');
  assert.deepEqual(modern.design, { roof: 'onyx', trim: 'black', roofMaterial: 'metal' });
  assert.equal(modern.color, null);
  assert.deepEqual(parseChangeRequest('add a porch and a picket fence, no shutters').design, { porch: true, fence: true, shutters: false });
  const fiber = parseChangeRequest('fiber cement siding in sage with stone accents');
  assert.equal(fiber.sidingProduct, 'fiber'); assert.equal(fiber.color, 'sage'); assert.equal(fiber.design.masonry, 'stone');
  assert.equal(parseChangeRequest('show it at golden hour').design.scene, 'golden');
  const white = parseChangeRequest('white house with a red roof');
  assert.equal(white.color, 'white'); assert.equal(white.design.roof, 'clay');
  assert.equal(describeChange(modern), 'Contemporary style · black metal roof · black trim');
});

test('longer phrases win and words inside other words do not match', () => {
  assert.equal(parseChangeRequest('dark gray siding').color, 'charcoal');
  assert.equal(parseChangeRequest('gray siding').color, 'slate');
  assert.equal(parseChangeRequest('replaced the gutters').color, null);
  assert.equal(parseChangeRequest('a standard ranch').color, null);
  assert.equal(parseChangeRequest('a standard ranch').homeStyle, 'ranch-1story');
  assert.equal(parseChangeRequest('budget is 25').tier, null);
  assert.equal(parseChangeRequest('budget is 25').budget, 25000);
});

test('unrelated text is not treated as a change, and input is bounded', () => {
  for (const text of ['hello there', '', null, 'replaced the gutters']) assert.equal(parseChangeRequest(text).recognized, false);
  assert.equal(parseChangeRequest('how much for siding?').wantsEstimate, true);
  assert.doesNotThrow(() => parseChangeRequest('siding '.repeat(10000)));
  assert.equal(parseChangeRequest('under $5 billion').budget, null);
});
