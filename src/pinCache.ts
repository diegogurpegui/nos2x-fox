/**
 * Ephemeral PIN cache
 * PIN is stored in memory only and is lost when the browser closes
 */

import * as Storage from './storage';
import { clearPinCacheEntry } from './memoryUtils';

interface PinCacheEntry {
  pin: string;
  timestamp: number;
}

let pinCache: PinCacheEntry | null = null;
let expirationTimer: ReturnType<typeof setTimeout> | null = null;

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
    // Invalid cache duration, clear cache for safety (also clears timer)
    clearCachedPin();
    return null;
  }

  // Check if cache has expired
  if (age >= cacheDurationMs) {
    // Cache expired, clear it (also clears timer)
    clearCachedPin();
    return null;
  }

  // Return a copy of the PIN (strings are immutable, but this minimizes reference exposure)
  return pinCache.pin;
}

/**
 * Stores a PIN in the ephemeral cache with current timestamp
 * Sets up proactive expiration timer to clear PIN after configured duration
 * @param pin - The PIN to cache
 */
export async function setCachedPin(pin: string): Promise<void> {
  // Clear any existing expiration timer
  if (expirationTimer !== null) {
    clearTimeout(expirationTimer);
    expirationTimer = null;
  }

  // Clear existing cache entry before replacing
  if (pinCache) {
    clearPinCacheEntry(pinCache);
  }

  pinCache = {
    pin,
    timestamp: Date.now()
  };

  // Get the configured cache duration and set up expiration timer
  try {
    const cacheDurationMs = await Storage.getPinCacheDuration();

    // Ensure cache duration is a valid positive number
    if (cacheDurationMs && cacheDurationMs > 0 && Number.isFinite(cacheDurationMs)) {
      // Schedule proactive expiration
      expirationTimer = setTimeout(() => {
        clearCachedPin();
      }, cacheDurationMs);
    }
    // If cache duration is invalid, don't set timer (fail secure)
    // Lazy expiration in getCachedPin() will handle clearing
  } catch (error) {
    // If fetching cache duration fails, don't set timer (fail secure)
    // Lazy expiration in getCachedPin() will handle clearing
    console.warn('Failed to fetch PIN cache duration for timer setup:', error);
  }
}

/**
 * Clears the cached PIN
 */
export function clearCachedPin(): void {
  // Clear any active expiration timer
  if (expirationTimer !== null) {
    clearTimeout(expirationTimer);
    expirationTimer = null;
  }

  clearPinCacheEntry(pinCache);
  pinCache = null;
}

/**
 * Checks if a PIN is currently cached and valid
 * @returns true if PIN is cached and not expired
 */
export async function isPinCached(): Promise<boolean> {
  return (await getCachedPin()) !== null;
}
