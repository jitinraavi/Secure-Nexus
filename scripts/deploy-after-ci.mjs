import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { releaseReadiness, requestReleaseJson, validateRelease } from './release-readiness.mjs';

export const DEPLOYMENT_REPOSITORY = 'jitinraavi/Secure-Nexus';
export const DEPLOYMENT_PROJECT = 'prj_1blxFgztH32acCvngFaCVr4MqdGJ';

export function approvedDeployHook(value) {
  let hook;
  try { hook = new URL(value); } catch { throw new Error('A valid production deploy hook is required'); }
  const path = new RegExp(`^/v1/integrations/deploy/${DEPLOYMENT_PROJECT}/[A-Za-z0-9_-]{10,256}$`);
  if (hook.origin !== 'https://api.vercel.com' || hook.username || hook.password || hook.search || hook.hash || !path.test(hook.pathname)) throw new Error('The deploy hook must belong to the configured Vercel project');
  return hook;
}
export function vercelBuildTarget(env) {
  if (!['production', 'preview'].includes(env.VERCEL_ENV)) throw new Error('The Vercel deployment environment must be explicit');
  const gitRepository = env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG ? `${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}` : null;
  if (gitRepository && gitRepository.toLowerCase() !== DEPLOYMENT_REPOSITORY.toLowerCase()) throw new Error('Vercel Git metadata does not match the configured repository');
  if (env.VERCEL_GIT_COMMIT_SHA && env.GROUNDWORK_RELEASE_COMMIT && env.VERCEL_GIT_COMMIT_SHA !== env.GROUNDWORK_RELEASE_COMMIT) throw new Error('Explicit release commit disagrees with Vercel Git metadata');
  if (env.VERCEL_GIT_COMMIT_REF && env.GROUNDWORK_RELEASE_BRANCH && env.VERCEL_GIT_COMMIT_REF !== env.GROUNDWORK_RELEASE_BRANCH) throw new Error('Explicit release branch disagrees with Vercel Git metadata');
  const branch = env.VERCEL_GIT_COMMIT_REF || env.GROUNDWORK_RELEASE_BRANCH || (env.VERCEL_ENV === 'production' ? 'main' : '');
  if (env.VERCEL_ENV === 'production' && branch !== 'main') throw new Error('Production deployments require the main branch');
  return validateRelease({ repository: DEPLOYMENT_REPOSITORY, commit: env.VERCEL_GIT_COMMIT_SHA || env.GROUNDWORK_RELEASE_COMMIT, branch });
}
/** Vercel executes this before building Git-hook or CLI deployments. Preview
 * commits require successful CI for their own branch; production requires main.
 * Public GitHub evidence needs no persistent Vercel-side GitHub credential. */
export async function guardVercelBuild(env = process.env, request = fetch) {
  const target = vercelBuildTarget(env);
  const evidence = await releaseReadiness({ GITHUB_REPOSITORY: target.repository, RELEASE_COMMIT: target.commit, RELEASE_BRANCH: target.branch }, request);
  return { ...evidence, environment: env.VERCEL_ENV, buildPermitted: true };
}
/** A workflow_run job receives only its short-lived read-only GitHub token and
 * this one project-scoped hook. A lost POST acknowledgement is never retried. */
export async function deployAfterCi(env = process.env, request = fetch, { checkOnly = false } = {}) {
  if (env.GITHUB_EVENT_NAME !== 'workflow_run' || env.GITHUB_REPOSITORY !== DEPLOYMENT_REPOSITORY || env.RELEASE_BRANCH !== 'main' ||
      !/^[1-9]\d*$/.test(env.RELEASE_RUN_ID || '') || !/^[1-9]\d*$/.test(env.RELEASE_RUN_ATTEMPT || '')) throw new Error('Production deployment requires the matching completed main CI event');
  const evidence = await releaseReadiness(env, request);
  if (checkOnly) return { ...evidence, hookTriggered: false };
  const hook = approvedDeployHook(env.VERCEL_DEPLOY_HOOK);
  let result;
  try { result = await requestReleaseJson(request, hook.href, { method: 'POST', headers: { accept: 'application/json' } }, 16_384); }
  catch { throw new Error('Deploy hook acknowledgement was not confirmed; inspect Vercel before retrying'); }
  if (!result?.job || typeof result.job.id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(result.job.id) || result.job.state !== 'PENDING') throw new Error('Deploy hook acknowledgement was not confirmed; inspect Vercel before retrying');
  return { ...evidence, hookTriggered: true, deploymentJobId: result.job.id, deploymentState: result.job.state };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const action = args.length === 1 && args[0] === '--build-guard' ? guardVercelBuild : args.length === 1 && args[0] === '--check' ? (env => deployAfterCi(env, fetch, { checkOnly: true })) : args.length === 0 ? deployAfterCi : null;
  if (!action) { console.error('Use --build-guard, --check, or no arguments for the authorized CI hook trigger.'); process.exitCode = 1; }
  else action().then(result => console.log(JSON.stringify(result))).catch(() => { console.error('Deployment gate refused: exact current branch commit, latest successful CI, required verification jobs and configured target are required. Hook failures require inspection before retry.'); process.exitCode = 1; });
}
