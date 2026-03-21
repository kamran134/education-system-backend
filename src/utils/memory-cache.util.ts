/**
 * Simple in-memory TTL cache.
 * No external dependencies required — works in a single Node.js process.
 * Suitable for caching stats data that rarely changes and is expensive to compute.
 */

interface CacheEntry<T> {
    value: T;
    expiresAt: number;
}

export class MemoryCache {
    private store = new Map<string, CacheEntry<any>>();

    /**
     * @param ttlMs  Time-to-live in milliseconds (default: 5 minutes)
     */
    constructor(private readonly ttlMs: number = 5 * 60 * 1000) {}

    get<T>(key: string): T | undefined {
        const entry = this.store.get(key);
        if (!entry) return undefined;
        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return undefined;
        }
        return entry.value as T;
    }

    set<T>(key: string, value: T): void {
        this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    }

    /** Remove a specific key. */
    delete(key: string): void {
        this.store.delete(key);
    }

    /** Remove all entries whose key starts with the given prefix. */
    invalidateByPrefix(prefix: string): void {
        for (const key of this.store.keys()) {
            if (key.startsWith(prefix)) {
                this.store.delete(key);
            }
        }
    }

    /** Clear the entire cache. */
    clear(): void {
        this.store.clear();
    }
}
