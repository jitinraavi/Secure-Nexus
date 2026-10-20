import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNewsletterEndpoint, validateSignup, subscribeToNewsletter } from '../../studio/ui/newsletter.js';

const signup = { email: ' reader@example.com ', consent: true, website: '' };
const baseURL = 'https://groundwork.example/';

test('email only goes to HTTPS or the current local development origin', () => {
  assert.equal(resolveNewsletterEndpoint('/api/subscribe', baseURL), 'https://groundwork.example/api/subscribe');
  assert.equal(resolveNewsletterEndpoint('/subscribe', 'http://localhost:5178/'), 'http://localhost:5178/subscribe');
  for (const endpoint of ['http://other.example/subscribe', 'javascript:alert(1)', 'https://user:pass@example.com/subscribe', 'https://example.com/subscribe#token']) {
    assert.equal(resolveNewsletterEndpoint(endpoint, baseURL), null);
  }
  assert.equal(resolveNewsletterEndpoint('http://localhost:9000/', 'http://localhost:5178/'), null);
  assert.equal(resolveNewsletterEndpoint('/subscribe', 'http://groundwork.example/'), null);
});

test('consent and honeypot are checked before sending anything', () => {
  assert.deepEqual(validateSignup(signup), { email: 'reader@example.com', consent: true, website: '' });
  assert.throws(() => validateSignup({ ...signup, consent: false }), { code: 'consent' });
  assert.throws(() => validateSignup({ ...signup, website: 'bot.example' }), { code: 'blocked' });
  assert.throws(() => validateSignup({ ...signup, email: 'not an email' }), { code: 'email' });
});

test('only an explicit successful service response confirms subscription', async () => {
  let sent;
  const options = { endpoint: '/subscribe', baseURL, fetchImpl: async (url, request) => {
    sent = { url, request };
    return { ok: true, json: async () => ({ subscribed: true }) };
  } };
  assert.equal(await subscribeToNewsletter(signup, options), true);
  assert.equal(sent.url, 'https://groundwork.example/subscribe');
  assert.equal(sent.request.credentials, 'omit');
  assert.equal(sent.request.redirect, 'error');
  assert.deepEqual(JSON.parse(sent.request.body), { email: 'reader@example.com', consent: true, website: '' });
  await assert.rejects(subscribeToNewsletter(signup, { ...options, fetchImpl: async () => ({ ok: true, json: async () => ({ success: true }) }) }), { code: 'unconfirmed' });
  await assert.rejects(subscribeToNewsletter(signup, { ...options, fetchImpl: async () => ({ ok: false }) }), { code: 'service' });
});

test('an unconfigured endpoint never receives email', async () => {
  let called = false;
  await assert.rejects(subscribeToNewsletter(signup, { endpoint: '', baseURL, fetchImpl: () => { called = true; } }), { code: 'unavailable' });
  assert.equal(called, false);
});

test('slow newsletter requests are aborted and remain unconfirmed', async () => {
  await assert.rejects(subscribeToNewsletter(signup, {
    endpoint: '/subscribe', baseURL, timeoutMs: 10,
    fetchImpl: (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }),
  }), { code: 'timeout' });
});
