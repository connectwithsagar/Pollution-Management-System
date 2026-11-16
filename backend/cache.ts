interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  staleUntil: number;
}

export class TtlCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private inflight = new Map<string, Promise<unknown>>();

  get<T>(key: string): { value: T; isStale: boolean } | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    const now = Date.now();
    if (now <= entry.expiresAt) {
      return { value: entry.value as T, isStale: false };
    }
    if (now <= entry.staleUntil) {
      return { value: entry.value as T, isStale: true };
    }
    this.store.delete(key);
    return null;
  }

  set<T>(key: string, value: T, ttlMs: number, staleTtlMs = ttlMs * 3): void {
    const now = Date.now();
    this.store.set(key, {
      value,
      expiresAt: now + ttlMs,
      staleUntil: now + staleTtlMs,
    });
  }

  async getOrFetch<T>(
    key: string,
    ttlMs: number,
    fetcher: () => Promise<T>
  ): Promise<{ value: T; cached: boolean }> {
    const existing = this.get<T>(key);
    if (existing && !existing.isStale) {
      return { value: existing.value, cached: true };
    }

    const pending = this.inflight.get(key) as Promise<T> | undefined;
    if (pending) {
      const value = await pending;
      return { value, cached: true };
    }

    const promise = (async () => {
      try {
        const fresh = await fetcher();
        this.set(key, fresh, ttlMs);
        return fresh;
      } catch (err) {
        if (existing) {
          return existing.value;
        }
        throw err;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, promise);
    const value = await promise;
    return { value, cached: false };
  }

  stats(): { size: number } {
    return { size: this.store.size };
  }

  clear(): void {
    this.store.clear();
  }
}

export const apiCache = new TtlCache();
