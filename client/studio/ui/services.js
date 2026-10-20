const eyeSvg = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><g class="service-toggle__icon-open"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" stroke="currentColor" stroke-width="1.3"/><circle cx="12" cy="12" r="2.5" stroke="currentColor" stroke-width="1.3"/></g><g class="service-toggle__icon-closed"><path d="M5 12h14M12 5v14" stroke="currentColor" stroke-width="1.3"/></g></svg>';

export function initServices() {
  const section = document.querySelector('#services');
  if (!section) return () => {};

  const toggles = [...section.querySelectorAll('.service-toggle')];
  const switches = [...section.querySelectorAll('.layout-switch button[data-layout]')];
  const listeners = [];

  function on(target, type, handler) {
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  }

  function setOpen(toggle, open) {
    const contentId = toggle.getAttribute('aria-controls');
    const content = contentId ? document.getElementById(contentId) : null;
    if (!content || !section.contains(content)) return;
    toggle.setAttribute('aria-expanded', String(open));
    const discipline = toggle.closest('.service-discipline')?.querySelector('h3')?.textContent?.toLowerCase() || 'studio';
    toggle.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} ${discipline} services`);
    toggle.classList.toggle('is-open', open);
    content.hidden = !open;
    content.classList.toggle('is-open', open);
    toggle.closest('.service-discipline')?.classList.toggle('is-open', open);
    const openIcon = toggle.querySelector('.service-toggle__icon-open');
    const closedIcon = toggle.querySelector('.service-toggle__icon-closed');
    if (openIcon) openIcon.style.display = open ? 'inline' : 'none';
    if (closedIcon) closedIcon.style.display = open ? 'none' : 'inline';
  }

  toggles.forEach((toggle, index) => {
    if (!toggle.hasAttribute('type')) toggle.setAttribute('type', 'button');
    let icon = toggle.querySelector('.service-toggle__icon');
    if (!icon) {
      icon = document.createElement('span');
      icon.className = 'service-toggle__icon';
      icon.setAttribute('aria-hidden', 'true');
      toggle.append(icon);
    }
    icon.innerHTML = eyeSvg;
    // The first discipline starts open; each discipline keeps independent state.
    setOpen(toggle, index === 0);
    on(toggle, 'click', () => setOpen(toggle, toggle.getAttribute('aria-expanded') !== 'true'));
  });

  function setLayout(layout) {
    if (!['split', 'list', 'editorial'].includes(layout)) return;
    section.dataset.layout = layout;
    switches.forEach((button) => {
      const active = button.dataset.layout === layout;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('is-active', active);
    });
  }

  switches.forEach((button) => {
    if (!button.hasAttribute('type')) button.setAttribute('type', 'button');
    if (!button.hasAttribute('aria-label')) {
      button.setAttribute('aria-label', `Show services in ${button.dataset.layout} layout`);
    }
    button.setAttribute('aria-controls', section.id);
    on(button, 'click', () => setLayout(button.dataset.layout));
  });
  setLayout(['split', 'list', 'editorial'].includes(section.dataset.layout) ? section.dataset.layout : 'split');

  return () => listeners.forEach((remove) => remove());
}
