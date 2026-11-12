import { assembleBundle } from './build.js';
import { bundleFormat } from './bundle.js';

export async function rebuildStale({ installed, format = bundleFormat, assemble = assembleBundle, log = console.error }) {
  const rebuilt = [];
  const failed = [];
  for (const record of await installed.stale(format)) {
    try {
      const stored = await installed.assetsOf(record.url);
      if (!stored?.script) throw new Error('The original script was not saved');
      const { meta, bundle } = assemble(stored.script, stored.assets);
      await installed.rebuilt(record.url, { meta, bundle, format });
      rebuilt.push(record.url);
    } catch (error) {
      log(`Unable to rebuild ${record.name}`, error);
      failed.push(record.url);
    }
  }
  return { rebuilt, failed };
}
