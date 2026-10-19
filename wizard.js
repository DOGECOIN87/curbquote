/** One step on screen at a time. The step list lets homeowners move back and forth freely; nothing is lost between steps. */
export function setupWizard({ root = document, onChange } = {}) {
  const parts = [...root.querySelectorAll('[data-step]')], buttons = [...root.querySelectorAll('[data-goto]')];
  const last = buttons.length;
  let current = 1;
  function show(step, { focus = false } = {}) {
    current = Math.min(Math.max(Number(step) || 1, 1), last);
    for (const part of parts) part.hidden = !part.dataset.step.split(' ').includes(String(current));
    for (const button of buttons) {
      const n = Number(button.dataset.goto);
      if (n === current) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
      button.classList.toggle('done', n < current);
    }
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
  for (const button of buttons) button.addEventListener('click', () => show(button.dataset.goto, { focus: true }));
  root.addEventListener('click', event => {
    const move = event.target.closest('[data-next], [data-back]');
    if (move) show(current + (move.hasAttribute('data-next') ? 1 : -1), { focus: true });
  });
  return { show, reveal, get current() { return current; } };
}
