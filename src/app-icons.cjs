'use strict';
// Icons are requested only for identities already present in trusted UI snapshots.
// Never expose a renderer-supplied file path or an unrestricted filesystem API.
function createAppIcons({ getFileIcon, changed, maxEntries = 512, concurrency = 4 }) {
  const cache = new Map(), queue = [];
  let active = 0, disposed = false;
  function pump() {
    while (!disposed && active < concurrency && queue.length) {
      const [executable, entry] = queue.shift(); active++;
      Promise.resolve().then(() => getFileIcon(executable, { size: 'normal' })).then(icon => {
        if (!icon.isEmpty()) entry.url = icon.toDataURL();
      }).catch(() => {}).finally(() => {
        entry.done = true; active--;
        if (!disposed) { changed(); pump(); }
      });
    }
  }
  return {
    get(executable) {
      if (disposed || typeof executable !== 'string' || !/^[a-z]:[\\/].*\.exe$/i.test(executable)) return null;
      if (cache.has(executable)) return cache.get(executable).url;
      if (cache.size >= maxEntries) {
        const oldest = [...cache].find(([, value]) => value.done);
        if (!oldest) return null;
        cache.delete(oldest[0]);
      }
      const entry = { url: null, done: false };
      cache.set(executable, entry); queue.push([executable, entry]); pump();
      return null;
    },
    dispose() { disposed = true; queue.length = 0; cache.clear(); }
  };
}
module.exports = { createAppIcons };
