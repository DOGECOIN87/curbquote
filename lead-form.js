/**
 * "Send to Alco Products": the homeowner's contact details and estimate summary go to `api/lead`, which
 * forwards them to Alco's inbox. Without a webhook, and on the static site, the same message is written
 * into an email to `LEAD_EMAIL` for the homeowner to send.
 */
import { STATIC_LEAD, STATIC_SITE } from './config.js';
import { OFFICES } from './alco.js';

const MAIL_LIMIT = 1800;   // Long mailto links are cut off by some email apps.
const PHONE_PATTERN = /^[\d\s()+.-]*$/;
const INTRO = 'Alco Products gets your estimate summary and contact details, reviews the measurements and gets back to you. Nothing is sent until you press Send.';
const MAIL_INTRO = 'This writes an email to Alco Products with your estimate summary and contact details. Nothing is sent until you send it from your email app.';

/** The email version of a request, shortened to fit a mailto link. */
export function mailtoLink(address, { contact, estimate = {}, brief }) {
  let body = [`Name: ${contact.name}`, `Email: ${contact.email}`, contact.phone && `Phone: ${contact.phone}`, contact.notes && `Notes: ${contact.notes}`, '', brief]
    .filter(line => typeof line === 'string').join('\n');
  if (body.length > MAIL_LIMIT) body = `${body.slice(0, MAIL_LIMIT).trimEnd()}\n…\n(Shortened. I can send the full summary file.)`;
  const subject = `Estimate request: ${estimate.address || 'my home'}`;
  return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function setupLeadForm({ getRequest, getPhone = () => OFFICES.bethesda.phone, fetchImpl = (...args) => fetch(...args) }) {
  const byId = id => document.getElementById(id);
  const dialog = byId('lead-dialog'), form = byId('lead-form'), intro = byId('lead-intro'), status = byId('lead-status'), submit = byId('lead-submit');
  let destination = null;

  async function where() {
    if (destination) return destination;
    if (STATIC_SITE) return (destination = { configured: false, email: STATIC_LEAD?.email ?? null });
    try {
      const response = await fetchImpl('api/lead', { headers: { Accept: 'application/json' } });
      const data = response.ok ? await response.json() : {};
      return (destination = { configured: data.configured === true, email: typeof data.email === 'string' ? data.email : null });
    } catch {
      return { configured: false, email: null };   // Not kept, so the next open asks again.
    }
  }
  function say(text = '', tone = '') { status.textContent = text; status.dataset.tone = tone; }
  function present({ configured, email }) {
    form.hidden = !configured && !email;
    intro.textContent = configured ? INTRO : email ? MAIL_INTRO : `Online requests are not set up yet. Call Alco Products on ${getPhone()}; your downloaded summary has everything they need.`;
    submit.textContent = configured ? 'Send' : 'Write the email';
  }
  function invalid(field, message) {
    field.setAttribute('aria-invalid', 'true');
    say(message, 'warn');
    field.focus();
    return true;
  }
  function check() {
    const { name, email, phone, consent } = form.elements;
    for (const field of [name, email, phone]) field.removeAttribute('aria-invalid');
    if (!name.value.trim()) return invalid(name, 'Enter your name.');
    if (!email.value.trim() || !email.checkValidity()) return invalid(email, 'Enter a valid email address.');
    if (!PHONE_PATTERN.test(phone.value.trim())) return invalid(phone, 'Use only numbers, spaces and ( ) + - . in the phone number.');
    if (!consent.checked) { say('Tick the box so Alco Products may contact you.', 'warn'); consent.focus(); return true; }
    return false;
  }

  async function open() {
    const request = getRequest();
    if (!request) return;
    const opener = byId('send-lead');
    opener.setAttribute('aria-busy', 'true');
    const found = await where();
    opener.removeAttribute('aria-busy');
    say();
    present(found);
    if (!dialog.open) dialog.showModal();
    (form.hidden ? byId('close-lead') : form.elements.name).focus();
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (check()) return;
    const request = getRequest();
    if (!request) { say('Return to the estimate and correct the home details first.', 'warn'); return; }
    const { name, email, phone, notes } = form.elements;
    const contact = { name: name.value.trim(), email: email.value.trim(), ...(phone.value.trim() && { phone: phone.value.trim() }), ...(notes.value.trim() && { notes: notes.value.trim() }) };
    const found = await where();
    if (!found.configured) {
      if (!found.email) { present(found); return; }
      Object.assign(document.createElement('a'), { href: mailtoLink(found.email, { contact, ...request }) }).click();
      say('Your email app should open with the message written. Press Send there.');
      return;
    }
    submit.disabled = true;
    say('Sending…');
    try {
      const response = await fetchImpl('api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ contact, consent: true, ...request }) });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.sent) {
        form.hidden = true;
        intro.textContent = `Sent. Alco Products will contact you at ${contact.email}. You can close this window.`;
        say();
        byId('close-lead').focus();
      } else if (typeof data.email === 'string') {
        destination = { configured: false, email: data.email };
        present(destination);
        say(`${data.error || 'Could not send.'} You can email it instead.`, 'warn');
      } else say(data.error || `Could not send. Call Alco Products on ${getPhone()}.`, 'warn');
    } catch {
      say(`Could not send. Check your connection or call Alco Products on ${getPhone()}.`, 'warn');
    } finally {
      submit.disabled = false;
    }
  });
  byId('send-lead').addEventListener('click', open);
  byId('close-lead').addEventListener('click', () => dialog.close());
  return { open };
}
