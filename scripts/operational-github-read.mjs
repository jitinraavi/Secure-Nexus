// Read-only GitHub evidence using an existing Git Credential Manager login.
// Credentials remain in process memory and are never returned in the report.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function repositoryEvidence(repositoryPath, repository, request = fetch) {
  if (!repositoryPath || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '')) throw new Error('Supply an explicit local repository path and owner/repository');
  const credential = await new Promise((resolveCredential, reject) => {
    const child = spawn('git', ['-C', repositoryPath, 'credential', 'fill'], {
      windowsHide: true, shell: false,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Existing GitHub credential lookup timed out')); }, 15000);
    const chunks = []; let size = 0;
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 65536) { child.kill(); reject(new Error('Credential response exceeded limit')); } else chunks.push(chunk); });
    child.stderr.resume();
    child.on('error', () => { clearTimeout(timer); reject(new Error('Git credential helper unavailable')); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error('Existing noninteractive GitHub credential unavailable'));
      const fields = new Map(Buffer.concat(chunks).toString('utf8').split(/\r?\n/).filter(line => line.includes('=')).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
      if (!fields.get('password')) return reject(new Error('GitHub credential unavailable'));
      resolveCredential(fields.get('password'));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(`protocol=https\nhost=github.com\npath=${repository}.git\n\n`);
  });
  const headers = { authorization: `Bearer ${credential}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  // The fixed API host and fixed GET-only paths prevent using this as a general
  // credential-bearing proxy or a write tool.
  async function get(path) {
    const response = await request(`https://api.github.com/repos/${repository}/${path}`, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('GitHub evidence unavailable');
    return response.json();
  }
  const repo = await get('');
  const branch = await get(`branches/${encodeURIComponent(repo.default_branch)}`);
  const workflows = await get('actions/workflows?per_page=100');
  const runs = await get('actions/runs?per_page=10');
  const secretNames = await get('actions/secrets?per_page=100').then(value => value.secrets.map(secret => secret.name)).catch(() => null);
  const variableNames = await get('actions/variables?per_page=100').then(value => value.variables.map(variable => variable.name)).catch(() => null);
  return { repository: repo.full_name, visibility: repo.visibility, private: repo.private,
    defaultBranch: repo.default_branch, defaultBranchProtected: branch.protected, defaultBranchCommit: branch.commit.sha,
    permissions: repo.permissions, checkedAt: new Date().toISOString(),
    workflows: workflows.workflows.map(value => ({ name: value.name, path: value.path, state: value.state, url: value.html_url })),
    recentRuns: runs.workflow_runs.map(value => ({ id: value.id, workflow: value.name, branch: value.head_branch, commit: value.head_sha, event: value.event, status: value.status, conclusion: value.conclusion, runAttempt: value.run_attempt, url: value.html_url })),
    secretNames, variableNames,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  repositoryEvidence(process.argv[2], process.argv[3]).then(result => console.log(JSON.stringify(result, null, 2))).catch(() => { console.error('Read-only GitHub evidence unavailable. Check the explicit repository and existing noninteractive Git credential login. No credential was printed.'); process.exitCode = 1; });
}
