import browser from 'webextension-polyfill';
import { validateEvent, finalizeEvent, getPublicKey, nip44 } from 'nostr-tools';
import { nip04 } from 'nostr-tools';

import * as Storage from './storage';
import {
  AuthorizationCondition,
  ConfigurationKeys,
  ContentMessageArgs,
  ContentScriptMessageResponse,
  OpenPromptItem,
  PinMessage,
  PinMessageResponse,
  PromptParams,
  PromptResponse
} from './types';
import {
  PERMISSIONS_REQUIRED,
  convertHexToUint8Array,
  openPopupWindow,
  derivePublicKeyFromPrivateKey,
  normalizeCustomAuthorizationDurationSeconds
} from './common';
import { LRUCache } from './LRUCache';
import PromptManager from './PromptManager';
import { getCachedPin, setCachedPin, clearCachedPin } from './pinCache';
import { decryptPrivateKey, encryptPrivateKey } from './pinEncryption';
import { clearUint8Array, clearStringReference } from './memoryUtils';

/** Map to keep track of open prompts so we can properly capture the responses and close them */
const openPromptMap: Record<
  string,
  {
    id: string;
    windowId?: number;
    host: string;
    level: number;
    resolve: Function;
    reject: Function;
  }
> = {};

/** Map to keep track of PIN prompts */
const pinPromptMap: Record<
  string,
  { id: string; windowId?: number; resolve: Function; reject: Function; mode: string }
> = {};

/** Brute-force rate-limiting for PIN verification attempts */
const MAX_FREE_PIN_ATTEMPTS = 5;
const MAX_PIN_LOCKOUT_MS = 5 * 60 * 1000;
let failedPinAttempts = 0;
let pinLockoutUntil = 0;

/** Handlers that must never answer something running in a web page. */
const EXTENSION_PAGES_ONLY = new Set([
  'setupPin',
  'verifyPin',
  'disablePin',
  'openPinPrompt',
  'encryptPrivateKey',
  'getCachedPin'
]);

/**
 * Did this come from one of our own pages, rather than from a content script in a web page?
 *
 * NOT `sender.tab`. The options page is opened with tabs.create(), so it has a tab like any web
 * page does — checking for one blocks the extension from talking to itself, and PIN protection
 * stops working with nothing on screen to say why. That was tried first and it cost a release.
 *
 * `sender.url` is the discriminator that holds. For a content script it is the address of the page
 * it was injected into, never a moz-extension:// one; content scripts do not run on extension
 * pages, and a web page cannot reach this listener at all.
 */
function fromOwnPage(sender: browser.Runtime.MessageSender): boolean {
  const base = browser.runtime.getURL('');
  return typeof sender?.url === 'string' && sender.url.startsWith(base);
}

/**
 * Derives the authoritative origin host from the browser-populated `sender.url`,
 * falling back to `fallbackHost` only if `sender.url` cannot be parsed.
 */
function resolveSenderHost(sender: browser.Runtime.MessageSender, fallbackHost: string): string {
  if (typeof sender?.url === 'string' && sender.url) {
    try {
      const parsed = new URL(sender.url);
      if (parsed.host) {
        return parsed.host;
      }
    } catch {
      // fall through to fallbackHost
    }
  }
  return fallbackHost;
}

