import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mergeMailEnvironment } from './mail-environment.mjs';

const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const dotenv = serverRequire('dotenv');
const nodemailer = serverRequire('nodemailer');

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filename = path.join(repository, 'server/.env');
const args = process.argv.slice(2);

function help() {
  console.log('Groundwork Gmail SMTP setup\n\n  npm run mail:setup    Prompt privately, verify Gmail authentication, save server/.env\n  npm run mail:verify   Verify existing Gmail settings without sending an email\n\nUse a Google app password, not your normal Google password. Password input is hidden.\nExisting settings and the encryption key are preserved. Restart the API after setup.\nGuide: docs/GMAIL-OTP.md');
}
function failure(error) {
  if (error?.code === 'EAUTH' || error?.responseCode === 535) return 'Gmail rejected authentication. Check the full sender address and Google app password. A normal Google password will not work.';
  if (error?.code === 'ETIMEDOUT') return 'The Gmail connection timed out. Check outbound SMTP access on port 465 and retry.';
  if (['ESOCKET', 'ECONNECTION', 'ECONNREFUSED', 'EDNS', 'ENOTFOUND'].includes(error?.code)) return 'Could not establish a secure connection to Gmail. Check DNS, network access and the sender settings.';
  return 'Gmail verification failed. No settings were changed. Check the account security settings and outbound SMTP access.';
}
function credentials(email, password) {
  const user = String(email || '').trim();
  const pass = String(password || '').replace(/\s/g, '');
  if (!/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(user) || user.length > 254) {
    throw new Error('Enter the complete Google sender email address.');
  }
  if (!/^[A-Za-z0-9]{16}$/.test(pass)) throw new Error('Enter the 16-character Google app password. Do not use your normal Google password.');
  return { user, pass };
}
async function verify(settings) {
  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: settings, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
  });
  try { await transport.verify(); }
  finally { transport.close(); }
}
async function main() {
  if (args.includes('--help') || args.includes('-h')) { help(); return; }
  if (args.some((arg) => arg !== '--verify')) throw new Error('Unknown argument. Run npm run mail:setup -- --help.');
  if (fs.existsSync(filename) && fs.lstatSync(filename).isSymbolicLink()) throw new Error('Refusing to overwrite an environment file that is a symbolic link.');
  const original = fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : '';
  const existing = dotenv.parse(original);
  if (args.includes('--verify')) {
    const settings = { ...existing, ...process.env };
    if (String(settings.MAIL_HOST || '').trim().toLowerCase() !== 'smtp.gmail.com'
      || String(settings.MAIL_PROVIDER || 'smtp').trim().toLowerCase() !== 'smtp') {
      throw new Error('Gmail SMTP is not configured. Run npm run mail:setup first.');
    }
    const port = Number(settings.MAIL_PORT || 587);
    const secure = settings.MAIL_SECURE === undefined || settings.MAIL_SECURE === '' ? port === 465 : settings.MAIL_SECURE === 'true';
    if (![465, 587].includes(port) || (port === 465 && !secure) || (port === 587 && secure)) throw new Error('Gmail requires port 465 with MAIL_SECURE=true, or port 587 with MAIL_SECURE=false.');
    const account = credentials(settings.MAIL_USER, settings.MAIL_PASS);
    const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port, secure, requireTLS: !secure, auth: account, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000 });
    try { await transport.verify(); } catch (error) { throw new Error(failure(error)); }
    finally { transport.close(); }
    console.log('Gmail connection and authentication verified. No email was sent. Inbox delivery must be checked by requesting a login code.');
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run npm run mail:setup in an interactive local terminal. Do not pass passwords as command arguments or paste them into chat.');
  let muted = false;
  const output = new Writable({ write(chunk, _encoding, callback) { if (!muted) process.stdout.write(chunk); callback(); } });
  const prompt = createInterface({ input: process.stdin, output, terminal: true, historySize: 0 });
  let account;
  try {
    console.log('Configure Gmail SMTP. Your normal Google password is not accepted.');
    const user = await prompt.question('Google sender email address: ');
    process.stdout.write('Google app password (hidden): ');
    muted = true;
    const pass = await prompt.question('');
    muted = false;
    process.stdout.write('\n');
    account = credentials(user, pass);
  } finally { muted = false; prompt.close(); }
  console.log('Verifying the secure Gmail connection…');
  try { await verify(account); } catch (error) { throw new Error(failure(error)); }
  // Detect edits made while the user was entering credentials or verification ran.
  if ((fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : '') !== original) throw new Error('server/.env changed during setup. No settings were overwritten; run setup again.');
  const mailSettings = {
    MAIL_PROVIDER: 'smtp', MAIL_HOST: 'smtp.gmail.com', MAIL_PORT: '465', MAIL_SECURE: 'true',
    MAIL_USER: account.user, MAIL_PASS: account.pass, MAIL_FROM: `Groundwork <${account.user}>`,
  };
  const merged = mergeMailEnvironment(original, mailSettings);
  const updated = dotenv.parse(merged);
  for (const name of Object.keys(existing)) {
    if (!Object.hasOwn(mailSettings, name) && updated[name] !== existing[name]) throw new Error('An unrelated environment setting would change. No settings were written; review server/.env locally.');
  }
  const temporary = path.join(path.dirname(filename), `.env.gmail-setup-${randomBytes(8).toString('hex')}`);
  try {
    fs.writeFileSync(temporary, merged, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    if (existing.MASTER_KEY !== dotenv.parse(merged).MASTER_KEY) throw new Error('Encryption-key preservation failed. No settings were changed.');
    fs.renameSync(temporary, filename);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  account.pass = '';
  console.log('Gmail authentication verified and mail settings saved privately in server/.env. The existing encryption key was preserved. Restart the Groundwork API, then request a new login code.');
  if (Object.entries(mailSettings).some(([name, value]) => process.env[name] !== undefined && process.env[name] !== value)) console.warn('Mail settings in the process environment override server/.env. Update the process manager or hosting secret store as well.');
}
main().catch((error) => { console.error(`[mail] ${error.message}`); process.exitCode = 1; });
