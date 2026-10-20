import fs from 'node:fs';
import path from 'node:path';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';

// Read-only readiness checks. Configuration values are never printed.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const known = new Set(['--build-only', '--check-build', '--env-file']);
const failures = [];
const warnings = [];
const fail = (message) => failures.push(message);
for (let i = 0; i < args.length; i += 1) {
  if (!known.has(args[i])) { fail('Unknown argument; use --build-only, --check-build or --env-file <path>.'); break; }
  if (args[i] === '--env-file') {
    const filename = args[++i];
    try {
      if (!filename) throw new Error();
      process.loadEnvFile(path.resolve(filename));
    } catch { fail('Could not load the requested environment file.'); }
  }
}
const env = process.env;
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) fail('Node 22.12 or newer is required.');

function httpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      && url.pathname === '/' && !url.search && !url.hash;
  } catch { return false; }
}
function key(value) {
  return typeof value === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(value)
    && Buffer.from(value, 'base64').length === 32
    && Buffer.from(value, 'base64').toString('base64') === value;
}
function group(names, label) {
  const present = names.filter((name) => Boolean(env[name]));
  if (present.length > 0 && present.length !== names.length) fail(`${label} configuration is incomplete; see docs/DEPLOYMENT.md.`);
  return present.length === names.length;
}

