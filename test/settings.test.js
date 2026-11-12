import assert from 'node:assert/strict';
import { promises as file } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createSettings } from '../src/launcher/settings.js';

let dir;
let target;

beforeEach(async () => {
  dir = await file.mkdtemp(path.join(os.tmpdir(), 'launcher-'));
  target = path.join(dir, 'nested', 'launcher.json');
});

afterEach(() => file.rm(dir, { recursive: true, force: true }));

describe('createSettings', () => {
  it('defaults to showing the screen at startup', async () => {
    assert.deepEqual(await createSettings(target).read(), { showAtStartup: true });
  });

  it('persists changes and creates the folder', async () => {
    const settings = createSettings(target);
    assert.deepEqual(await settings.write({ showAtStartup: false }), { showAtStartup: false });
    assert.deepEqual(await createSettings(target).read(), { showAtStartup: false });
    await settings.write({ showAtStartup: true });
    assert.deepEqual(await createSettings(target).read(), { showAtStartup: true });
  });

  it('falls back to the defaults for a corrupt or odd file', async () => {
    await file.mkdir(path.dirname(target), { recursive: true });
    for (const text of ['{broken', 'null', '[]', '{"showAtStartup":"no"}', '{"other":1}']) {
      await file.writeFile(target, text);
      assert.deepEqual(await createSettings(target).read(), { showAtStartup: true }, text);
    }
  });

  it('ignores unknown settings', async () => {
    const settings = createSettings(target);
    await settings.write({ showAtStartup: false, unexpected: 1 });
    assert.deepEqual(await settings.read(), { showAtStartup: false });
  });

  it('leaves no temporary file behind', async () => {
    await createSettings(target).write({ showAtStartup: false });
    assert.deepEqual(await file.readdir(path.dirname(target)), ['launcher.json']);
  });
});
