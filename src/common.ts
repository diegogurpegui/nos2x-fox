import browser from 'webextension-polyfill';
import { getPublicKey, nip19 } from 'nostr-tools';

import { AuthorizationCondition, ProfilesConfig } from './types';

export const PERMISSIONS_REQUIRED = {
  getPublicKey: 1,
  getRelays: 5,
  signEvent: 10,
  'nip04.encrypt': 20,
  'nip04.decrypt': 20,
  'nip44.encrypt': 20,
  'nip44.decrypt': 20
};

const ORDERED_PERMISSIONS: [number, (keyof typeof PERMISSIONS_REQUIRED)[]][] = [
  [1, ['getPublicKey']],
  [5, ['getRelays']],
  [10, ['signEvent']],
  [20, ['nip04.encrypt', 'nip04.decrypt', 'nip44.encrypt', 'nip44.decrypt']]
];

const PERMISSION_NAMES: Record<keyof typeof PERMISSIONS_REQUIRED, string> = {
  getPublicKey: 'read your public key',
  getRelays: 'read your list of preferred relays',
  signEvent: 'sign events using your private key',
  'nip04.encrypt': 'encrypt messages to peers',
  'nip04.decrypt': 'decrypt messages from peers',
  'nip44.encrypt': 'encrypt messages to peers (nip44)',
  'nip44.decrypt': 'decrypt messages from peers (nip44)'
};

export type AuthorizationTimeUnit = 'minutes' | 'hours' | 'days';

const AUTHORIZATION_TIME_UNIT_SECONDS: Record<AuthorizationTimeUnit, number> = {
  minutes: 60,
  hours: 60 * 60,
  days: 24 * 60 * 60
};

/** Minimum custom grant length (one minute). */
export const MIN_CUSTOM_AUTHORIZATION_SECONDS = 60;

/** Maximum custom grant length (366 days). */
export const MAX_CUSTOM_AUTHORIZATION_SECONDS = 366 * 24 * 60 * 60;

/**
 * Returns a list of capabilities that are allowed based on the provided
 * permission level. The capabilities correspond to methods that a host
 * can perform if granted the specified permission.
 *
 * @param permission - The permission level to evaluate.
 * @returns An array of strings describing the allowed capabilities.
 *          If no capabilities are allowed, returns ['nothing'].
 */
export function getAllowedCapabilities(permission: number): string[] {
  let requestedMethods: string[] = [];
  for (let i = 0; i < ORDERED_PERMISSIONS.length; i++) {
    let [perm, methods] = ORDERED_PERMISSIONS[i];
    if (perm > permission) break;
    requestedMethods = requestedMethods.concat(methods);
  }

  if (requestedMethods.length === 0) return ['nothing'];

  return requestedMethods.map(method => PERMISSION_NAMES[method]);
}

/**
 * Given a permission level, returns a string describing the capabilities
 * that the host will have if the user grants this permission.
 *
 * The string will be in English, and will be one of the following:
 * - 'nothing' if the permission level is 0
 * - a single capability (e.g. 'read your public key')
 * - a comma-separated list of capabilities, with an 'and' between the
 *   last two (e.g. 'read your public key, read your list of preferred
 *   relays, and sign events using your private key')
 */
export function getPermissionsString(permission: number) {
  let capabilities = getAllowedCapabilities(permission);

  if (capabilities.length === 0) return 'none';
  if (capabilities.length === 1) return capabilities[0];

  return (
    (capabilities.slice(0, -1) as string[]).join(', ') +
    ' and ' +
    capabilities[capabilities.length - 1]
  );
}

/**
 * Whole-number amount × unit → seconds for a custom time-limited grant, or null if out of range / invalid.
 */
export function customAuthorizationDurationSeconds(
  amount: number,
  unit: AuthorizationTimeUnit
): number | null {
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
    return null;
  }
  const unitSeconds = AUTHORIZATION_TIME_UNIT_SECONDS[unit];
  const totalSeconds = amount * unitSeconds;
  if (
    totalSeconds < MIN_CUSTOM_AUTHORIZATION_SECONDS ||
    totalSeconds > MAX_CUSTOM_AUTHORIZATION_SECONDS
  ) {
    return null;
  }
  return totalSeconds;
}

/** TTL in seconds for fixed expiring conditions; null if not a fixed expiring kind. */
export function fixedExpiringPermissionTtlSeconds(condition: string): number | null {
  switch (condition) {
    case AuthorizationCondition.EXPIRABLE_5M:
      return 5 * 60;
    case AuthorizationCondition.EXPIRABLE_1H:
      return 60 * 60;
    case AuthorizationCondition.EXPIRABLE_8H:
      return 8 * 60 * 60;
    default:
      return null;
  }
}