browser.runtime.onMessage.addListener(async (message, sender) => {
  // The content script's allow-list is not the only thing that should be refusing these — this is
  // the half that survives somebody adding a second bridge later and forgetting.
  if (
    !fromOwnPage(sender) &&
    (EXTENSION_PAGES_ONLY.has(message?.type) || Boolean((message as PromptResponse)?.prompt))
  ) {
    return { success: false, error: 'not available to pages' };
  }

  // Check if it's a PIN message
  if (
    message.type === 'setupPin' ||
    message.type === 'verifyPin' ||
    message.type === 'disablePin'
  ) {
    return handlePinMessage(message as PinMessage, sender);
  }

  // Check if it's a request to open a PIN prompt
  if (message.type === 'openPinPrompt') {
    const mode = message.mode as 'setup' | 'unlock' | 'disable';
    if (mode && ['setup', 'unlock', 'disable'].includes(mode)) {
      await promptPin(mode);
      return { success: true };
    }
    return { success: false, error: 'Invalid PIN mode' };
  }

  // Check if it's a request to encrypt a private key
  if (message.type === 'encryptPrivateKey') {
    const pinEnabled = await Storage.isPinEnabled();
    if (!pinEnabled) {
      return { success: false, error: 'PIN protection is not enabled' };
    }

    const { privateKey } = message;
    if (!privateKey) {
      return { success: false, error: 'Private key is required' };
    }

    // Check if PIN is cached, if not prompt for it
    let pin = await getCachedPin();
    if (!pin) {
      pin = await promptPin('unlock');
      if (!pin) {
        return { success: false, error: 'PIN is required to encrypt private key' };
      }
      await setCachedPin(pin);
    }

    try {
      const encryptedKey = await encryptPrivateKey(pin, privateKey);
      return { success: true, encryptedKey };
    } catch (error) {
      return { success: false, error: error.message };
    } finally {
      // Clear PIN reference after use (strings are immutable, but we null the reference)
      pin = clearStringReference(pin) as any;
    }
  }

  // Check if it's a request to get cached PIN status (never return the raw PIN over messaging)
  if (message.type === 'getCachedPin') {
    let pin = await getCachedPin();
    const cached = Boolean(pin);
    pin = clearStringReference(pin) as any;
    return { success: true, cached };
  }

  let { prompt } = message as PromptResponse;

  if (prompt) {
    return handlePromptMessage(message as PromptResponse, sender);
  } else {
    const contentMsg = message as ContentMessageArgs;
    const verifiedHost = resolveSenderHost(sender, contentMsg.host);
    return handleContentScriptMessage({
      type: contentMsg.type,
      params: contentMsg.params,
      host: verifiedHost
    });
  }
});

browser.runtime.onMessageExternal.addListener(async (message, sender) => {
  if (!sender?.url) {
    return { error: { message: 'Unauthorized external sender' } };
  }
  let extensionId: string;
  try {
    extensionId = new URL(sender.url).host;
  } catch {
    return { error: { message: 'Invalid external sender URL' } };
  }
  if (!extensionId) {
    return { error: { message: 'Missing external sender host' } };
  }
  const { type, params } = (message ?? {}) as ContentMessageArgs;
  if (!Object.prototype.hasOwnProperty.call(PERMISSIONS_REQUIRED, type)) {
    return { error: { message: `Unsupported external request type "${type}"` } };
  }
  return handleContentScriptMessage({ type, params, host: extensionId });
});

// Clear any stale open prompts on browser startup
// This handles the case where prompts were pending when browser crashed/closed
browser.runtime.onStartup.addListener(async () => {
  console.debug('Browser startup detected. Clearing stale open prompts.');
  await PromptManager.clear();
});

// Clear stale open prompts on extension install/update/reload
browser.runtime.onInstalled.addListener(async () => {
  console.debug('Extension installed/updated. Clearing stale open prompts.');
  await PromptManager.clear();
});

/**
 * Handles the closing of a prompt or PIN popup window.
 * Rejects all pending prompts associated with the closed window.
 *
 * @param closedId - The ID of the closed window (or tab on Android).
 */
function handlePromptPopupClosed(closedId: number) {
  // Search the open prompts with this window ID
  const openPrompts = Object.values(openPromptMap).filter(({ windowId }) => windowId === closedId);

  console.debug(`Prompt popup ${closedId} closed. Closing ${openPrompts.length} prompts.`);

  // Handle the rejection on all of them
  // We need to do it sequentially, hence the async trick
  const closeAllAsync = async () => {
    for (const openPrompt of openPrompts) {
      await handlePromptMessage(
        {
          id: openPrompt.id,
          prompt: true,
          condition: AuthorizationCondition.REJECT,
          host: null
        },
        null
      );
    }
  };
  closeAllAsync(); // now run

  // Also handle PIN prompts
  const pinPrompts = Object.values(pinPromptMap).filter(({ windowId }) => windowId === closedId);
  for (const pinPrompt of pinPrompts) {
    pinPrompt.reject(new Error('PIN prompt window closed'));
    delete pinPromptMap[pinPrompt.id];
  }
}

// Listen for popup closing, with support for both Desktop and Android Firefox
if (browser.windows) {
  browser.windows.onRemoved.addListener(windowId => {
    handlePromptPopupClosed(windowId);
  });
} else {
  // Android Firefox — popups are tabs, not windows
  browser.tabs.onRemoved.addListener(tabId => {
    handlePromptPopupClosed(tabId);
  });
}

