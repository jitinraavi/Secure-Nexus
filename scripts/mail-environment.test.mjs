import assert from 'node:assert/strict';
import { test } from 'node:test';
import dotenv from 'dotenv';
import { mergeMailEnvironment } from './mail-environment.mjs';

test('Gmail setup preserves encryption keys and unrelated environment values', () => {
  const original = '# Existing application\nMASTER_KEY="synthetic-current-key"\nPREVIOUS_MASTER_KEY=synthetic-previous-key\nAI_MODEL="test-model"\nMAIL_PASS="old-password"\n';
  const result = mergeMailEnvironment(original, { MAIL_PASS: 'abcdefghijklmnop', MAIL_HOST: 'smtp.gmail.com' });
  const parsed = dotenv.parse(result);
  assert.equal(parsed.MASTER_KEY, 'synthetic-current-key');
  assert.equal(parsed.PREVIOUS_MASTER_KEY, 'synthetic-previous-key');
  assert.equal(parsed.AI_MODEL, 'test-model');
  assert.equal(parsed.MAIL_PASS, 'abcdefghijklmnop');
  assert.match(result, /^# Existing application\n/);
});
test('Gmail setup replaces duplicate mail definitions and preserves Windows line endings', () => {
  const result = mergeMailEnvironment('export MAIL_PORT=587\r\nMAIL_PORT=25\r\nMASTER_KEY=unchanged\r\n', { MAIL_PORT: '465', MAIL_FROM: 'Groundwork <sender@example.invalid>' });
  assert.equal((result.match(/MAIL_PORT=/g) || []).length, 1);
  assert.equal(dotenv.parse(result).MAIL_PORT, '465');
  assert.equal(dotenv.parse(result).MASTER_KEY, 'unchanged');
  assert.equal(dotenv.parse(result).MAIL_FROM, 'Groundwork <sender@example.invalid>');
  assert(!/(?<!\r)\n/.test(result));
});
