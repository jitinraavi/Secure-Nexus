/** Bounded, diagonally scaled Cholesky solve for symmetric positive systems. */
export function solvePositiveSystem(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  if (n > 240 || matrix.length !== n || matrix.some(row => row.length !== n)) throw new Error("Invalid or oversized engineering matrix.");
  if (!n) return [];
  const scale = matrix.map((row, i) => {
    if (!Number.isFinite(row[i]) || row[i] <= 0) throw new Error("System has an unsupported mechanism, disconnected component, or unstable tangent stiffness.");
    return Math.sqrt(row[i]);
  });
  const lower = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(rhs[i])) throw new Error("Non-finite engineering load or residual.");
    for (let j = 0; j <= i; j++) {
      const a = matrix[i][j] / scale[i] / scale[j];
      if (!Number.isFinite(a) || Math.abs(a - matrix[j][i] / scale[i] / scale[j]) > 1e-8 * Math.max(1, Math.abs(a))) throw new Error("Engineering matrix is not finite and symmetric.");
      let sum = a;
      for (let k = 0; k < j; k++) sum -= lower[i][k] * lower[j][k];
      if (i === j) {
        if (sum <= 1e-12) throw new Error("System is singular, ill-conditioned, or has lost positive stiffness; results rejected.");
        lower[i][j] = Math.sqrt(sum);
      } else lower[i][j] = sum / lower[j][j];
    }
  }
  const intermediate = Array<number>(n).fill(0), result = Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = rhs[i] / scale[i];
    for (let j = 0; j < i; j++) sum -= lower[i][j] * intermediate[j];
    intermediate[i] = sum / lower[i][i];
  }
  for (let i = n - 1; i >= 0; i--) {
    let sum = intermediate[i];
    for (let j = i + 1; j < n; j++) sum -= lower[j][i] * result[j];
    result[i] = sum / lower[i][i];
  }
  return result.map((value, i) => {
    const next = value / scale[i];
    if (!Number.isFinite(next)) throw new Error("Engineering solution overflowed.");
    return next;
  });
}

export const engineeringRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export const finiteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 100 && !/[\u0000-\u001f]/.test(value);
export function requireFinite(value: unknown, label: string, min = -Infinity, max = Infinity): number {
  if (!finiteNumber(value) || value < min || value > max) throw new Error(`${label} must be finite in [${min}, ${max}].`);
  return value;
}
