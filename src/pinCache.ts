/**
 * Ephemeral PIN cache
 * PIN is stored in memory only and is lost when the browser closes
 */

import * as Storage from './storage';

interface PinCacheEntry {
  pin: string;
  timestamp: number;
}

let pinCache: PinCacheEntry | null = null;

/**
 * Gets the cached PIN if it's still valid
 * @returns The cached PIN if valid, null if expired or not cached
 */
export async function getCachedPin(): Promise<string | null> {
  if (!pinCache) {
    return null;
  }

  const now = Date.now();
  const age = now - pinCache.timestamp;
  
  // Get the configured cache duration
  const cacheDurationMs = await Storage.getPinCacheDuration();

  // Ensure cache duration is a valid positive number
  if (!cacheDurationMs || cacheDurationMs <= 0 || !Number.isFinite(cacheDurationMs)) {
    // Invalid cache duration, clear cache for safety
    pinCache = null;
    return null;
  }

  // Check if cache has expired
  if (age >= cacheDurationMs) {
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
export async function isPinCached(): Promise<boolean> {
  return (await getCachedPin()) !== null;
}