/**
 * Handles a message from the content script by processing the specified type and parameters.
 *
 * @param type - The type of operation to be performed.
 * @param params - The prompt parameters required for the operation.
 * @param host - The host from which the message originated.
 * @returns A response object which can be an Error, a pubkey, a VerifiedEvent or a RelaysConfig.
 */
async function handleContentScriptMessage({
  type,
  params,
  host
}: ContentMessageArgs): Promise<ContentScriptMessageResponse> {
  let level = await readPermissionLevel(host);

  if (level >= PERMISSIONS_REQUIRED[type]) {
    // authorized, proceed
  } else {
    // ask for authorization
    try {
      const isAllowed = await promptPermission(host, PERMISSIONS_REQUIRED[type], params);
      if (!isAllowed) {
        // not authorized, stop here
        return {
          error: {
            message: `Insufficient permissions, required ${PERMISSIONS_REQUIRED[type]}`
          }
        };
      }
    } catch (error) {
      console.error('Error asking for permission.', error);
      return { error: { message: error.message, stack: error.stack } };
    }
  }

  // Get decrypted private key (handles PIN protection automatically)
  let privateKey = await getDecryptedPrivateKey();
  if (!privateKey) {
    return { error: { message: 'no private key found' } };
  }

  // Minimize private key exposure: convert to Uint8Array immediately
  // Derive public key before clearing private key string
  const activePubKey = derivePublicKeyFromPrivateKey(privateKey);

  // Convert private key string to Uint8Array and clear string reference immediately
  const sk = convertHexToUint8Array(privateKey);
  // Clear private key string reference (strings are immutable, but we null the reference)
  privateKey = clearStringReference(privateKey) as any;

  try {
    switch (type) {
      case 'getPublicKey': {
        return activePubKey;
      }
      case 'getRelays': {
        let relays = await Storage.readActiveRelays();
        return relays || {};
      }
      case 'signEvent': {
        if (!params.event) {
          return { error: { message: 'empty event' } };
        }

        // check if the pubkey used corresponds to the active profile
        // only do it when pubkey is not empty, since some sites don't specify it
        if (params.event?.pubkey && params.event.pubkey !== activePubKey) {
          console.warn(
            `Pubkey used (${params.event.pubkey}) doesn't match the active profile (${activePubKey}).`
          );
          throw new Error(`Public key used doesn't match the active profile.`);
        }

        const event = finalizeEvent(params.event, sk);

        return validateEvent(event) ? event : { error: { message: 'invalid event' } };
      }
      case 'nip04.encrypt': {
        let { peer, plaintext } = params;
        return nip04.encrypt(sk, peer, plaintext as string);
      }
      case 'nip04.decrypt': {
        let { peer, ciphertext } = params;
        return nip04.decrypt(sk, peer, ciphertext as string);
      }
      case 'nip44.encrypt': {
        const { peer, plaintext } = params;
        const key = getSharedSecret(sk, activePubKey, peer);
        return nip44.v2.encrypt(plaintext as string, key);
      }
      case 'nip44.decrypt': {
        const { peer, ciphertext } = params;
        const key = getSharedSecret(sk, activePubKey, peer);
        return nip44.v2.decrypt(ciphertext as string, key);
      }
      default: {
        return { error: { message: `Unknown type "${type}"` } };
      }
    }
  } catch (error) {
    return { error: { message: error.message, stack: error.stack } };
  } finally {
    // Clear private key Uint8Array from memory after operations complete
    clearUint8Array(sk);
  }
}

