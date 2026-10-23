/**
 * Address suggestions under the Step 1 search box (Google Places), as an ARIA 1.2 combobox: arrow
 * keys move through the list, Enter picks, Escape closes. Picking a suggestion runs the same Census
 * lookup as typing the address in full. Without a Maps key the box behaves exactly as before.
 */
import { suggestAddresses, suggestionSession } from './google-maps.js';

const DEBOUNCE = 250;
export function setupAddressSuggestions({ input, panel, list, onPick }) {
  let timer = 0, controller = null, items = [], active = -1, session = suggestionSession(), picked = '';
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id); input.setAttribute('aria-expanded', 'false');
  function close() {
    clearTimeout(timer); controller?.abort(); controller = null; items = []; active = -1;
    panel.hidden = true; list.replaceChildren(); input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant');
  }
  function highlight(index) {
    active = index;
    [...list.children].forEach((option, i) => option.setAttribute('aria-selected', String(i === index)));
    if (index >= 0) { input.setAttribute('aria-activedescendant', list.children[index].id); list.children[index].scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  }
  function pick(index) {
    const item = items[index];
    if (!item) return;
    picked = item.text; close();
    // The next address entry is a new billing session.
    session = suggestionSession(); onPick(item.text);
  }
  function show(found) {
    items = found; list.replaceChildren(); active = -1;
    found.forEach((item, i) => {
      const option = document.createElement('li'), main = document.createElement('strong'), rest = document.createElement('span');
      option.id = `${list.id}-${i}`; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false'); option.className = 'suggest-option';
      main.textContent = item.main; rest.textContent = item.secondary; option.append(main, rest);
      // Keep focus in the box, so a tap does not close the list before it lands.
      option.addEventListener('pointerdown', event => event.preventDefault());
      option.addEventListener('click', () => pick(i));
      list.append(option);
    });
    panel.hidden = !found.length; input.setAttribute('aria-expanded', String(Boolean(found.length)));
  }
  input.addEventListener('input', () => {
    clearTimeout(timer); controller?.abort();
    const text = input.value;
    if (text.trim().length < 4 || text === picked) { close(); return; }
    timer = setTimeout(async () => {
      const mine = controller = new AbortController(), found = await suggestAddresses(text, { session, signal: mine.signal });
      if (controller !== mine || input.value !== text || document.activeElement !== input) return;
      show(found);
    }, DEBOUNCE);
  });
  // Runs before the page's own Enter handler, so Enter on a highlighted suggestion picks it instead.
  input.addEventListener('keydown', event => {
    if (panel.hidden || event.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      // The box itself (-1) sits between the last suggestion and the first.
      const next = active + (event.key === 'ArrowDown' ? 1 : -1);
      highlight(next < -1 ? items.length - 1 : next >= items.length ? -1 : next);
    } else if (event.key === 'Enter' && active >= 0) { event.preventDefault(); event.stopImmediatePropagation(); pick(active); }
    else if (event.key === 'Escape') { event.preventDefault(); close(); }
  });
  input.addEventListener('blur', close);
  return { close };
}
