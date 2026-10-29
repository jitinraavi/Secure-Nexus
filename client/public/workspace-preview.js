export const sample = Object.freeze({ widthM: 12, depthM: 8, heightM: 3 });
export function previewMetrics(unit = 'm') {
  const factor = unit === 'mm' ? 1000 : unit === 'ft' ? 1 / 0.3048 : 1;
  return { width: sample.widthM * factor, depth: sample.depthM * factor, height: sample.heightM * factor, area: sample.widthM * sample.depthM * factor ** 2 };
}
if (typeof document !== 'undefined') {
  const units = document.querySelector('#sample-units');
  const plan = document.querySelector('#plan-view'), section = document.querySelector('#section-view');
  let view = 'plan';
  const draw = () => {
    const unit = units.value, data = previewMetrics(unit);
    const fmt = value => new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(value);
    document.querySelector('#width-label').textContent = `${fmt(data.width)} ${unit}`;
    document.querySelector('#second-label').textContent = `${fmt(view === 'plan' ? data.depth : data.height)} ${unit}`;
    document.querySelector('#sample-area').textContent = `${fmt(data.area)} ${unit}²`;
    document.querySelector('#sample-height').textContent = `${fmt(data.height)} ${unit}`;
    document.querySelector('#sample-caption').textContent = `Illustrative ${view} of the same 12 by 8 metre room, ${view === 'plan' ? 'showing its footprint' : '3 metres high'}`;
    const outline = document.querySelector('#sample-outline');
    const top = view === 'plan' ? 55 : 115, height = view === 'plan' ? 230 : 120;
    outline.setAttribute('height', String(height));
    outline.setAttribute('y', String(top));
    document.querySelector('#sample-dimensions').setAttribute('d', `M110 ${top + height + 20}H530M80 ${top}V${top + height}`);
    document.querySelector('#width-label').setAttribute('y', String(top + height + 53));
    const centre = top + height / 2, secondLabel = document.querySelector('#second-label');
    secondLabel.setAttribute('y', String(centre));
    secondLabel.setAttribute('transform', `rotate(-90 45 ${centre})`);
    plan.setAttribute('aria-pressed', String(view === 'plan')); section.setAttribute('aria-pressed', String(view === 'section'));
  };
  units.addEventListener('change', draw);
  plan.addEventListener('click', () => { view = 'plan'; draw(); });
  section.addEventListener('click', () => { view = 'section'; draw(); });
  draw();
}
