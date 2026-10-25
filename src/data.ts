/**
 * The page's data, downloaded piece by piece when a tab needs it (see site-data.ts for the
 * pieces). Each piece is fetched once; `peek` reads one already here without waiting.
 */
import loaders from "virtual:site-data";

const loaded = new Map<string, unknown>();
const pending = new Map<string, Promise<unknown>>();

export function has(name: string): boolean {
  return name in loaders;
}

export function peek<T>(name: string): T | undefined {
  return loaded.get(name) as T | undefined;
}

export function load<T>(name: string): Promise<T> {
  if (loaded.has(name)) return Promise.resolve(loaded.get(name) as T);
  let p = pending.get(name);
  if (!p) {
    const loader = loaders[name];
    if (!loader) return Promise.reject(new Error(`no data piece named ${name}`));
    p = loader()
      .then((m) => {
        loaded.set(name, m.default);
        return m.default;
      })
      .finally(() => pending.delete(name));
    pending.set(name, p);
  }
  return p as Promise<T>;
}

/** Resolves once nothing is downloading (tests wait on it after a click). */
export async function idle(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending.values()]);
  // Let the callbacks waiting on those downloads run.
  await new Promise((r) => setTimeout(r, 0));
  if (pending.size) await idle();
}
