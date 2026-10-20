/** Keep scroll math independent of the DOM so every viewport uses the same stages. */
export function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

export function sectionProgress(top, height, viewportHeight) {
  return clamp(-top / Math.max(1, height - viewportHeight));
}

export function stageAtProgress(progress, count = 5) {
  return Math.round(clamp(progress) * Math.max(0, count - 1));
}

export function stageScrollTarget(sectionTop, sectionHeight, viewportHeight, index, count = 5) {
  const fraction = count > 1 ? clamp(index, 0, count - 1) / (count - 1) : 0;
  return Math.max(0, sectionTop + Math.max(0, sectionHeight - viewportHeight) * fraction);
}

export function safeContactEmail(value, fallback = 'hello@groundwork.studio') {
  const email = String(value || '').trim();
  return email.length <= 254 && /^[A-Z0-9.!$%&'*+/=^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email)
    ? email : fallback;
}
