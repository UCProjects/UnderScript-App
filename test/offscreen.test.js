import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

let loads = 0;

async function load(value) {
  const previous = process.env.OFFSCREEN;
  if (value === undefined) delete process.env.OFFSCREEN;
  else process.env.OFFSCREEN = value;
  try {
    loads += 1;
    return await import(`../src/offscreen.js?load=${loads}`);
  } finally {
    if (previous === undefined) delete process.env.OFFSCREEN;
    else process.env.OFFSCREEN = previous;
  }
}

describe('isOffscreen', () => {
  it('is off by default', async () => {
    assert.equal((await load(undefined)).isOffscreen, false);
    assert.equal((await load('')).isOffscreen, false);
  });

  it('turns on for 1 and true', async () => {
    assert.equal((await load('1')).isOffscreen, true);
    assert.equal((await load('true')).isOffscreen, true);
    assert.equal((await load('TRUE')).isOffscreen, true);
  });

  it('stays off for anything else', async () => {
    assert.equal((await load('0')).isOffscreen, false);
    assert.equal((await load('false')).isOffscreen, false);
    assert.equal((await load('yes')).isOffscreen, false);
  });
});

describe('offscreenWindowOptions', () => {
  it('adds nothing when off', async () => {
    assert.deepEqual((await load(undefined)).offscreenWindowOptions, {});
  });

  it('moves the window off the screen and out of the taskbar when on', async () => {
    const { offscreenWindowOptions: options } = await load('1');
    assert.ok(options.x + options.width < 0);
    assert.equal(options.skipTaskbar, true);
  });

  it('gives the window a fixed size, since it is not maximized', async () => {
    const { offscreenWindowOptions: options } = await load('1');
    assert.ok(options.width > 0 && options.height > 0);
  });
});

describe('offscreenSwitches', () => {
  it('adds nothing when off', async () => {
    assert.deepEqual((await load(undefined)).offscreenSwitches, []);
  });

  it('keeps the page rendering while off the screen when on', async () => {
    const { offscreenSwitches: switches } = await load('1');
    assert.deepEqual(switches.map(([name]) => name), ['disable-features', 'disable-backgrounding-occluded-windows', 'disable-renderer-backgrounding']);
    assert.deepEqual(switches[0], ['disable-features', 'CalculateNativeWinOcclusion']);
  });
});

describe('environment', () => {
  it('is restored after loading', async () => {
    const before = process.env.OFFSCREEN;
    await load('1');
    assert.equal(process.env.OFFSCREEN, before);
  });
});
