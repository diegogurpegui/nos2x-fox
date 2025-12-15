/**
 * Ephemeral PIN cache
 * PIN is stored in memory only and is lost when the browser closes
 */

// PIN cache duration: 10 minutes (clearly documented)
const PIN_CACHE_DURATION_MS = 10 * 60 * 1000;

interface PinCacheEntry {
  pin: string;
  timestamp: number;
}

let pinCache: PinCacheEntry | null = null;

/**
 * Gets the cached PIN if it's still valid
 * @returns The cached PIN if valid, null if expired or not cached
 */
export function getCachedPin(): string | null {
  if (!pinCache) {
    return null;
  }

  const now = Date.now();
  const age = now - pinCache.timestamp;

  if (age > PIN_CACHE_DURATION_MS) {
    // Cache expired, clear it
    pinCache = null;
    return null;
  }

  return pinCache.pin;
}

/**
 * Stores a PIN in the ephemeral cache with current timestamp
 * @param pin - The PIN to cache
 */
export function setCachedPin(pin: string): void {
  pinCache = {
    pin,
    timestamp: Date.now()
  };
}

/**
 * Clears the cached PIN
 */
export function clearCachedPin(): void {
  pinCache = null;
}

/**
 * Checks if a PIN is currently cached and valid
 * @returns true if PIN is cached and not expired
 */
export function isPinCached(): boolean {
  return getCachedPin() !== null;
}