async function handlePromptMessage(
  { id, condition, durationSeconds }: PromptResponse,
  sender
): Promise<void> {
  const openPrompt = openPromptMap[id];
  if (!openPrompt) {
    console.warn('Message from unrecognized prompt: ', id);
    // Still remove from storage to prevent stale entries accumulating
    await PromptManager.remove(id);
    return;
  }

  if (sender) {
    if (!fromOwnPage(sender)) {
      console.warn('Rejected prompt message from non-extension page');
      return;
    }
    const senderWindowOrTabId = browser.windows ? sender.tab?.windowId : sender.tab?.id;
    if (
      openPrompt.windowId !== undefined &&
      senderWindowOrTabId !== undefined &&
      senderWindowOrTabId !== openPrompt.windowId
    ) {
      console.warn('Rejected prompt message from mismatched window/tab');
      return;
    }
  }

  // Always use the authoritative host and permission level bound when the prompt was opened
  const targetHost = openPrompt.host;
  const targetLevel = openPrompt.level;

  try {
    switch (condition) {
      case AuthorizationCondition.FOREVER:
      case AuthorizationCondition.EXPIRABLE_5M:
      case AuthorizationCondition.EXPIRABLE_1H:
      case AuthorizationCondition.EXPIRABLE_8H:
        if (targetHost && targetLevel) {
          await Storage.addActivePermission(targetHost, condition, targetLevel);
          openPrompt.resolve?.(true);
        } else {
          console.warn('No authorization host or level bound to prompt');
          openPrompt.resolve?.(false);
        }
        break;
      case AuthorizationCondition.EXPIRABLE_CUSTOM: {
        const normalizedSeconds = normalizeCustomAuthorizationDurationSeconds(durationSeconds);
        if (targetHost && targetLevel && normalizedSeconds != null) {
          await Storage.addActivePermission(
            targetHost,
            condition,
            targetLevel,
            normalizedSeconds
          );
          openPrompt.resolve?.(true);
        } else {
          console.warn('Invalid custom authorization duration or missing level');
          openPrompt.resolve?.(false);
        }
        break;
      }
      case AuthorizationCondition.SINGLE:
        openPrompt.resolve?.(true);
        break;
      case AuthorizationCondition.REJECT:
        openPrompt.resolve?.(false);
        break;
    }

    // remove the prompt from the map
    delete openPromptMap[id];

    // close prompt
    if (sender) {
      const openPrompts = await PromptManager.get();

      // only close the prompt window if there is no other prompt pending
      if (openPrompts.length == 1) {
        if (browser.windows) {
          await browser.windows.remove(sender.tab.windowId);
        } else {
          // Android Firefox
          await browser.tabs.remove(sender.tab.id);
        }
      }
    }
    // remove the prompt from the storage
    await PromptManager.remove(id);
  } catch (error) {
    console.error('Error handling prompt response.', error);
    openPrompt.reject?.(error);
  }
}

function promptPermission(host: string, level: number, params: PromptParams): Promise<boolean> {
  let id = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const promptPageURL = `${browser.runtime.getURL('prompt.html')}`;

    let openPromptPromise: Promise<browser.Windows.Window | browser.Tabs.Tab>;

    // check if there is already a prompt popup window open
    if (Object.values(openPromptMap).length > 0) {
      console.debug('There is already a prompt popup window open.');
      // simulate the promise using the existing window id
      openPromptPromise = new Promise((resolve, reject) => {
        const openPrompt = Object.values(openPromptMap).find(({ windowId }) => windowId);
        if (openPrompt) {
          const getPopup = browser.windows
            ? browser.windows.get(openPrompt.windowId as number)
            : browser.tabs.get(openPrompt.windowId as number);
          getPopup.then(win => resolve(win)).catch(reject);
        } else {
          reject(new Error('No open prompt window found'));
        }
      });
    } else {
      console.debug('There is no prompt popup window open. Creating one.');
      // open the popup window
      if (browser.windows) {
        openPromptPromise = browser.windows.create({
          url: promptPageURL,
          type: 'popup',
          width: 600,
          height: 400
        });
      } else {
        // Android Firefox
        openPromptPromise = browser.tabs.create({
          url: promptPageURL,
          active: true
        });
      }
    }

    // when the prompt is opened (or found open), add it to the queue
    openPromptPromise
      .then(win => {
        // add the prompt to the local map with authoritative host & level
        openPromptMap[id] = { id, windowId: win.id, host, level, resolve, reject };
        // add to the storage
        PromptManager.add({ id, windowId: win.id, host, level, params });
      })
      .catch(reject);
  });
}

async function readPermissionLevel(host: string): Promise<number> {
  return (await Storage.readActivePermissions())[host]?.level || 0;
}

/**
 * Gets the decrypted private key, handling PIN protection automatically
 * This encapsulates all PIN logic - the rest of the code doesn't need to know about PIN
 * - Checks if PIN protection is enabled
 * - If enabled: checks cache, prompts if needed, decrypts
 * - If disabled: returns plain key from storage
 */
