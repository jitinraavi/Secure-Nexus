import { projects } from '../data/projects.js';

const arrowSvg = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="M5 19 19 5M5 5h14v14" stroke="currentColor" stroke-width="1.4"/></svg>';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function projectImage(project, className, lazy = true) {
  const image = element('img', className);
  image.src = project.image;
  image.alt = project.imageAlt;
  const landscape = project.image.endsWith('project-02.jpg');
  image.width = landscape ? 1200 : 1000;
  image.height = landscape ? 900 : 1333;
  image.loading = lazy ? 'lazy' : 'eager';
  image.decoding = 'async';
  image.draggable = false;
  return image;
}

export function initProjects() {
  const track = document.querySelector('#project-track');
  if (!track) return () => {};

  const previous = document.querySelector('#project-prev');
  const next = document.querySelector('#project-next');
  const progress = document.querySelector('#project-progress');
  const count = document.querySelector('#project-count');
  const dialog = document.querySelector('#project-dialog');
  const dialogBody = document.querySelector('#project-dialog-body');
  const dialogClose = document.querySelector('#project-dialog-close');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const listeners = [];
  let frame = 0;
  let drag = null;
  let suppressClickUntil = 0;
  let returnFocus = null;

  function on(target, type, handler, options) {
    if (!target) return;
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  }

  const cards = projects.map((project, index) => {
    const card = element('button', 'project-card');
    card.type = 'button';
    card.dataset.projectId = project.id;
    card.setAttribute('aria-label', `View project: ${project.title}`);
    card.setAttribute('aria-haspopup', 'dialog');
    if (dialog) card.setAttribute('aria-controls', dialog.id);
    const imageWrap = element('span', 'project-card__image');
    imageWrap.append(projectImage(project));
    const meta = element('span', 'project-card__meta');
    meta.append(
      element('span', 'project-card__category', project.category),
      element('span', 'project-card__number', String(index + 1).padStart(2, '0')),
    );
    const heading = element('span', 'project-card__heading');
    const arrow = element('span', 'project-card__arrow');
    arrow.innerHTML = arrowSvg;
    heading.append(element('span', 'project-card__title', project.title), arrow);
    card.append(imageWrap, meta, heading);
    return card;
  });
  track.replaceChildren(...cards);
  if (previous) previous.setAttribute('aria-label', 'Scroll to previous projects');
  if (next) next.setAttribute('aria-label', 'Scroll to next projects');
  if (dialogClose) dialogClose.setAttribute('aria-label', 'Close project details');
  if (count) {
    count.setAttribute('aria-live', 'polite');
    count.setAttribute('aria-atomic', 'true');
  }
  if (progress) {
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-label', 'Project gallery position');
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', '100');
    progress.style.transformOrigin = 'left center';
  }

  function closeDialog() {
    if (dialog?.open) dialog.close();
  }

  function openProject(project, trigger) {
    if (!dialog || !dialogBody || typeof dialog.showModal !== 'function') return;
    const title = element('h2', 'project-detail__title', project.title);
    title.id = 'project-dialog-title';
    const copy = element('div', 'project-detail__copy');
    const facts = element('dl', 'project-detail__facts');
    [
      ['Location', project.location],
      ['Year', project.year],
      ['Area', project.area],
    ].forEach(([label, value]) => {
      const fact = element('div', 'project-detail__fact');
      fact.append(element('dt', null, label), element('dd', null, value));
      facts.append(fact);
    });
    const description = element('p', 'project-detail__description', project.description);
    description.id = 'project-dialog-description';
    copy.append(element('p', 'project-detail__meta', project.category), title, description, facts);
    dialogBody.replaceChildren(projectImage(project, 'project-detail__image', false), copy);
    dialog.setAttribute('aria-labelledby', title.id);
    dialog.setAttribute('aria-describedby', description.id);
    returnFocus = trigger;
    dialog.showModal();
    if (dialogClose) dialogClose.focus({ preventScroll: true });
  }

  function cardStep() {
    if (cards.length > 1) {
      const distance = cards[1].getBoundingClientRect().left - cards[0].getBoundingClientRect().left;
      if (distance > 0) return distance;
    }
    return cards[0]?.getBoundingClientRect().width || track.clientWidth;
  }

  function update() {
    frame = 0;
    const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
    const currentScroll = Math.max(0, Math.min(maxScroll, track.scrollLeft));
    const fraction = maxScroll > 1 ? currentScroll / maxScroll : 1;
    const viewport = track.getBoundingClientRect();
    const visible = cards.flatMap((card, index) => {
      const bounds = card.getBoundingClientRect();
      return Math.min(bounds.right, viewport.right) - Math.max(bounds.left, viewport.left) > 1 ? [index + 1] : [];
    });
    const first = visible[0] || 1, last = visible[visible.length - 1] || first;
    const positionLabel = first === last
      ? `Project ${first} of ${projects.length}`
      : `Projects ${first} to ${last} of ${projects.length}`;
    if (previous) previous.disabled = currentScroll <= 1;
    if (next) next.disabled = currentScroll >= maxScroll - 1;
    if (progress) {
      const visualProgress = 1 / projects.length + fraction * (1 - 1 / projects.length);
      progress.style.setProperty('--project-progress', String(visualProgress));
      progress.style.transform = `scaleX(${visualProgress})`;
      progress.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
      progress.setAttribute('aria-valuetext', positionLabel);
      if (progress.tagName === 'PROGRESS') {
        progress.max = 100;
        progress.value = fraction * 100;
      }
    }
    if (count) {
      const range = first === last ? String(first).padStart(2, '0') : `${String(first).padStart(2, '0')}–${String(last).padStart(2, '0')}`;
      const text = `${range} / ${String(projects.length).padStart(2, '0')}`;
      if (count.textContent !== text) count.textContent = text;
      count.setAttribute('aria-label', positionLabel);
    }
  }

  function scheduleUpdate() {
    if (!frame) frame = window.requestAnimationFrame(update);
  }

  function scroll(direction) {
    track.scrollBy({
      left: cardStep() * direction,
      behavior: reducedMotion.matches || document.documentElement.dataset.motion === 'off' ? 'instant' : 'smooth',
    });
  }

  function finishDrag(event) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    if (drag.active) {
      suppressClickUntil = performance.now() + 400;
      if (track.hasPointerCapture?.(drag.id)) track.releasePointerCapture(drag.id);
      track.style.scrollBehavior = drag.scrollBehavior;
      track.style.scrollSnapType = drag.scrollSnapType;
    }
    drag = null;
    track.classList.remove('is-dragging');
    scheduleUpdate();
  }

  on(previous, 'click', () => scroll(-1));
  on(next, 'click', () => scroll(1));
  on(track, 'keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      scroll(event.key === 'ArrowRight' ? 1 : -1);
    } else {
      track.scrollTo({
        left: event.key === 'Home' ? 0 : track.scrollWidth - track.clientWidth,
        behavior: reducedMotion.matches || document.documentElement.dataset.motion === 'off' ? 'instant' : 'smooth',
      });
    }
  });
  on(track, 'scroll', scheduleUpdate, { passive: true });
  on(window, 'resize', scheduleUpdate, { passive: true });
  on(track, 'click', (event) => {
    if (performance.now() < suppressClickUntil && event.detail !== 0) {
      suppressClickUntil = 0;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const card = event.target.closest('.project-card');
    if (!card || !track.contains(card)) return;
    const project = projects.find((item) => item.id === card.dataset.projectId);
    if (project) openProject(project, card);
  }, true);
  on(track, 'pointerdown', (event) => {
    if (event.isPrimary === false || event.button !== 0 || drag) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, scroll: track.scrollLeft, active: false };
  });
  on(window, 'pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.active) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) >= Math.abs(dx)) {
        drag = null;
        return;
      }
      drag.active = true;
      drag.scrollBehavior = track.style.scrollBehavior;
      drag.scrollSnapType = track.style.scrollSnapType;
      track.style.scrollBehavior = 'auto';
      track.style.scrollSnapType = 'none';
      track.setPointerCapture(event.pointerId);
      track.classList.add('is-dragging');
    }
    if (event.cancelable) event.preventDefault();
    track.scrollLeft = drag.scroll - dx;
  }, { passive: false });
  on(window, 'pointerup', finishDrag);
  on(window, 'pointercancel', finishDrag);
  on(track, 'lostpointercapture', finishDrag);
  on(dialogClose, 'click', closeDialog);
  on(dialog, 'click', (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog();
  });
  on(dialog, 'close', () => {
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  });

  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleUpdate) : null;
  resizeObserver?.observe(track);
  update();

  return () => {
    finishDrag();
    closeDialog();
    listeners.forEach((remove) => remove());
    resizeObserver?.disconnect();
    if (frame) window.cancelAnimationFrame(frame);
  };
}
