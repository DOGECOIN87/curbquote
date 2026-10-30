import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_INPUT } from '../estimate.js';
import { DEFAULT_PROJECT, catalogRates, estimateProject } from '../project.js';
import { comparePlans, reviewProject, parseProjectGoal, parseGoalBudget, validateSnapshot, proposalSnapshot, buildContractorBrief } from '../planning.js';

const snapshot = () => ({ inputs: { ...DEFAULT_INPUT }, options: { ...DEFAULT_PROJECT }, confirmed: [] });
test('budget amounts in goal text are normalized without interpreting replacement counts as dollars', () => {
  assert.equal(parseGoalBudget('Replace 4 windows under $8,000.'), 8000);
  assert.equal(parseGoalBudget('My budget is 25k'), 25000);
  assert.equal(parseGoalBudget('Replace 6 windows and 1 door'), null);
  assert.throws(() => parseGoalBudget('Budget 10'), /budget/);
});

test('planner enumerates product and tier combinations without changing the input or scope', () => {
  const state = snapshot(), before = structuredClone(state);
  const comparison = comparePlans(state, { budget: 60000 });
  assert.ok(comparison.evaluated >= 54);   // 2 siding × 3 window × 3 door products × 3 tiers
  assert.ok(comparison.fittingCount > 0);
  assert.deepEqual(state, before);
  for (const plan of comparison.plans) {
    assert.deepEqual(plan.total, estimateProject(plan.inputs, plan.options).total);
    for (const kind of ['siding', 'windows', 'doors']) assert.equal(plan.options[kind], state.options[kind]);
    assert.equal(plan.options.coveragePercent, 100);
    if (plan.fit === 'within') assert.ok(plan.total[1] <= 60000);
  }
});
test('budget fits use upper bounds, and an impossible budget is reported honestly', () => {
  const comparison = comparePlans(snapshot(), { budget: 25000 });
  assert.equal(comparison.fittingCount, 0);
  assert.match(comparison.message, /No tested plan/);
  assert.equal(comparison.plans[0].fit, 'overlap');
  assert.throws(() => comparePlans(snapshot(), { budget: NaN }), /budget/);
  assert.throws(() => comparePlans(snapshot(), { budget: '25000' }), /budget/);
});
test('phasing is explicit and retains selected scope and coverage where budget permits', () => {
  const comparison = comparePlans(snapshot(), { budget: 20000, allowPhasing: true });
  assert.ok(comparison.fittingCount > 0);
  for (const plan of comparison.plans) {
    assert.ok(plan.total[1] <= 20000);
    assert.ok(plan.options.coveragePercent <= 100);
    assert.equal(plan.inputs.replaceWindows, DEFAULT_INPUT.replaceWindows);
    assert.equal(plan.inputs.lengthFt, DEFAULT_INPUT.lengthFt);
  }
  const all = comparePlans(snapshot(), { budget: 500000, allowPhasing: true });
  assert.equal(all.plans[0].retainedScope, 1);
  const windows = snapshot(); windows.options.siding = windows.options.doors = false;
  for (const plan of comparePlans(windows, { budget: 5000, allowPhasing: true }).plans) assert.equal(plan.options.siding, false);
});
test('reviews track homeowner confirmation independently of plausible example values', () => {
  const state = snapshot();
  const review = reviewProject(state);
  assert.equal(review.confirmedCount, 0);
  assert.ok(review.questions.some(question => question.field === 'lengthFt'));
  state.confirmed = ['lengthFt', 'widthFt', 'notAField', 'lengthFt'];
  assert.equal(reviewProject(state).confirmedCount, 2);
  assert.deepEqual(validateSnapshot(state).confirmed, ['lengthFt', 'widthFt']);
  state.options.siding = state.options.doors = false;
  const windowReview = reviewProject(state);
  assert.deepEqual(windowReview.questions.map(question => question.field), ['existingWindows', 'replaceWindows']);
});
test('supported goal text produces reviewable changes without inventing totals or dimensions', () => {
  const state = snapshot();
  const proposal = parseProjectGoal('Windows only. Replace 4 windows.', state);
  assert.equal(proposal.options.siding, false);
  assert.equal(proposal.inputs.replaceWindows, 4);
  assert.equal(proposal.inputs.existingWindows, 12);
  assert.equal(proposal.inputs.lengthFt, 48);
  assert.equal(proposal.confirmed.length, 0);
  const fiber = parseProjectGoal('I want enhanced fiber cement siding for a 40 x 30 ft 1-story home.', state);
  assert.equal(fiber.inputs.lengthFt, 40); assert.equal(fiber.inputs.widthFt, 30); assert.equal(fiber.inputs.stories, 1);
  assert.deepEqual(fiber.inputs.sidingLowPerSqFt, catalogRates(fiber.options).sidingLowPerSqFt);
  assert.throws(() => parseProjectGoal('Replace 50 windows', state), /exceed existing/);
  assert.equal(parseProjectGoal('Make it beautiful', state).changed, false);
});
test('proposals re-enable saved excluded trades at catalog prices instead of retaining zero cost', () => {
  const state = snapshot(); state.options.siding = state.options.doors = false;
  state.inputs = estimateProject(state.inputs, state.options).inputs;
  assert.equal(state.inputs.sidingHighPerSqFt, 0);
  const proposal = proposalSnapshot(state, {}, { siding: true });
  assert.equal(proposal.inputs.sidingHighPerSqFt, 20);
  assert.ok(estimateProject(proposal.inputs, proposal.options).items.siding[1] > 0);
  const parsed = parseProjectGoal('Siding only', state);
  assert.ok(estimateProject(parsed.inputs, parsed.options).total[1] > 0);
});
test('contractor brief includes assumptions, source versions and unresolved details', () => {
  const text = buildContractorBrief(snapshot(), { goal: 'Refresh the exterior', budget: 25000, address: '123 Main St' });
  assert.match(text, /CONTRACTOR DISCUSSION BRIEF/);
  assert.match(text, /\$25,000/);
  assert.match(text, /Footprint length|footprint length/);
  assert.match(text, /illustrative/i);
  assert.match(text, /No appointment has been requested/);
});
