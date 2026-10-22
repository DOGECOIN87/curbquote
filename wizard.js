/**
 * One step on screen at a time. The step list lets homeowners move back and forth freely; nothing is
 * lost between steps. `data-step-link` is delegated too, so in-page links (such as "Check your
 * measurements" on the estimate) can jump without joining the step list itself.
 */
export function setupWizard({ root = document, onChange } = {}) {
  const parts = [...root.querySelectorAll('[data-step]')];
  const buttons = [...root.querySelectorAll('.wizard-steps [data-goto]')];
  const last = parts.reduce((max, part) => Math.max(max, ...part.dataset.step.split(' ').map(Number)), 1);
  let current = 1;
  function show(step, { focus = false } = {}) {
    current = Math.min(Math.max(Number(step) || 1, 1), last);
    for (const part of parts) part.hidden = !part.dataset.step.split(' ').includes(String(current));
    for (const button of buttons) {
      const n = Number(button.dataset.goto);
      if (n === current) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
      button.classList.toggle('done', n < current);
    }
    const progressReadout = root.querySelector?.('#step-progress-readout');
    if (progressReadout) progressReadout.textContent = `Step ${current} of ${last}`;
    if (focus) {
      const heading = parts.find(part => !part.hidden && part.classList.contains('wizard-step'))?.querySelector('h1, h2');
      if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
      window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }
    onChange?.(current);
  }
  /** Shows the step holding an element and opens any collapsed section around it, so it can take focus. */
  function reveal(element) {
    const part = element?.closest('.wizard-step[data-step]');
    if (part && part.hidden) show(part.dataset.step);
    for (let details = element?.closest('details'); details; details = details.parentElement?.closest('details')) details.open = true;
  }
  root.addEventListener('click', event => {
    const move = event.target.closest('[data-next], [data-back]');
    if (move) { show(current + (move.hasAttribute('data-next') ? 1 : -1), { focus: true }); return; }
    const jump = event.target.closest('[data-step-link], .wizard-steps [data-goto]');
    if (jump) show(jump.dataset.stepLink || jump.dataset.goto, { focus: true });
  });
  return { show, reveal, get current() { return current; } };
}
