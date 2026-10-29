import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('..', import.meta.url));
function run(executable, args) {
  const result = spawnSync(executable, args, { cwd, stdio: 'inherit', shell: false, timeout: 120_000, windowsHide: true });
  if (result.error) {
    console.error('IFC acceptance tooling could not run. Install scripts/ifc-validation-requirements.txt in an isolated Python 3.12 environment and set GROUNDWORK_IFC_PYTHON to its executable.');
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.execPath, ['--import', 'tsx', 'scripts/generate-ifc-validation-fixtures.mjs']);
run(process.env.GROUNDWORK_IFC_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['scripts/validate-ifc-external.py']);