async function getDecryptedPrivateKey(): Promise<string | null> {
  const pinEnabled = await Storage.isPinEnabled();

  if (!pinEnabled) {
    // PIN protection disabled, return plain key
    return await Storage.readActivePrivateKey();
  }

  // PIN protection enabled, check cache first
  let pin = await getCachedPin();
  if (!pin) {
    // Cache expired or not set, prompt for PIN
    pin = await promptPin('unlock');
    if (!pin) {
      return null; // User cancelled or error
    }
    await setCachedPin(pin);
  }

  // Decrypt private key using PIN
  let decryptedKey: string | null = null;
  try {
    const encryptedKey = await Storage.getEncryptedPrivateKey();
    if (!encryptedKey) {
      throw new Error('Encrypted private key not found');
    }
    decryptedKey = await decryptPrivateKey(pin, encryptedKey);
    return decryptedKey;
  } catch (error) {
    // Decryption failed, clear cache and return error
    clearCachedPin();
    throw error;
  } finally {
    // Clear PIN reference after use (strings are immutable, but we null the reference)
    // Note: pin may still be cached, but we clear the local reference
    pin = clearStringReference(pin) as any;
  }
}

/**
 * Prompts the user for PIN entry
 * @param mode - 'setup', 'unlock', or 'disable'
 * @returns The entered PIN, or null if cancelled/error
 */
function promptPin(mode: 'setup' | 'unlock' | 'disable'): Promise<string | null> {
  let id = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    let openPinPromise: Promise<browser.Windows.Window | browser.Tabs.Tab>;

    // Check if there is already a PIN prompt window open
    const existingPinPrompt = Object.values(pinPromptMap).find(p => p.mode === mode);
    if (existingPinPrompt) {
      console.debug('There is already a PIN prompt window open.');
      openPinPromise = new Promise((resolve, reject) => {
        if (existingPinPrompt.windowId) {
          const getPopup = browser.windows
            ? browser.windows.get(existingPinPrompt.windowId as number)
            : browser.tabs.get(existingPinPrompt.windowId as number);
          getPopup.then(win => resolve(win)).catch(reject);
        } else {
          reject(new Error('No open PIN prompt window found'));
        }
      });
    } else {
      console.debug('Opening PIN prompt window.');
      // Use common openPopupWindow function
      const pinPageURL = `pin.html?mode=${mode}&id=${id}`;
      openPinPromise = openPopupWindow(pinPageURL, { width: 400, height: 300 });
    }

    // when the prompt is opened (or found open), add it to the map
    openPinPromise
      .then(win => {
        pinPromptMap[id] = { id, windowId: win.id, resolve, reject, mode };
      })
      .catch(reject);
  });
}

function recordFailedPinAttempt(): void {
  failedPinAttempts += 1;
  if (failedPinAttempts >= MAX_FREE_PIN_ATTEMPTS) {
    const backoffMs = Math.min(
      MAX_PIN_LOCKOUT_MS,
      1000 * Math.pow(2, failedPinAttempts - MAX_FREE_PIN_ATTEMPTS + 1)
    );
    pinLockoutUntil = Date.now() + backoffMs;
  }
}

function resetFailedPinAttempts(): void {
  failedPinAttempts = 0;
  pinLockoutUntil = 0;
}

/**
 * Handles PIN-related messages from the PIN prompt UI
 */
