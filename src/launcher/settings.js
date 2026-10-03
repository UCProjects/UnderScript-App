import { promises as file } from 'fs';
import path from 'path';

const defaults = { showAtStartup: true };

export function createSettings(target) {
  async function read() {
    try {
      const data = JSON.parse(await file.readFile(target, 'utf8'));
      return { ...defaults, showAtStartup: typeof data?.showAtStartup === 'boolean' ? data.showAtStartup : defaults.showAtStartup };
    } catch (e) {
      return { ...defaults };
    }
  }

  return {
    read,
    async write(changes) {
      const next = { ...await read(), ...changes };
      await file.mkdir(path.dirname(target), { recursive: true });
      await file.writeFile(`${target}.tmp`, JSON.stringify(next, null, 2));
      await file.rename(`${target}.tmp`, target);
      return next;
    },
  };
}
