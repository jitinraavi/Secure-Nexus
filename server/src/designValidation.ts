export const MAX_DESIGN_BYTES = 4_000_000;
const MAX_DESIGN_NODES = 100_000;
const MAX_DESIGN_DEPTH = 64;

export class DesignInputError extends Error {
  readonly status = 400;
  readonly code = "INVALID_DESIGN";
}

/** Count work before recursively serializing, cloning or comparing input. */
export function validateDesignComplexity(value: unknown): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (++nodes > MAX_DESIGN_NODES || current.depth > MAX_DESIGN_DEPTH) {
      throw new DesignInputError("Design exceeds the supported object count or nesting depth");
    }
    if (!current.value || typeof current.value !== "object") continue;
    const children = Object.values(current.value);
    if (nodes + pending.length + children.length > MAX_DESIGN_NODES) {
      throw new DesignInputError("Design contains too many values");
    }
    for (const child of children) pending.push({ value: child, depth: current.depth + 1 });
  }
}

export function parseDesignInput(text: string): unknown {
  if (text.length > MAX_DESIGN_BYTES || Buffer.byteLength(text, "utf8") > MAX_DESIGN_BYTES) {
    throw new DesignInputError("Design data is too large");
  }
  let design: unknown;
  try { design = JSON.parse(text); }
  catch { throw new DesignInputError("Design must contain valid JSON"); }
  validateDesignComplexity(design);
  return design;
}