async function handlePinMessage(
  message: PinMessage,
  sender: browser.Runtime.MessageSender
): Promise<PinMessageResponse> {
  if (!fromOwnPage(sender)) {
    return { success: false, error: 'Unauthorized sender' };
  }

  const { type, pin, encryptedKey, id } = message;
  const pinPrompt = id ? pinPromptMap[id] : undefined;

  if (!pinPrompt) {
    return { success: false, error: 'PIN prompt not found' };
  }

  const senderWindowOrTabId = browser.windows ? sender.tab?.windowId : sender.tab?.id;
  if (
    pinPrompt.windowId !== undefined &&
    senderWindowOrTabId !== undefined &&
    senderWindowOrTabId !== pinPrompt.windowId
  ) {
    return { success: false, error: 'PIN prompt window mismatch' };
  }

  if (type === 'verifyPin' || type === 'disablePin') {
    const now = Date.now();
    if (now < pinLockoutUntil) {
      const waitSec = Math.ceil((pinLockoutUntil - now) / 1000);
      return {
        success: false,
        error: `Too many failed PIN attempts. Try again in ${waitSec}s.`
      };
    }
  }

  // Extract PIN to local variable for clearing after use
  let localPin = pin;

  try {
    switch (type) {
      case 'setupPin': {
        if (!localPin || !encryptedKey) {
          return { success: false, error: 'Missing PIN or encrypted key' };
        }

        // Enable PIN protection with the provided encrypted key
        await Storage.setEncryptedPrivateKey(encryptedKey);

        // Encrypt all profile keys and store active public key
        await Storage.enablePinProtectionWithEncryptedKey(localPin, encryptedKey);

        // Cache PIN and reset failed attempt counter
        resetFailedPinAttempts();
        await setCachedPin(localPin);

        // Resolve PIN prompt
        if (pinPrompt) {
          pinPrompt.resolve(localPin);
          delete pinPromptMap[pinPrompt.id];
        }

        // Close PIN window
        if (sender && sender.tab) {
          if (browser.windows && sender.tab.windowId !== undefined) {
            await browser.windows.remove(sender.tab.windowId);
          } else if (sender.tab.id !== undefined) {
            await browser.tabs.remove(sender.tab.id);
          }
        }

        return { success: true };
      }

      case 'verifyPin': {
        if (!localPin) {
          return { success: false, error: 'Missing PIN' };
        }

        // Verify PIN by attempting to decrypt
        const encryptedKey = await Storage.getEncryptedPrivateKey();
        if (!encryptedKey) {
          return { success: false, error: 'No encrypted key found' };
        }

        try {
          await decryptPrivateKey(localPin, encryptedKey);
          // PIN is correct, reset failed counter and cache it
          resetFailedPinAttempts();
          await setCachedPin(localPin);

          // Resolve PIN prompt
          if (pinPrompt) {
            pinPrompt.resolve(localPin);
            delete pinPromptMap[pinPrompt.id];
          }

          // Close PIN window
          if (sender && sender.tab) {
            if (browser.windows && sender.tab.windowId !== undefined) {
              await browser.windows.remove(sender.tab.windowId);
            } else if (sender.tab.id !== undefined) {
              await browser.tabs.remove(sender.tab.id);
            }
          }

          return { success: true };
        } catch (error) {
          recordFailedPinAttempt();
          return { success: false, error: 'Incorrect PIN' };
        }
      }

      case 'disablePin': {
        if (!localPin) {
          return { success: false, error: 'Missing PIN' };
        }

        // Verify PIN and disable protection
        try {
          await Storage.disablePinProtection(localPin);
        } catch (error) {
          recordFailedPinAttempt();
          return { success: false, error: 'Incorrect PIN' };
        }

        resetFailedPinAttempts();
        clearCachedPin();

        // Resolve PIN prompt
        if (pinPrompt) {
          pinPrompt.resolve(localPin);
          delete pinPromptMap[pinPrompt.id];
        }

        // Close PIN window
        if (sender && sender.tab) {
          if (browser.windows && sender.tab.windowId !== undefined) {
            await browser.windows.remove(sender.tab.windowId);
          } else if (sender.tab.id !== undefined) {
            await browser.tabs.remove(sender.tab.id);
          }
        }

        return { success: true };
      }

      default:
        return { success: false, error: 'Unknown PIN message type' };
    }
  } catch (error) {
    if (pinPrompt) {
      pinPrompt.reject(error);
      delete pinPromptMap[pinPrompt.id];
    }
    return { success: false, error: error.message };
  } finally {
    // Clear PIN reference after use (strings are immutable, but we null the reference)
    localPin = clearStringReference(localPin) as any;
  }
}

// prepare a cache of the last 100 shared keys used, keyed by active profile pubkey
const secretsCache = new LRUCache<string, Uint8Array>(100);
let previousPubKey: string | null = null;
function getSharedSecret(sk: Uint8Array, activePubKey: string, peer: string) {
  // Detect an active profile change and erase + zeroize cached conversation keys
  if (previousPubKey !== activePubKey) {
    secretsCache.clear();
    previousPubKey = activePubKey;
  }

  let key = secretsCache.get(peer);

  if (!key) {
    key = nip44.v2.utils.getConversationKey(sk, peer);
    secretsCache.set(peer, key);
  }

  return key;
}
