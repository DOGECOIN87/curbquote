import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setupWizard } from '../wizard.js';

// The wizard only touches `window` when it scrolls after a focus-changing move.
globalThis.window = { scrollTo() {}, addEventListener: globalThis.addEventListener };
globalThis.matchMedia = () => ({ matches: true });

/** Minimal DOM: enough of querySelectorAll/addEventListener/classList/dataset for the wizard. */
function fakeDocument(parts) {
  const listeners = new Map();
  const buttons = parts.filter(part => part.stepButton).map(part => ({
    dataset: { goto: part.stepButton }, classList: { toggle() {} },
    setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; }
  }));
  return {
    listeners, buttons,
    querySelectorAll(selector) {
      if (selector === '.wizard-steps [data-goto]') return buttons;
      if (selector === '[data-step]') return parts;
      return [];
    },
    addEventListener(type, handler) { listeners.set(type, handler); }
  };
}

function part(step, extra = {}) {
  return {
    dataset: { step }, hidden: false,
    classList: { contains: value => value === 'wizard-step' },
    querySelector: () => null, ...extra
  };
}

test('a step control opens its step and hides the others', () => {
  const parts = [part('1', { stepButton: '1' }), part('2', { stepButton: '2' })];
  const root = fakeDocument(parts);
  const wizard = setupWizard({ root });
  assert.equal(wizard.current, 1);
  const stepControl = { closest: selector => selector.includes('[data-step-link]') ? { dataset: { stepLink: '2' } } : null };
  root.listeners.get('click')({ target: stepControl });
  assert.equal(wizard.current, 2);
  assert.equal(parts[0].hidden, true);
  assert.equal(parts[1].hidden, false);
  assert.equal(root.buttons[1]['aria-current'], 'step');
});

test('data-step-link controls inside a step and on the estimate screen move the wizard', () => {
  const parts = [part('1', { stepButton: '1' }), part('2', { stepButton: '2' }), part('5', { stepButton: '5' })];
  const root = fakeDocument(parts);
  const wizard = setupWizard({ root });
  wizard.show(5);
  // A delegated click on a nested span resolves to the closest [data-step-link] button.
  const nested = { closest: selector => selector.includes('[data-step-link]') ? { dataset: { stepLink: '4' } } : null };
  root.listeners.get('click')({ target: nested });
  assert.equal(wizard.current, 4);
  assert.equal(parts[2].hidden, true);
});

test('a step routed to with data-open-studio lands on the estimate step', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /data-open-studio/);
  assert.match(html, /id="jump-to-3d"/);
  assert.match(html, /data-live-range/);
  assert.match(html, /id="remodel-compare-note"/);
  // No uppercase, letter-spaced overline may sit above a heading.
  assert.doesNotMatch(html, /text-transform:\s*uppercase/);
});

test('inline Step 3 3D preview, split slider, Step 4 rate summary and caveats card stay wired without eyebrows or tofu glyphs', async () => {
  const [html, css] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../styles.css', import.meta.url), 'utf8')
  ]);
  assert.match(html, /class="view-pair-callout"/);
  assert.match(html, /id="step3-3d-stage"/);
  assert.match(html, /id="price-details-summary"/);
  assert.match(html, /id="reset-rates"/);
  assert.match(html, /class="estimate-caveats-card"/);
  assert.match(html, /id="remodel-split-half"/);
  assert.match(html, /id="remodel-split"/);
  assert.doesNotMatch(html, /\uFF0B/);
  assert.doesNotMatch(css, /text-transform:\s*uppercase/);
});
