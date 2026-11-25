/**
 * Dual-tier image cache:
 * - Static theme/effect assets (/assets/...) stay pinned for instant frame switching.
 * - Transient captured/uploaded data URLs live in a bounded LRU map (max 48 entries)
 *   so repeated retakes never leak memory.
 */
const MAX_TRANSIENT_ENTRIES = 48;

const staticAssetCache = new Map<string, HTMLImageElement>();
const transientCache = new Map<string, HTMLImageElement>();
const inFlightLoads = new Map<string, Promise<HTMLImageElement>>();

function isTransientUrl(src: string): boolean {
  return src.startsWith('data:') || src.startsWith('blob:');
}

function getFromCache(src: string): HTMLImageElement | undefined {
  if (!isTransientUrl(src)) {
    return staticAssetCache.get(src);
  }
  const hit = transientCache.get(src);
  if (hit) {
    // Refresh LRU order
    transientCache.delete(src);
    transientCache.set(src, hit);
  }
  return hit;
}

function putInCache(src: string, img: HTMLImageElement): void {
  if (!isTransientUrl(src)) {
    staticAssetCache.set(src, img);
    return;
  }
  if (transientCache.has(src)) {
    transientCache.delete(src);
  }
  transientCache.set(src, img);
  while (transientCache.size > MAX_TRANSIENT_ENTRIES) {
    const oldestKey = transientCache.keys().next().value;
    if (oldestKey) transientCache.delete(oldestKey);
    else break;
  }
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  const existing = getFromCache(src);
  if (existing) {
    return Promise.resolve(existing);
  }
  const pending = inFlightLoads.get(src);
  if (pending) {
    return pending;
  }

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      inFlightLoads.delete(src);
      putInCache(src, img);
      resolve(img);
    };
    img.onerror = (err) => {
      inFlightLoads.delete(src);
      reject(err);
    };
    img.src = src;
  });

  inFlightLoads.set(src, promise);
  return promise;
}

export function getCachedImage(src: string): HTMLImageElement | null {
  const existing = getFromCache(src);
  if (existing) return existing;
  loadImage(src).catch(() => {});
  return null;
}