/**
 * Whether a stored permission row should be removed as expired or invalid.
 * `nowSeconds` is Unix time in seconds (same basis as `created_at`).
 */
export function shouldRemoveStoredPermission(
  condition: string,
  createdAtSeconds: number,
  nowSeconds: number,
  durationSeconds?: number
): boolean {
  if (condition === AuthorizationCondition.EXPIRABLE_CUSTOM) {
    if (
      durationSeconds == null ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds < MIN_CUSTOM_AUTHORIZATION_SECONDS ||
      durationSeconds > MAX_CUSTOM_AUTHORIZATION_SECONDS
    ) {
      return true;
    }
    return createdAtSeconds < nowSeconds - durationSeconds;
  }
  const fixedTtl = fixedExpiringPermissionTtlSeconds(condition);
  if (fixedTtl == null) {
    return false;
  }
  return createdAtSeconds < nowSeconds - fixedTtl;
}

/** Human-readable label for the options permissions table. */
export function formatPermissionConditionLabel(
  condition: string,
  durationSeconds?: number
): string {
  switch (condition) {
    case AuthorizationCondition.FOREVER:
      return 'forever';
    case AuthorizationCondition.EXPIRABLE_5M:
      return '5 minutes';
    case AuthorizationCondition.EXPIRABLE_1H:
      return '1 hour';
    case AuthorizationCondition.EXPIRABLE_8H:
      return '8 hours';
    case AuthorizationCondition.EXPIRABLE_CUSTOM:
      return durationSeconds != null
        ? `custom (${formatAuthorizationDurationHuman(durationSeconds)})`
        : 'custom';
    default:
      return condition;
  }
}

