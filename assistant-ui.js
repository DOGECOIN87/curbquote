import { DETAIL_FIELDS, FIELD_NAMES, validateSnapshot, reviewProject, comparePlans, parseProjectGoal, parseGoalBudget, buildContractorBrief } from './planning.js';
import { estimateProject } from './project.js';

const DRAFT_KEY = 'curbquote.draft.v1';
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const price = pair => pair.map(value => money.format(value)).join(' – ');
const el = id => document.getElementById(id);
const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; };

export function setupAssistant({ read, apply, focusField, getAddress, applyLocation, showProperty }) {
  let confirmed = [], history = [], undo = null, comparisonSnapshot = '', serial = 0, controller = null, saveTimer, paused = false;
  const state = () => validateSnapshot({ ...read(), confirmed });
  const fingerprint = () => JSON.stringify(read());
  const status = text => { el('assistant-status').textContent = text; };
  const budgetValue = () => {
    const raw = el('project-budget').value;
    if (!raw.trim()) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 100 || value > 10000000) throw new Error('Enter a target budget between $100 and $10,000,000.');
    return value;
  };
  function conversation(role, text) {
    history.push({ role, content: text.slice(0, 1800) }); history = history.slice(-6);
    const container = el('assistant-conversation');
    container.append(make('p', `assistant-message ${role}`, text));
    while (container.children.length > 6) container.firstElementChild.remove();
  }
  function activity(items) {
    const list = el('assistant-activity'); list.replaceChildren(); list.hidden = !items.length;
    for (const item of items) list.append(make('li', '', item.summary));
  }
  function renderReview() {
    const container = el('detail-questions'); container.replaceChildren();
    try {
      const review = reviewProject(state());
      el('detail-review-summary').textContent = `${review.confirmedCount} of ${review.requiredCount} relevant home details confirmed`;
      const warnings = el('project-warnings'); warnings.replaceChildren(...review.warnings.map(text => make('li', '', text)));
      for (const question of review.questions) {
        const row = make('div', 'detail-question'); row.append(make('span', '', question.message));
        const edit = make('button', 'outline-button', 'Edit'); edit.type = 'button'; edit.addEventListener('click', () => focusField(question.field));
        const confirm = make('button', 'outline-button', 'I checked this'); confirm.type = 'button'; confirm.setAttribute('aria-label', `Confirm ${question.label.toLowerCase()}`);
        confirm.addEventListener('click', () => { confirmed.push(question.field); changed(); });
        row.append(edit, confirm); container.append(row);
      }
    } catch { el('detail-review-summary').textContent = 'Correct the estimate fields to check home details'; el('project-warnings').replaceChildren(); }
  }
  function invalidate() {
    serial++; controller?.abort(); controller = null;
    el('run-assistant').disabled = false; el('assistant-form').removeAttribute('aria-busy');
    if (!el('plan-comparison').hidden) {
      el('plan-comparison').hidden = true;
      status('Project changed. Run a fresh comparison for the current details.');
    }
    activity([]);
  }
  function saveDraft() {
    if (paused) return;
    try {
      const snapshot = state();
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ snapshot, goal: el('project-goal').value, budget: el('project-budget').value, allowPhasing: el('allow-phasing').checked, address: getAddress(), savedAt: new Date().toISOString() }));
      el('draft-status').textContent = 'Draft saved on this device';
    } catch { el('draft-status').textContent = 'Draft not saved. Check the fields or browser storage.'; }
  }
  function changed(invalidateResults = true) {
    if (invalidateResults) invalidate();
    renderReview(); clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 450);
  }
  function applyPlan(plan, label) {
    if (comparisonSnapshot !== fingerprint()) { invalidate(); status('These plans are out of date. Compare again before applying.'); return; }
    const candidate = validateSnapshot({ inputs: plan.inputs, options: plan.options, confirmed });
    const before = state();
    const changedDetails = DETAIL_FIELDS.filter(key => Number(before.inputs[key]) !== Number(candidate.inputs[key]));
    candidate.confirmed = confirmed.filter(key => !changedDetails.includes(key));
    undo = { ...before, address: getAddress() };
    confirmed = candidate.confirmed; apply(candidate); changed();
    el('undo-plan').hidden = false;
    status(`${label} applied: ${price(estimateProject(candidate.inputs, candidate.options).total)}. Review any unconfirmed home details. You can undo this change.`);
  }
  function renderPlans(comparison, proposal = null) {
    const container = el('plan-comparison'); container.replaceChildren(); container.hidden = false;
    comparisonSnapshot = fingerprint();
    if (comparison) { container.append(make('p', 'comparison-summary', comparison.message)); container.append(make('p', 'assistant-help', comparison.note)); }
    const grid = make('div', 'plan-grid');
    const plans = [...(proposal ? [proposal] : []), ...(comparison?.plans || [])];
    for (const [index, plan] of plans.entries()) {
      const card = make('article', 'plan-card');
      card.append(make('h3', '', plan.label || 'Assistant proposal'), make('p', 'plan-price', price(plan.total)), make('p', 'plan-description', plan.description));
      if (plan.fit) card.append(make('span', `budget-fit ${plan.fit}`, ({ within: 'Upper estimate within budget', overlap: 'Range overlaps budget · risk of exceeding', over: 'Above target budget', unbudgeted: 'No target budget entered' })[plan.fit]));
      if (plan.scope) card.append(make('p', 'plan-description', `Included work: ${plan.scope}${plan.options.siding ? ` · ${plan.options.coveragePercent}% siding` : ''}`));
      const changes = [];
      const current = state();
      for (const key of DETAIL_FIELDS) if (Number(plan.inputs[key]) !== Number(current.inputs[key])) changes.push(`${FIELD_NAMES[key]}: ${plan.inputs[key]}`);
      for (const kind of ['siding', 'windows', 'doors']) if (plan.options[kind] !== current.options[kind]) changes.push(`${kind}: ${plan.options[kind] ? 'included' : 'deferred'}`);
      if (changes.length) card.append(make('p', 'plan-changes', changes.join(' · ')));
      card.append(make('p', 'plan-description', 'Illustrative prices · verify measurements before ordering'));
      const use = make('button', 'outline-button', 'Use this plan'); use.type = 'button'; use.dataset.planIndex = index;
      use.addEventListener('click', () => applyPlan(plan, plan.label || 'Assistant proposal')); card.append(use); grid.append(card);
    }
    container.append(grid);
  }
  function automaticPlan(prompt = '') {
    const initial = state(), proposal = prompt ? parseProjectGoal(prompt, initial) : { ...initial, changed: false };
    const input = proposal.changed ? proposal : initial;
    const comparison = comparePlans(input, { budget: budgetValue(), allowPhasing: el('allow-phasing').checked });
    const result = estimateProject(input.inputs, input.options);
    renderPlans(comparison, proposal.changed ? { ...proposal, total: result.total, label: 'Goal-based proposal', description: 'Parsed explicit counts, scope or materials from your request. Check the details before applying.' } : null);
    const review = reviewProject(input);
    activity([{ summary: 'Checked the current project and unconfirmed home details.' }, ...(proposal.changed ? [{ summary: 'Calculated a reviewable proposal from supported details in your goal.' }] : []), { summary: `Compared ${comparison.evaluated} plans with the calculation engine.` }]);
    return `Automatic planner: ${comparison.message}${proposal.changed ? ' Your explicit project details are shown in a proposal; use its button to apply them.' : prompt ? ' I compared the current form values. Free-form requests require the AI connection; unsupported details were not applied.' : ''}${review.questions[0] ? ` Next: ${review.questions[0].message}` : ' Have a contractor verify the scope on site.'}`;
  }
  async function run(event) {
    event.preventDefault();
    const prompt = el('project-goal').value.trim();
    if (!prompt) { status('Describe your renovation goal, or choose Compare plans.'); el('project-goal').focus(); return; }
    let snapshot, budget;
    try { snapshot = state(); const fromGoal = parseGoalBudget(prompt); if (fromGoal !== null) el('project-budget').value = fromGoal; budget = budgetValue(); } catch (error) { status(error.message); return; }
    invalidate();
    const requestSerial = serial, initialFingerprint = fingerprint();
    const requestHistory = history.slice(-6);
    conversation('user', prompt); el('run-assistant').disabled = true; el('assistant-form').setAttribute('aria-busy', 'true');
    status('Checking your project and running estimate tools…');
    const abort = new AbortController(); controller = abort;
    const timeout = setTimeout(() => abort.abort(), 30000);
    try {
      const response = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ prompt, snapshot, budget, allowPhasing: el('allow-phasing').checked, history: requestHistory }), signal: abort.signal, cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || payload.mode !== 'ai' || typeof payload.text !== 'string' || !Array.isArray(payload.activity)) throw new Error('AI unavailable');
      if (requestSerial !== serial || initialFingerprint !== fingerprint()) return;
      // Validate returned plans again; no model response can inject HTML or bypass the estimate engine.
      if (payload.proposal) { validateSnapshot({ ...payload.proposal, confirmed }); payload.proposal.total = estimateProject(payload.proposal.inputs, payload.proposal.options).total; }
      if (payload.comparisons) for (const plan of payload.comparisons.plans) { validateSnapshot({ ...plan, confirmed }); plan.total = estimateProject(plan.inputs, plan.options).total; }
      if (payload.proposal || payload.comparisons) renderPlans(payload.comparisons, payload.proposal);
      if (payload.location) applyLocation(payload.location);
      if (payload.property) showProperty?.(payload.property);
      activity(payload.activity); conversation('assistant', payload.text); el('assistant-mode').textContent = 'AI assistant';
      status('Assistant finished. Review the calculated proposals and missing details.');
    } catch {
      if (requestSerial !== serial || initialFingerprint !== fingerprint()) return;
      el('assistant-mode').textContent = 'Automatic planner';
      try { conversation('assistant', automaticPlan(prompt)); status('AI is unavailable for this request. Automatic planning completed using the current form and supported goal details.'); }
      catch (error) { status(`Automatic planning needs another detail: ${error.message}`); }
    } finally {
      clearTimeout(timeout);
      if (requestSerial === serial) { controller = null; el('run-assistant').disabled = false; el('assistant-form').removeAttribute('aria-busy'); }
      saveDraft();
    }
  }
  el('assistant-form').addEventListener('submit', run);
  el('compare-plans').addEventListener('click', () => { invalidate(); try { status(automaticPlan()); } catch (error) { status(error.message); } });
  el('review-project').addEventListener('click', () => { renderReview(); el('detail-review').open = true; status('Check the highest-impact home details below.'); });
  el('download-brief').addEventListener('click', () => {
    try {
      const text = buildContractorBrief(state(), { address: getAddress(), goal: el('project-goal').value, budget: budgetValue() });
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      const link = make('a'); link.href = url; link.download = 'curbquote-contractor-brief.txt'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      status('Contractor discussion brief downloaded. No appointment requested or information sent.');
    } catch (error) { status(error.message); }
  });
  el('undo-plan').addEventListener('click', () => {
    if (!undo) return;
    confirmed = undo.confirmed; apply(undo); undo = null; el('undo-plan').hidden = true; changed(); status('Previous project restored.');
  });
  for (const id of ['project-goal', 'project-budget', 'allow-phasing']) el(id).addEventListener('input', () => changed());
  el('discard-draft').addEventListener('click', () => { try { window.localStorage.removeItem(DRAFT_KEY); el('restore-draft').hidden = el('discard-draft').hidden = true; el('draft-status').textContent = 'Previous draft discarded'; paused = false; } catch { status('Browser storage is unavailable. The previous draft could not be removed.'); } });
  el('restore-draft').addEventListener('click', () => {
    try {
      const draft = JSON.parse(window.localStorage.getItem(DRAFT_KEY)), snapshot = validateSnapshot(draft.snapshot);
      confirmed = snapshot.confirmed; apply({ ...snapshot, address: typeof draft.address === 'string' ? draft.address.slice(0, 120) : '' });
      el('project-goal').value = typeof draft.goal === 'string' ? draft.goal.slice(0, 1800) : '';
      el('project-budget').value = typeof draft.budget === 'string' ? draft.budget : ''; el('allow-phasing').checked = draft.allowPhasing === true;
      paused = false; el('restore-draft').hidden = el('discard-draft').hidden = true; changed(); status('Draft restored from this device.');
    } catch { status('This draft could not be restored. Your current project is still available.'); }
  });
  try {
    if (window.localStorage.getItem(DRAFT_KEY)) { paused = true; el('restore-draft').hidden = el('discard-draft').hidden = false; el('draft-status').textContent = 'A previous draft is available'; }
  } catch { el('draft-status').textContent = 'Draft storage is unavailable'; }
  renderReview();
  // A GET health check performs no inference and never sends the current project.
  fetch('/api/assistant', { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(6000) }).then(response => response.json()).then(result => { if (result.mode === 'ai') el('assistant-mode').textContent = 'AI assistant'; }).catch(() => {});
  return {
    changed: field => { if (DETAIL_FIELDS.includes(field)) confirmed = confirmed.filter(key => key !== field); changed(); },
    metadata: () => ({ confirmed: [...confirmed], goal: el('project-goal').value, budget: el('project-budget').value, allowPhasing: el('allow-phasing').checked }),
    restore: (metadata = {}) => {
      paused = false; el('restore-draft').hidden = el('discard-draft').hidden = true;
      confirmed = Array.isArray(metadata.confirmed) ? metadata.confirmed.filter(key => DETAIL_FIELDS.includes(key)) : [];
      el('project-goal').value = typeof metadata.goal === 'string' ? metadata.goal.slice(0, 1800) : '';
      el('project-budget').value = typeof metadata.budget === 'string' ? metadata.budget : '';
      el('allow-phasing').checked = metadata.allowPhasing === true;
      history = []; undo = null; el('assistant-conversation').replaceChildren(); el('undo-plan').hidden = true; changed();
    }
  };
}
