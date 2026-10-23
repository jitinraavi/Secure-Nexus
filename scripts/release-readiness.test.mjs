import test from 'node:test';
import assert from 'node:assert/strict';
import { successfulGate, validateRelease, releaseReadiness } from './release-readiness.mjs';

const sha = 'a'.repeat(40), base = { id: 101, repository: { full_name: 'fixture/repo' }, head_repository: { full_name: 'fixture/repo' }, head_sha: sha, head_branch: 'main', event: 'push', path: '.github/workflows/ci.yml', run_number: 1, run_attempt: 1, status: 'completed', conclusion: 'success' };
const jobs = ['verify', 'backup-drill', 'release-gate'].map(name => ({ name, run_id: base.id, head_sha: sha, status: 'completed', conclusion: 'success' }));
test('release gate is bound to full SHA, branch, workflow and newest run', () => {
  assert.throws(() => validateRelease({ repository: 'fixture/repo', commit: 'abcd' }));
  assert.equal(successfulGate([base], sha, 'main'), true);
  for (const update of [{ head_sha: 'b'.repeat(40) }, { head_branch: 'preview' }, { event: 'pull_request' }, { path: '.github/workflows/fake.yml' }, { conclusion: 'failure' }]) assert.equal(successfulGate([{ ...base, ...update }], sha, 'main'), false);
  assert.equal(successfulGate([base, { ...base, run_number: 2, status: 'in_progress', conclusion: null }], sha, 'main'), false);
  assert.equal(successfulGate([base, { ...base, run_attempt: 2, conclusion: 'failure' }], sha, 'main'), false);
});
test('release gate refuses stale production-branch SHA and produces no deployment', async () => {
  const env = { GITHUB_REPOSITORY: 'fixture/repo', RELEASE_COMMIT: sha };
  await assert.rejects(releaseReadiness(env, async () => Response.json({ commit: { sha: 'b'.repeat(40) } })), /current/);
  const result = await releaseReadiness(env, async url => Response.json(url.includes('/branches/') ? { commit: { sha } } : url.includes('/jobs?') ? { total_count: jobs.length, jobs } : { workflow_runs: [base] }));
  assert.equal(result.ok, true); assert.equal(result.deploymentPerformed, false);
});
