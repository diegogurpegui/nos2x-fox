/**
 * Memory clearing utilities for sensitive data
 *
 * Note: JavaScript strings are immutable, so true clearing isn't possible.
 * These utilities help minimize exposure by:
 * - Setting references to null immediately
 * - Zeroing out mutable buffers (Uint8Array)
 * - Minimizing scope and lifetime of sensitive data
 */

/**
 * Clears a Uint8Array by zeroing out all bytes
 * @param arr - The Uint8Array to clear
 */
export function clearUint8Array(arr: Uint8Array | null): void {
  if (arr) {
    arr.fill(0);
  }
}

/**
 * Clears a PIN cache entry by nulling out the PIN string reference
 * Note: The string itself cannot be cleared (immutable), but we null the reference
 * @param entry - The PIN cache entry to clear
 */
export function clearPinCacheEntry(entry: { pin: string; timestamp: number } | null): void {
  if (entry) {
    // Set pin to empty string (best we can do with immutable strings)
    // The reference will be cleared when entry is set to null
    entry.pin = '';
  }
}

/**
 * Helper to clear a string reference
 * Since strings are immutable in JavaScript, this just sets the reference to null
 * @param str - The string reference to clear (will be set to null)
 */
export function clearStringReference(str: string | null | undefined): string | null {
  return null;
}
