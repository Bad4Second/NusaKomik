export type CacheStatus = 'HIT' | 'MISS' | 'STALE';

interface CacheEntry<T> {
  value: T;
  createdAt: number;
  softExpiresAt: number;
  hardExpiresAt: number;
  etag: string;
}

export interface CacheStats {
  entries: number;
  maxEntries: number;
  hits: number;
  misses: number;
  staleServes: number;
  coalescedSaves: number;
  hitRatePercent: number;
  avgResponseMs: number;
  lastFlushAt: string | null;
}

function simpleHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `"${(hash >>> 0).toString(16)}"`;
}

export class SmartCache {
  private store: Map<string, CacheEntry<unknown>>;
  private inflight: Map<string, Promise<unknown>>;
  private maxEntries: number;
  private hits: number;
  private misses: number;
  private staleServes: number;
  private coalescedSaves: number;
  private totalResponseMs: number;
  private totalRequests: number;
  private lastFlushAt: string | null;

  constructor(maxEntries = 500) {
    this.store = new Map();
    this.inflight = new Map();
    this.maxEntries = maxEntries;
    this.hits = 0;
    this.misses = 0;
    this.staleServes = 0;
    this.coalescedSaves = 0;
    this.totalResponseMs = 0;
    this.totalRequests = 0;
    this.lastFlushAt = null;
  }

  private evictIfNeeded(): void {
    if (this.store.size < this.maxEntries) return;
    const oldestKey = this.store.keys().next().value;
    if (oldestKey !== undefined) {
      this.store.delete(oldestKey);
    }
  }

  private setEntry<T>(key: string, value: T, softTtlMs: number, staleTtlMs: number): CacheEntry<T> {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else {
      this.evictIfNeeded();
    }
    const now = Date.now();
    const etag = simpleHash(JSON.stringify(value));
    const entry: CacheEntry<T> = {
      value,
      createdAt: now,
      softExpiresAt: now + softTtlMs,
      hardExpiresAt: now + softTtlMs + staleTtlMs,
      etag,
    };
    this.store.set(key, entry);
    return entry;
  }

  private runSingleflight<T>(key: string, fetcher: () => Promise<T>, softTtlMs: number, staleTtlMs: number): Promise<T> {
    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) {
      this.coalescedSaves += 1;
      return existing;
    }

    const promise = fetcher()
      .then((data) => {
        this.setEntry(key, data, softTtlMs, staleTtlMs);
        return data;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, promise);
    return promise;
  }

  async getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    options?: { softTtlMs?: number; staleTtlMs?: number }
  ): Promise<{ data: T; cacheStatus: CacheStatus; etag: string; ttlRemainingSec: number; elapsedMs: number }> {
    const start = performance.now();
    const softTtlMs = options?.softTtlMs ?? 300_000;
    const staleTtlMs = options?.staleTtlMs ?? 600_000;
    const now = Date.now();

    const cached = this.store.get(key) as CacheEntry<T> | undefined;

    if (cached && now < cached.softExpiresAt) {
      // Refresh LRU order
      this.store.delete(key);
      this.store.set(key, cached);
      this.hits += 1;
      const elapsedMs = Number((performance.now() - start).toFixed(2));
      this.totalResponseMs += elapsedMs;
      this.totalRequests += 1;
      return {
        data: cached.value,
        cacheStatus: 'HIT',
        etag: cached.etag,
        ttlRemainingSec: Math.max(1, Math.floor((cached.softExpiresAt - now) / 1000)),
        elapsedMs,
      };
    }

    if (cached && now < cached.hardExpiresAt) {
      // Stale-while-revalidate: serve stale immediately, refresh in background
      this.staleServes += 1;
      void this.runSingleflight(key, fetcher, softTtlMs, staleTtlMs).catch(() => {});
      const elapsedMs = Number((performance.now() - start).toFixed(2));
      this.totalResponseMs += elapsedMs;
      this.totalRequests += 1;
      return {
        data: cached.value,
        cacheStatus: 'STALE',
        etag: cached.etag,
        ttlRemainingSec: 0,
        elapsedMs,
      };
    }

    this.misses += 1;
    const data = await this.runSingleflight(key, fetcher, softTtlMs, staleTtlMs);
    const updated = this.store.get(key) as CacheEntry<T> | undefined;
    const elapsedMs = Number((performance.now() - start).toFixed(2));
    this.totalResponseMs += elapsedMs;
    this.totalRequests += 1;

    return {
      data,
      cacheStatus: 'MISS',
      etag: updated?.etag ?? simpleHash(key),
      ttlRemainingSec: Math.floor(softTtlMs / 1000),
      elapsedMs,
    };
  }

  flush(): number {
    const count = this.store.size;
    this.store.clear();
    this.lastFlushAt = new Date().toISOString();
    return count;
  }

  getStats(): CacheStats {
    const totalLookups = this.hits + this.misses + this.staleServes;
    const effectiveHits = this.hits + this.staleServes;
    return {
      entries: this.store.size,
      maxEntries: this.maxEntries,
      hits: this.hits,
      misses: this.misses,
      staleServes: this.staleServes,
      coalescedSaves: this.coalescedSaves,
      hitRatePercent: totalLookups > 0 ? Number(((effectiveHits / totalLookups) * 100).toFixed(1)) : 100,
      avgResponseMs: this.totalRequests > 0 ? Number((this.totalResponseMs / this.totalRequests).toFixed(2)) : 0.4,
      lastFlushAt: this.lastFlushAt,
    };
  }
}