function formatAuthorizationDurationHuman(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / (24 * 60 * 60));
  const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days} day${days === 1 ? '' : 's'}`);
  }
  if (hours > 0) {
    parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  }
  if (minutes > 0 || parts.length === 0) {
    parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  }
  return parts.join(', ');
}

/**
 * Validates seconds for a custom grant (e.g. from a prompt message). Returns null if invalid.
 */
export function normalizeCustomAuthorizationDurationSeconds(
  durationSeconds: unknown
): number | null {
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds)) {
    return null;
  }
  const rounded = Math.round(durationSeconds);
  if (rounded < MIN_CUSTOM_AUTHORIZATION_SECONDS || rounded > MAX_CUSTOM_AUTHORIZATION_SECONDS) {
    return null;
  }
  return rounded;
}

export function truncatePublicKeys(
  publicKey: String,
  startCount: number = 15,
  endCount: number = 15
): String {
  return `${publicKey.substring(0, startCount)}…${publicKey.substring(
    publicKey.length - endCount
  )}`;
}

/**
 * Checks wether the URL is valid
 * @param url Relay websocket URL
 * @returns {boolean}
 */
export function isValidRelayURL(url: string): boolean {
  return url != null && url.trim() != '' && url.startsWith('wss://');
}

/**
 * Validates a nostr link handler URL template. Empty is valid (feature disabled).
 * Non-empty templates must contain a %s placeholder and form a parseable URL.
 */
export function isValidNostrLinkHandlerTemplate(template: string): boolean {
  const trimmed = template.trim();
  if (!trimmed) return true;
  if (!trimmed.includes('%s')) return false;

  try {
    new URL(trimmed.replace('%s', 'npub1test'));
    return true;
  } catch {
    return false;
  }
}

/** Builds the destination URL from a template and a nostr: href. */
export function buildNostrLinkUrl(template: string, nostrHref: string): string | null {
  const colonIndex = nostrHref.indexOf(':');
  if (colonIndex === -1) return null;

  const payload = nostrHref.slice(colonIndex + 1);
  if (!payload) return null;

  return template.replace('%s', encodeURIComponent(payload));
}

export function isHexadecimal(value: string) {
  return /^[0-9A-Fa-f]+$/g.test(value);
}

export function convertHexToUint8Array(hexData: string): Uint8Array {
  // ensure even number of characters
  if (hexData.length % 2 != 0) {
    throw new Error('WARNING: expecting an even number of characters in the hexString');
  }

  // check for some non-hex characters
  const hasInvalidChars = hexData.match(/[G-Z\s]/i);
  if (hasInvalidChars) {
    throw new Error(`WARNING: found non-hex characters: ${hasInvalidChars.toString()}`);
  }

  // split the string into pairs of octets
  const octectPairs = hexData.match(/[\dA-F]{2}/gi);

  if (!octectPairs) {
    throw Error('Cannot extract octect pairs.');
  }

  // convert the octets to integers
  const integers = octectPairs.map(pair => {
    return parseInt(pair, 16);
  });

  const array = new Uint8Array(integers);
  return array;
}

export function convertUint8ArrayToHex(arrayData: Uint8Array): string {
  let hexData = '';
  for (let i = 0; i < arrayData.length; i++) {
    const value = arrayData[i];
    hexData = hexData + ('0' + value.toString(16)).slice(-2);
  }
  return hexData;
}

export function openPopupWindow(
  pageUrl: string,
  windowSize: { width: number; height: number } = { width: 600, height: 400 }
): Promise<browser.Windows.Window | browser.Tabs.Tab> {
  const promptPageURL = browser.runtime.getURL(pageUrl);

  // open the popup window

  let openPromptPromise: Promise<browser.Windows.Window | browser.Tabs.Tab>;
  if (browser.windows) {
    openPromptPromise = browser.windows.create({
      url: promptPageURL,
      type: 'popup',
      width: windowSize.width,
      height: windowSize.height
    });
  } else {
    // Android Firefox
    openPromptPromise = browser.tabs.create({
      url: promptPageURL,
      active: true
    });
  }

  return openPromptPromise;
}

//#region Private Key Utilities

/**
 * Checks if a private key is encrypted (starts with '{')
 * @param privateKey - The private key to check
 * @returns true if the private key is encrypted, false otherwise
 */
export function isPrivateKeyEncrypted(privateKey: string): boolean {
  return privateKey != null && privateKey.startsWith('{');
}

/**
 * Derives a public key from a plain-text private key
 * @param privateKey - The plain-text private key (hex string)
 * @returns The derived public key
 * @throws Error if the private key is encrypted or invalid
 */
export function derivePublicKeyFromPrivateKey(privateKey: string): string {
  if (!privateKey) {
    throw new Error('Private key is empty');
  }
  if (isPrivateKeyEncrypted(privateKey)) {
    throw new Error('Cannot derive public key from encrypted private key');
  }
  return getPublicKey(convertHexToUint8Array(privateKey));
}

/**
 * Checks if a public key can be derived from a private key
 * @param privateKey - The private key to check
 * @param pinEnabled - Whether PIN protection is enabled
 * @returns true if public key can be derived, false otherwise
 */
export function canDerivePublicKeyFromPrivateKey(privateKey: string, pinEnabled: boolean): boolean {
  if (!privateKey) return false;
  return !(pinEnabled && isPrivateKeyEncrypted(privateKey));
}

/**
 * Finds an existing profile that uses the same private key as the one being imported.
 * @returns The public key of the matching profile, or undefined if none found
 */
export function findExistingProfileByPrivateKey(
  importedPrivateKey: string | undefined,
  existingProfiles: ProfilesConfig,
  pinEnabled: boolean,
  derivedPublicKey?: string
): string | undefined {
  if (!importedPrivateKey) return undefined;

  const exactMatch = Object.entries(existingProfiles).find(
    ([, profile]) => profile.privateKey === importedPrivateKey
  );
  if (exactMatch) return exactMatch[0];

  if (
    pinEnabled &&
    derivedPublicKey &&
    !isPrivateKeyEncrypted(importedPrivateKey) &&
    existingProfiles[derivedPublicKey]
  ) {
    return derivedPublicKey;
  }

  return undefined;
}

/**
 * Formats a private key for display in the UI
 * @param privateKey - The private key to format
 * @param pinEnabled - Whether PIN protection is enabled
 * @returns Empty string if encrypted, otherwise nsec-encoded string
 */
export function formatPrivateKeyForDisplay(privateKey: string, pinEnabled: boolean): string {
  if (!privateKey) return '';
  if (pinEnabled && isPrivateKeyEncrypted(privateKey)) {
    // Private key is encrypted, can't display it
    return '';
  }
  // Private key is plain-text, encode it for display
  return nip19.nsecEncode(convertHexToUint8Array(privateKey));
}

/**
 * Validates if a private key has a valid format (hex or nsec)
 * @param privateKey - The private key to validate
 * @returns true if the format is valid, false otherwise
 */
export function validatePrivateKeyFormat(privateKey: string): boolean {
  if (privateKey === '') return true;
  if (privateKey.match(/^[a-f0-9]{64}$/)) return true;
  try {
    if (nip19.decode(privateKey).type === 'nsec') return true;
  } catch (err) {
    // Invalid format
  }
  return false;
}

//#endregion Private Key Utilities
