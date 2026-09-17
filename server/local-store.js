import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// A single development-server process serializes local writes. Production uses Blob ETags.
export function localStore(directory) {
  const locks = new Map();
  const filename = id => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid room ID');
    return join(directory, `${id}.json`);
  };
  const get = async id => {
    try { return JSON.parse(await readFile(filename(id), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  return {
    get,
    async put(id, data, etag) {
      const previous = locks.get(id) || Promise.resolve();
      const pending = previous.catch(() => {}).then(async () => {
        const old = await get(id);
        if ((old?.etag ?? null) !== etag) return false;
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const temporary = `${filename(id)}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify({ data, etag: randomUUID() }), { mode: 0o600 });
        await rename(temporary, filename(id));
        return true;
      });
      locks.set(id, pending);
      try { return await pending; }
      finally { if (locks.get(id) === pending) locks.delete(id); }
    }
  };
}
