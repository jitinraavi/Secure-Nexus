import test from 'node:test';
import assert from 'node:assert/strict';
import { deferDecorativeScenes } from '../../studio/ui/deferred-scenes.js';

function scheduler(connection, idleSupported = true) {
  let next = 0;
  const frames = new Map(), idle = new Map(), timers = new Map();
  const runtime = {
    navigator: { connection },
    requestAnimationFrame(callback) { const id = ++next; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback) { const id = ++next; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    ...(idleSupported ? {
      requestIdleCallback(callback) { const id = ++next; idle.set(id, callback); return id; },
      cancelIdleCallback(id) { idle.delete(id); },
    } : {}),
  };
  const runNext = queue => {
    const entry = queue.entries().next().value;
    assert.ok(entry, 'expected deferred work');
    queue.delete(entry[0]); entry[1]();
  };
  return { runtime, frames, idle, timers, runFrame: () => runNext(frames), runIdle: () => runNext(idle), runTimer: () => runNext(timers) };
}

test('decorative downloads wait for content paint and idle rather than running during initialization', () => {
  const clock = scheduler();
  let loads = 0;
  deferDecorativeScenes(() => { loads++; }, clock.runtime);
  assert.equal(loads, 0);
  clock.runFrame(); assert.equal(loads, 0); assert.equal(clock.idle.size, 0);
  clock.runFrame(); assert.equal(loads, 0); assert.equal(clock.idle.size, 1);
  clock.runIdle(); assert.equal(loads, 1);
});

test('data saver and slow connections keep the CSS illustration without a WebGL download', () => {
  for (const connection of [{ saveData: true }, { effectiveType: '2g' }, { effectiveType: 'slow-2g' }]) {
    const clock = scheduler(connection);
    let loads = 0;
    deferDecorativeScenes(() => { loads++; }, clock.runtime);
    assert.equal(clock.frames.size, 0);
    assert.equal(loads, 0);
  }
});

test('leaving before deferred work executes cancels both paint and idle callbacks', () => {
  const clock = scheduler();
  let loads = 0;
  const cancel = deferDecorativeScenes(() => { loads++; }, clock.runtime);
  clock.runFrame(); clock.runFrame();
  const stale = [...clock.idle.values()][0];
  cancel();
  assert.equal(clock.idle.size, 0);
  stale(); assert.equal(loads, 0, 'even a callback delivered after cancellation cannot download scenes');
  const cancelBeforePaint = deferDecorativeScenes(() => { loads++; }, clock.runtime);
  cancelBeforePaint();
  assert.equal(clock.frames.size, 0);
});

test('browsers without idle callbacks still yield through two paint frames before a timer', () => {
  const clock = scheduler(undefined, false);
  let loads = 0;
  deferDecorativeScenes(() => { loads++; }, clock.runtime);
  clock.runFrame(); clock.runFrame();
  assert.equal(loads, 0);
  clock.runTimer(); assert.equal(loads, 1);
});
