import test from 'node:test';
import assert from 'node:assert/strict';
import { createLeadHandler, leadConfig } from '../api/lead.js';
import { mailtoLink } from '../lead-form.js';

const WEBHOOK = 'https://hooks.example.com/alco-leads';
const lead = { contact: { name: 'Pat Homeowner', email: 'pat@example.com', phone: '(301) 555-0100' }, consent: true, estimate: { address: '12 Example St, Silver Spring, MD', range: '$18,400 – $24,900' }, brief: 'ALCO PRODUCTS / Preliminary estimate\nWall area: 1,820 sq ft' };
const reply = () => ({ headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } });
const post = (body, headers = {}) => ({ method: 'POST', headers: { host: 'curbquote.example', 'content-type': 'application/json', ...headers }, socket: { remoteAddress: '203.0.113.9' }, body: JSON.stringify(body) });

test('the lead endpoint reports where requests go without exposing the webhook', async () => {
  assert.deepEqual(leadConfig({ LEAD_WEBHOOK_URL: 'http://insecure.example', LEAD_EMAIL: 'not an email' }), { webhook: null, email: null });
  const res = reply();
  await createLeadHandler({ env: { LEAD_WEBHOOK_URL: WEBHOOK, LEAD_EMAIL: 'estimates@alco.example' } })({ method: 'GET', headers: {} }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.data, { configured: true, email: 'estimates@alco.example' });
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.doesNotMatch(JSON.stringify(res.data), /hooks\.example/);
});

test('a valid lead is forwarded to the webhook once, and bad requests never reach it', async () => {
  const sent = [];
  const handler = createLeadHandler({ env: { LEAD_WEBHOOK_URL: WEBHOOK }, allow: () => true, now: () => new Date('2026-10-23T12:00:00Z'), fetchImpl: async (url, options) => { sent.push({ url, options }); return { ok: true }; } });
  let res = reply();
  await handler(post(lead), res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.data, { sent: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, WEBHOOK);
  assert.equal(sent[0].options.redirect, 'error');
  assert.deepEqual(JSON.parse(sent[0].options.body), { source: 'CurbQuote', submittedAt: '2026-10-23T12:00:00.000Z', contact: lead.contact, estimate: lead.estimate, brief: lead.brief });

  for (const [request, code] of [
    [post({ ...lead, consent: false }), 400],
    [post({ ...lead, contact: { ...lead.contact, email: 'pat' } }), 400],
    [post({ ...lead, contact: { ...lead.contact, phone: '<script>' } }), 400],
    [post({ ...lead, extra: 1 }), 400],
    [post({ ...lead, brief: 'x'.repeat(25000) }), 413],
    [post(lead, { origin: 'https://elsewhere.example' }), 403],
    [post(lead, { 'content-type': 'text/plain' }), 415],
    [{ method: 'PUT', headers: {} }, 405]
  ]) {
    res = reply();
    await handler(request, res);
    assert.equal(res.code, code, JSON.stringify(res.data));
  }
  assert.equal(sent.length, 1);
});

test('without a webhook, or when it fails, the page is told to offer the email instead', async () => {
  let res = reply();
  await createLeadHandler({ env: { LEAD_EMAIL: 'estimates@alco.example' }, fetchImpl: () => assert.fail('no webhook') })(post(lead), res);
  assert.equal(res.code, 503);
  assert.equal(res.data.code, 'LEAD_NOT_CONFIGURED');
  assert.equal(res.data.email, 'estimates@alco.example');

  res = reply();
  await createLeadHandler({ env: { LEAD_WEBHOOK_URL: WEBHOOK, LEAD_EMAIL: 'estimates@alco.example' }, allow: () => true, fetchImpl: async () => ({ ok: false, status: 500 }) })(post(lead), res);
  assert.equal(res.code, 502);
  assert.equal(res.data.code, 'LEAD_DELIVERY_FAILED');

  res = reply();
  await createLeadHandler({ env: { LEAD_WEBHOOK_URL: WEBHOOK }, allow: () => false, fetchImpl: () => assert.fail('limited') })(post(lead), res);
  assert.equal(res.code, 429);
  assert.equal(res.headers['Retry-After'], '600');
});

test('the email version carries the contact details and a shortened summary', () => {
  const link = mailtoLink('estimates@alco.example', { ...lead, brief: `${lead.brief}\n${'Line of detail\n'.repeat(400)}` });
  assert.match(link, /^mailto:estimates@alco\.example\?subject=/);
  const params = new URL(link).searchParams;
  assert.equal(params.get('subject'), 'Estimate request: 12 Example St, Silver Spring, MD');
  const body = params.get('body');
  assert.match(body, /^Name: Pat Homeowner\nEmail: pat@example\.com\nPhone: \(301\) 555-0100\n\nALCO PRODUCTS/);
  assert.ok(body.length < 1900, body.length);
  assert.match(body, /Shortened/);
});
