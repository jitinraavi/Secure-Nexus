import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionProgress, stageAtProgress, stageScrollTarget, safeContactEmail } from '../../studio/ui/runtime-utils.js';

test('scroll progress clamps before and after a pinned section', () => {
  assert.equal(sectionProgress(180, 2400, 1000), 0);
  assert.equal(sectionProgress(-700, 2400, 1000), 0.5);
  assert.equal(sectionProgress(-2800, 2400, 1000), 1);
  assert.equal(sectionProgress(-1, 500, 1000), 1);
});

test('stage targets and selected stages agree throughout the pinned model', () => {
  for (let index = 0; index < 5; index += 1) {
    const target = stageScrollTarget(6000, 2450, 1000, index);
    assert.equal(stageAtProgress(sectionProgress(6000 - target, 2450, 1000)), index);
  }
  assert.equal(stageAtProgress(-2), 0);
  assert.equal(stageAtProgress(2), 4);
});

test('contact customization cannot inject mail headers or a URL scheme', () => {
  assert.equal(safeContactEmail(' design@example.com '), 'design@example.com');
  for (const input of ['javascript:alert(1)', 'hello@example.com?bcc=bad@example.com', 'hello@example.com\r\nBcc:bad@example.com']) {
    assert.equal(safeContactEmail(input), 'hello@groundwork.studio');
  }
});