if (!args.includes('--build-only')) {
  if (env.NODE_ENV !== 'production') fail('NODE_ENV must be production.');
  if (env.PAYMENTS_MODE !== 'live') fail('PAYMENTS_MODE must be live.');
  if (!key(env.MASTER_KEY)) fail('MASTER_KEY must be a stable canonical base64-encoded 32-byte key.');
  const databaseProvider = env.DATABASE_PROVIDER || (env.DATABASE_URL || env.SUPABASE_DB_URL ? 'supabase' : 'sqlite');
  if (!['supabase', 'sqlite'].includes(databaseProvider)) fail('DATABASE_PROVIDER must be supabase or sqlite.');
  if (databaseProvider === 'supabase') {
    try {
      const database = new URL(env.DATABASE_URL || env.SUPABASE_DB_URL || '');
      if (!['postgres:', 'postgresql:'].includes(database.protocol) || !database.hostname || !database.username || !database.password) throw new Error();
      if (decodeURIComponent(database.username).split('.')[0] === 'postgres') fail('Use a dedicated database runtime role, not the Supabase administrator.');
    } catch { fail('Supabase requires a valid server-only DATABASE_URL.'); }
    if (env.DATABASE_ADMIN_URL) fail('Remove DATABASE_ADMIN_URL from the web runtime; provide it only to migration/import commands.');
    if (env.DATABASE_SSL_CA_FILE) {
      try { if (!fs.statSync(path.resolve(env.DATABASE_SSL_CA_FILE)).isFile()) throw new Error(); }
      catch { fail('DATABASE_SSL_CA_FILE must identify the provisioned Supabase CA certificate.'); }
    }
  }
  if (env.PREVIOUS_MASTER_KEY && !key(env.PREVIOUS_MASTER_KEY)) fail('PREVIOUS_MASTER_KEY must be a canonical base64-encoded 32-byte key.');
  const directory = env.GROUNDWORK_DATA_DIR;
  if (!directory || !path.isAbsolute(directory)) fail('GROUNDWORK_DATA_DIR must be an absolute path on persistent storage.');
  else {
    try {
      if (!fs.statSync(directory).isDirectory()) throw new Error();
      fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
    } catch { fail('GROUNDWORK_DATA_DIR must already exist and be writable by the runtime user.'); }
  }
  if (databaseProvider === 'sqlite' && env.DB_PATH) {
    try {
      if (!path.isAbsolute(env.DB_PATH) || !fs.statSync(env.DB_PATH).isDirectory()) throw new Error();
      fs.accessSync(env.DB_PATH, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
    } catch { fail('DB_PATH, when set, must be a writable absolute database directory on persistent storage.'); }
  }
  if (!httpsOrigin(env.PUBLIC_APP_ORIGIN || env.RENDER_EXTERNAL_URL || '')) fail('PUBLIC_APP_ORIGIN must be a fixed HTTPS origin without credentials, path or query.');
  if ((env.GROUNDWORK_SERVER_ROLE || 'authority') !== 'authority') fail('This deployment recipe supports one authority; secondary hosts require their separate topology recipe.');
  const mode = env.GROUNDWORK_AUTHORITY_GATEWAY_MODE || 'direct';
  if (!['direct', 'required'].includes(mode)) fail('GROUNDWORK_AUTHORITY_GATEWAY_MODE must be direct or required.');
  if (mode === 'required') {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(env.GROUNDWORK_AUTHORITY_ID || '')) fail('Required gateway mode needs a stable valid GROUNDWORK_AUTHORITY_ID.');
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(env.GROUNDWORK_GATEWAY_SECRET || '')) fail('Required gateway mode needs a provisioned base64url GROUNDWORK_GATEWAY_SECRET.');
    if (!httpsOrigin(env.PUBLIC_APP_ORIGIN || '')) fail('Required gateway mode needs an explicit PUBLIC_APP_ORIGIN.');
    warnings.push('Required gateway mode needs an authenticated health probe; the supplied Docker/Render health checks target direct mode.');
  }
  if (env.GROUNDWORK_AUTHORITY_URL) fail('An authority must not configure GROUNDWORK_AUTHORITY_URL.');
  const proxies = (env.GROUNDWORK_TRUSTED_PROXY_IPS || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (proxies.length > 32 || proxies.some((value) => !isIP(value))) fail('GROUNDWORK_TRUSTED_PROXY_IPS must contain at most 32 exact IP addresses.');
  if (!proxies.length && mode === 'direct') warnings.push('No forwarding proxies are trusted; verify per-client rate limiting behind your actual TLS proxy.');
  const provider = (env.MAIL_PROVIDER || '').toLowerCase();
  if (!['smtp', 'resend'].includes(provider)) fail('MAIL_PROVIDER must explicitly select smtp or resend.');
  if (!env.MAIL_FROM || !/[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/.test(env.MAIL_FROM)) fail('MAIL_FROM must identify your verified sender.');
  if (provider === 'smtp') {
    if (!env.MAIL_HOST || !env.MAIL_USER || !env.MAIL_PASS) fail('SMTP requires MAIL_HOST, MAIL_USER and MAIL_PASS.');
    const port = Number(env.MAIL_PORT || 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail('MAIL_PORT must be a valid TCP port.');
    if (env.MAIL_SECURE && !['true', 'false'].includes(env.MAIL_SECURE)) fail('MAIL_SECURE must be true or false.');
    if ((port === 465 && env.MAIL_SECURE === 'false') || (port === 587 && env.MAIL_SECURE === 'true')) fail('SMTP port 465 requires MAIL_SECURE=true; port 587 requires MAIL_SECURE=false for STARTTLS.');
  }
  if (provider === 'resend' && !env.RESEND_API_KEY) fail('Resend requires RESEND_API_KEY.');
  const razorpay = group(['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'RAZORPAY_ACCOUNT_ID'], 'Razorpay');
  const paypal = group(['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_MERCHANT_ID'], 'PayPal');
  if (razorpay && (!env.RAZORPAY_KEY_ID.startsWith('rzp_live_') || !/^acc_[A-Za-z0-9]+$/.test(env.RAZORPAY_ACCOUNT_ID))) fail('Razorpay requires a live key and valid merchant account identifier.');
  if (paypal && env.PAYPAL_MODE !== 'live') fail('PayPal checkout requires PAYPAL_MODE=live.');
  if (!razorpay && !paypal) warnings.push('No live payment provider is configured; paid checkout remains unavailable.');
  if (env.ORGANIZATION_SEAT_PRICE_INR_MINOR || env.ORGANIZATION_SEAT_TERM_DAYS) {
    const price = Number(env.ORGANIZATION_SEAT_PRICE_INR_MINOR), days = Number(env.ORGANIZATION_SEAT_TERM_DAYS);
    if (!razorpay || !Number.isSafeInteger(price) || price < 100 || price > 100000000 || !Number.isSafeInteger(days) || days < 1 || days > 365) fail('Tenant checkout requires live Razorpay plus valid explicit seat price and term.');
  }
  if (env.GROUNDWORK_DEV_OTP === '1' || env.GROUNDWORK_SEED_DEMO === '1') fail('Development OTP disclosure and demo seeding must be disabled in production.');
  if (env.NATIVE_WORKER_ENABLED === 'true' || env.NATIVE_ISOLATION_ACKNOWLEDGED === 'true') fail('The supplied web deployment has no acceptance-tested native worker; keep native execution disabled.');
}

if (args.includes('--build-only') || args.includes('--check-build')) {
  for (const filename of ['client/dist/index.html', 'client/dist/studio.html', 'server/dist/index.js', 'server/dist/authorityServer.js']) {
    try { if (!fs.statSync(path.join(root, filename)).isFile()) throw new Error(); }
    catch { fail(`Missing built artifact: ${filename}. Run npm run build.`); }
  }
}
for (const message of warnings) console.warn(`[deployment] Warning: ${message}`);
for (const message of failures) console.error(`[deployment] ${message}`);
if (failures.length) {
  console.error(`[deployment] Not ready: ${failures.length} check(s) failed. No configuration values were printed.`);
  process.exitCode = 1;
} else console.log('[deployment] Readiness checks passed. Live TLS, provider delivery, payment callbacks and backup restoration still require operator verification.');
