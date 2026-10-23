import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { approvedDeployHook, deployAfterCi, guardVercelBuild, vercelBuildTarget, DEPLOYMENT_PROJECT, DEPLOYMENT_REPOSITORY } from './deploy-after-ci.mjs';
import { releaseReadiness, requestReleaseJson } from './release-readiness.mjs';

const commit = 'a'.repeat(40), otherCommit = 'b'.repeat(40);
const hook = `https://api.vercel.com/v1/integrations/deploy/${DEPLOYMENT_PROJECT}/isolated-hook-fixture`;
const environment = () => ({ GITHUB_EVENT_NAME: 'workflow_run', GITHUB_REPOSITORY: DEPLOYMENT_REPOSITORY, RELEASE_COMMIT: commit, RELEASE_BRANCH: 'main', RELEASE_RUN_ID: '101', RELEASE_RUN_ATTEMPT: '1', GITHUB_TOKEN: 'ephemeral-isolated-github-token', VERCEL_DEPLOY_HOOK: hook });
const run = (update = {}) => ({ id: 101, repository: { full_name: DEPLOYMENT_REPOSITORY }, head_repository: { full_name: DEPLOYMENT_REPOSITORY }, head_sha: commit, head_branch: 'main', event: 'push', path: '.github/workflows/ci.yml', run_number: 5, run_attempt: 1, status: 'completed', conclusion: 'success', ...update });
const jobs = (update = {}) => ['verify', 'backup-drill', 'release-gate'].map(name => ({ name, run_id: 101, head_sha: commit, status: 'completed', conclusion: 'success', ...(update[name] || {}) }));
function fakeGithub({ runs = [run()], refreshedRuns = runs, jobList = jobs(), branchCommits = [commit], hookResponse = { job: { id: 'isolated-job', state: 'PENDING' } } } = {}) {
  const calls = []; let branchReads = 0, runReads = 0;
  const request = async (url, init = {}) => {
    const value = String(url); calls.push({ url: value, init });
    if (value === hook) return Response.json(hookResponse);
    assert.ok(value.startsWith(`https://api.github.com/repos/${DEPLOYMENT_REPOSITORY}/`));
    if (value.includes('/branches/')) return Response.json({ commit: { sha: branchCommits[Math.min(branchReads++, branchCommits.length - 1)] } });
    if (value.includes('/jobs?')) return Response.json({ total_count: jobList.length, jobs: jobList });
    return Response.json({ workflow_runs: runReads++ === 0 ? runs : refreshedRuns });
  };
  return { calls, request };
}

test('production deploy calls one project hook only after exact main CI and all required jobs pass', async () => {
  const fake = fakeGithub();
  const result = await deployAfterCi(environment(), fake.request);
  assert.equal(result.hookTriggered, true); assert.equal(result.deploymentJobId, 'isolated-job');
  assert.equal(result.deploymentPerformed, false, 'a pending hook acknowledgement is not a completed deployment');
  assert.equal(fake.calls.filter(call => call.url === hook).length, 1);
  const call = fake.calls.at(-1);
  assert.equal(call.url, hook); assert.equal(call.init.method, 'POST'); assert.equal(call.init.redirect, 'error');
  assert.equal(call.init.body, undefined); assert.equal(new Headers(call.init.headers).has('authorization'), false, 'the GitHub token must not reach Vercel');
  assert.equal(JSON.stringify(result).includes('isolated-hook-fixture'), false);
  for (const item of fake.calls.slice(0, -1)) assert.equal(new Headers(item.init.headers).get('authorization'), 'Bearer ephemeral-isolated-github-token');
});

test('stale, foreign, failed, incomplete and rerun CI evidence can never trigger the hook', async () => {
  const cases = [
    { branchCommits: [otherCommit] },
    { branchCommits: [commit, otherCommit] },
    { runs: [run({ head_sha: otherCommit })] },
    { runs: [run({ head_branch: 'preview' })] },
    { runs: [run({ event: 'pull_request' })] },
    { runs: [run({ path: '.github/workflows/forged.yml' })] },
    { runs: [run({ head_repository: { full_name: 'another/fork' } })] },
    { runs: [run({ conclusion: 'failure' })] },
    { runs: [run(), run({ id: 102, run_number: 6, status: 'in_progress', conclusion: null })] },
    { runs: [run({ run_attempt: 2 })] },
    { refreshedRuns: [run({ run_attempt: 2, status: 'in_progress', conclusion: null })] },
    { refreshedRuns: [run(), run({ id: 102, run_number: 6, status: 'queued', conclusion: null })] },
    { jobList: jobs({ 'backup-drill': { conclusion: 'failure' } }) },
    { jobList: jobs({ verify: { conclusion: 'skipped' } }) },
    { jobList: jobs({ verify: { run_id: 999 } }) },
    { jobList: jobs({ verify: { head_sha: otherCommit } }) },
    { jobList: jobs().filter(job => job.name !== 'release-gate') },
  ];
  for (const fixture of cases) {
    const fake = fakeGithub(fixture);
    await assert.rejects(deployAfterCi(environment(), fake.request));
    assert.equal(fake.calls.some(call => call.url === hook), false);
  }
  for (const update of [{ GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REPOSITORY: 'another/repo' }, { RELEASE_BRANCH: 'preview' }, { RELEASE_RUN_ID: 'bad' }, { RELEASE_RUN_ATTEMPT: '0' }]) {
    const fake = fakeGithub(); await assert.rejects(deployAfterCi({ ...environment(), ...update }, fake.request)); assert.equal(fake.calls.length, 0);
  }
});

