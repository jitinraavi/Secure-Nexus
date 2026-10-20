export class NewsletterError extends Error {
  constructor(code) {
    super(code);
    this.name = 'NewsletterError';
    this.code = code;
  }
}

/** Only HTTPS services, or the current local HTTP development origin, may receive email. */
export function resolveNewsletterEndpoint(value, baseURL) {
  if (!String(value || '').trim()) return null;
  try {
    const base = new URL(baseURL);
    const endpoint = new URL(String(value).trim(), base);
    const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    const safeProtocol = endpoint.protocol === 'https:'
      || (endpoint.protocol === 'http:' && isLocal && endpoint.origin === base.origin);
    if (!safeProtocol || endpoint.username || endpoint.password || endpoint.hash) return null;
    return endpoint.href;
  } catch {
    return null;
  }
}

export function validateSignup({ email, consent, website = '' }) {
  const normalized = String(email || '').trim();
  if (String(website).trim()) throw new NewsletterError('blocked');
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new NewsletterError('email');
  }
  if (consent !== true) throw new NewsletterError('consent');
  return { email: normalized, consent: true, website: '' };
}

/** A success message is only allowed after the service explicitly confirms subscription. */
export async function subscribeToNewsletter(input, {
  endpoint,
  baseURL,
  fetchImpl = globalThis.fetch,
  signal,
  timeoutMs = 10000,
} = {}) {
  const url = resolveNewsletterEndpoint(endpoint, baseURL);
  if (!url) throw new NewsletterError('unavailable');
  const payload = validateSignup(input);
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) throw new NewsletterError('cancelled');
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) throw new NewsletterError('service');
    const result = await response.json();
    if (result?.subscribed !== true) throw new NewsletterError('unconfirmed');
    return true;
  } catch (error) {
    if (timedOut) throw new NewsletterError('timeout');
    if (signal?.aborted) throw new NewsletterError('cancelled');
    if (error instanceof NewsletterError) throw error;
    throw new NewsletterError('service');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export function initNewsletter({ endpoint = '', baseURL = window.location.href } = {}) {
  const form = document.querySelector('#newsletter-form');
  const status = document.querySelector('#newsletter-status');
  if (!form || !status) return () => {};
  const submit = form.querySelector('[type="submit"]');
  const email = form.elements.namedItem('email');
  const consent = form.elements.namedItem('consent');
  const website = form.elements.namedItem('website');
  const configured = resolveNewsletterEndpoint(endpoint, baseURL);
  let request = null;
  let disposed = false;

  if (!configured) {
    status.textContent = 'Studio notes are coming soon. Contact us to stay in touch.';
    if (submit) {
      submit.disabled = true;
      submit.title = 'Studio notes are coming soon';
    }
    if (email) email.disabled = true;
    if (consent) consent.disabled = true;
  } else {
    if (email) email.disabled = false;
    if (consent) consent.disabled = false;
    if (submit) submit.disabled = false;
    status.textContent = '';
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (request || !configured || !form.reportValidity()) return;
    request = new AbortController();
    if (submit) submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    status.textContent = 'Sending your request…';
    try {
      await subscribeToNewsletter({ email: email.value, consent: consent.checked, website: website.value }, {
        endpoint: configured, baseURL, signal: request.signal,
      });
      if (disposed) return;
      status.textContent = 'You’re on the list. Thank you for joining our studio notes.';
      form.reset();
    } catch (error) {
      if (disposed || error.code === 'cancelled') return;
      status.textContent = error.code === 'timeout'
        ? 'The studio took a little too long to respond. Please try again.'
        : error.code === 'consent'
          ? 'Please agree to receive studio emails before subscribing.'
          : error.code === 'email'
            ? 'Please enter a valid email address.'
            : 'We couldn’t confirm your subscription. Please try again or contact the studio.';
    } finally {
      request = null;
      if (!disposed) {
        if (submit) submit.disabled = false;
        form.removeAttribute('aria-busy');
      }
    }
  }
  form.addEventListener('submit', handleSubmit);
  return () => {
    disposed = true;
    request?.abort();
    form.removeEventListener('submit', handleSubmit);
  };
}
