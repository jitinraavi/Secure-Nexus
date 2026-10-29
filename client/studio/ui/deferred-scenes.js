/** Decorative WebGL is optional; content and controls initialize before its download. */
export function deferDecorativeScenes(load, runtime = window) {
  const connection = runtime.navigator?.connection;
  if (connection?.saveData || ['slow-2g', '2g'].includes(connection?.effectiveType)) return () => {};
  let cancelled = false;
  let paint = 0;
  let idle = 0;
  let timer = null;
  const run = () => {
    idle = 0;
    timer = null;
    if (!cancelled) void load();
  };
  paint = runtime.requestAnimationFrame(() => {
    paint = runtime.requestAnimationFrame(() => {
      paint = 0;
      if (cancelled) return;
      if (typeof runtime.requestIdleCallback === 'function') idle = runtime.requestIdleCallback(run, { timeout: 2000 });
      else timer = runtime.setTimeout(run, 0);
    });
  });
  return () => {
    cancelled = true;
    if (paint) runtime.cancelAnimationFrame(paint);
    if (idle) runtime.cancelIdleCallback?.(idle);
    if (timer !== null) runtime.clearTimeout(timer);
  };
}
