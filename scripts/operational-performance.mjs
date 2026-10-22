import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { allowedOrigin, probe } from './operational-health.mjs';

export function percentile(values, fraction) {
  if (!values.length || fraction <= 0 || fraction > 1) throw new Error('Invalid percentile samples');
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}
export async function measure(env = process.env, probeTarget = probe) {
  if (env.OPS_PERF_ACK !== 'isolated-target-no-production') throw new Error('Explicit isolated-target acknowledgment is required');
  const origin = allowedOrigin(env.OPS_PERF_ORIGIN, env.OPS_PERF_ALLOWED_ORIGINS, { isolated: true });
  if ((env.OPS_PRODUCTION_ORIGINS || '').split(',').map(value => value.trim()).includes(origin)) throw new Error('Production targets are forbidden for this performance tool');
  // Require the owner to bind a single disposable deployment, independently of the allowlist.
  if (env.OPS_PERF_ISOLATED_ORIGIN !== origin) throw new Error('Bind OPS_PERF_ISOLATED_ORIGIN to the disposable target');
  const count = Number(env.OPS_PERF_SAMPLES || 100), budget = Number(env.OPS_PERF_P99_MS || 2000);
  if (!Number.isInteger(count) || count < 100 || count > 500 || !Number.isFinite(budget) || budget < 1 || budget > 60000) throw new Error('Use 100–500 samples and a 1–60000 ms budget');
  const samples = [];
  // Sequential requests, at most two requests per second, without cookies or mutating routes.
  for (let index = 0; index < count; index++) {
    samples.push(await probeTarget(origin));
    if (index + 1 < count) await new Promise(resolve => setTimeout(resolve, 500));
  }
  const latency = samples.map(sample => sample.durationMs);
  const p99Ms = percentile(latency, 0.99), failures = samples.filter(sample => !sample.ok).length;
  return { ok: failures === 0 && p99Ms <= budget, origin, route: '/api/health', sampleCount: count, failures, p50Ms: percentile(latency, 0.5), p95Ms: percentile(latency, 0.95), p99Ms, budgetMs: budget, checkedAt: new Date().toISOString() };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  measure().then(result => { console.log(JSON.stringify(result)); if (!result.ok) process.exitCode = 1; }).catch(() => { console.error('Performance check refused: configure an explicitly isolated target and valid bounded sampling settings.'); process.exitCode = 1; });
}