test('hook URL validation prevents redirects, credential leakage and wrong-project deployments', () => {
  assert.equal(approvedDeployHook(hook).href, hook);
  for (const value of [hook.replace('https:', 'http:'), hook.replace('api.vercel.com', 'attacker.example'), hook.replace(DEPLOYMENT_PROJECT, 'prj_wrong'), hook + '?copy=secret', hook + '#secret', hook.replace('api.vercel.com', 'token@api.vercel.com')]) assert.throws(() => approvedDeployHook(value));
});

test('ambiguous hook delivery is single-attempt and error messages never contain the hook secret', async () => {
  const fake = fakeGithub(); let attempts = 0;
  await assert.rejects(deployAfterCi(environment(), async (url, init) => {
    if (String(url) !== hook) return fake.request(url, init);
    attempts += 1; throw new Error(`lost acknowledgement from ${hook}`);
  }), error => error.message.includes('not confirmed') && !error.message.includes('isolated-hook-fixture'));
  assert.equal(attempts, 1);
  const invalid = fakeGithub({ hookResponse: { error: hook } });
  await assert.rejects(deployAfterCi(environment(), invalid.request), error => !error.message.includes('isolated-hook-fixture'));
  const check = fakeGithub();
  assert.equal((await deployAfterCi(environment(), check.request, { checkOnly: true })).hookTriggered, false);
  assert.equal(check.calls.some(call => call.url === hook), false);
});

test('Vercel build guard checks production main and preview branch CI with anonymous public GitHub evidence', async () => {
  const env = { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: commit, VERCEL_GIT_COMMIT_REF: 'main', GITHUB_TOKEN: 'must-not-be-sent' };
  const production = fakeGithub();
  assert.equal((await guardVercelBuild(env, production.request)).buildPermitted, true);
  for (const call of production.calls) assert.equal(new Headers(call.init.headers).has('authorization'), false);
  const branch = 'codex/review';
  const preview = fakeGithub({ runs: [run({ head_branch: branch, path: `.github/workflows/ci.yml@refs/heads/${branch}` })] });
  assert.equal((await guardVercelBuild({ ...env, VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: branch }, preview.request)).branch, branch);
  assert.ok(preview.calls.some(call => call.url.includes('branches/codex%2Freview')));
  assert.equal(vercelBuildTarget({ VERCEL_ENV: 'production', GROUNDWORK_RELEASE_COMMIT: commit }).commit, commit);
  for (const update of [{ VERCEL_ENV: '' }, { VERCEL_GIT_COMMIT_REF: branch }, { VERCEL_GIT_COMMIT_SHA: '' }, { GROUNDWORK_RELEASE_COMMIT: otherCommit }, { GROUNDWORK_RELEASE_BRANCH: branch }, { VERCEL_GIT_REPO_OWNER: 'another', VERCEL_GIT_REPO_SLUG: 'repo' }]) assert.throws(() => vercelBuildTarget({ ...env, ...update }));
});

test('release evidence limits cover streamed response bodies after headers', async () => {
  let connectionSignal;
  await assert.rejects(requestReleaseJson(async (_url, init) => { connectionSignal = init.signal; return new Promise(() => undefined); }, 'https://api.github.com/fixture', {}, 100, 10), /timed out/);
  assert.equal(connectionSignal.aborted, true);
  let cancelled = false;
  const stalled = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel() { cancelled = true; } }));
  await assert.rejects(requestReleaseJson(stalled, 'https://api.github.com/fixture', {}, 100, 10), /timed out/);
  assert.equal(cancelled, true);
  await assert.rejects(requestReleaseJson(async () => Response.json({ huge: 'a'.repeat(200) }), 'https://api.github.com/fixture', {}, 100), /limit/);
  await assert.rejects(releaseReadiness(environment(), async () => new Response('unavailable', { status: 503 })), /rejected/);
});

test('deployment workflow uses only completed successful main CI and keeps the hook out of dependency steps', async () => {
  const workflow = await readFile(new URL('../.github/workflows/deploy-production.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_run:/); assert.match(workflow, /types: \[completed\]/); assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /conclusion == 'success'/); assert.match(workflow, /workflow_run\.event == 'push'/);
  assert.match(workflow, /persist-credentials: false/); assert.match(workflow, /actions: read/);
  assert.doesNotMatch(workflow, /npm (?:ci|install)|VERCEL_TOKEN|pull_request_target:|workflow_dispatch:/);
  assert.equal((workflow.match(/secrets\.VERCEL_DEPLOY_HOOK/g) || []).length, 1);
});
