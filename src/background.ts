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
  derivePublicKeyFromPrivateKey
} from './common';
import { LRUCache } from './LRUCache';
import PromptManager from './PromptManager';
import { getCachedPin, setCachedPin, clearCachedPin } from './pinCache';
import { decryptPrivateKey, encryptPrivateKey } from './pinEncryption';

/** Map to keep track of open prompts so we can properly capture the responses and close them */
const openPromptMap: Record<
  string,
  { id: string; windowId?: number; resolve: Function; reject: Function }
> = {};

/** Map to keep track of PIN prompts */
const pinPromptMap: Record<
  string,
  { id: string; windowId?: number; resolve: Function; reject: Function; mode: string }
> = {};

browser.runtime.onMessage.addListener(async (message, sender) => {
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
      setCachedPin(pin);
    }

    try {
      const encryptedKey = await encryptPrivateKey(pin, privateKey);
      return { success: true, encryptedKey };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Check if it's a request to get cached PIN status
  if (message.type === 'getCachedPin') {
    const pin = await getCachedPin();
    return { success: true, pin };
  }

  let { prompt } = message as PromptResponse;

  if (prompt) {
    handlePromptMessage(message as PromptResponse, sender);
  } else {
    return handleContentScriptMessage(message as ContentMessageArgs);
  }
});

browser.runtime.onMessageExternal.addListener(async (message, sender) => {
  const { type, params } = message as ContentMessageArgs;
  let extensionId = new URL(sender.url ?? '').host;
  return handleContentScriptMessage({ type, params, host: extensionId });
});

browser.windows.onRemoved.addListener(_windowId => {
  // Search the open prompts with this window ID
  const openPrompts = Object.values(openPromptMap).filter(({ windowId }) => windowId === _windowId);

  console.debug(`Window ${_windowId} closed. Closing ${openPrompts.length} prompts.`);

  // Handle the rejection on all of them
  // We need to do it sequentially, hence the async trick
  const closeAllAsync = async () => {
    for (const openPrompt of openPrompts) {
      // Since the window is closed, then take it as a Reject
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
  const pinPrompts = Object.values(pinPromptMap).filter(({ windowId }) => windowId === _windowId);
  for (const pinPrompt of pinPrompts) {
    pinPrompt.reject(new Error('PIN prompt window closed'));
    delete pinPromptMap[pinPrompt.id];
  }
});

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
  const privateKey = await getDecryptedPrivateKey();
  if (!privateKey) {
    return { error: { message: 'no private key found' } };
  }

  // privateKey is in hexa, we must convert to UInt8Array for working
  const sk = convertHexToUint8Array(privateKey);

  // Derive public key once for reuse
  const activePubKey = derivePublicKeyFromPrivateKey(privateKey);

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
        const key = getSharedSecret(sk, peer);
        return nip44.v2.encrypt(plaintext as string, key);
      }
      case 'nip44.decrypt': {
        const { peer, ciphertext } = params;
        const key = getSharedSecret(sk, peer);
        return nip44.v2.decrypt(ciphertext as string, key);
      }
      default: {
        return { error: { message: `Uunknown type "${type}"` } };
      }
    }
  } catch (error) {
    return { error: { message: error.message, stack: error.stack } };
  }
}

async function handlePromptMessage(
  { id, condition, host, level }: PromptResponse,
  sender
): Promise<void> {
  const openPrompt = openPromptMap[id];
  if (!openPrompt) {
    console.warn('Message from unrecognized prompt: ', id);
    return;
  }

  try {
    switch (condition) {
      case AuthorizationCondition.FOREVER:
      case AuthorizationCondition.EXPIRABLE_5M:
      case AuthorizationCondition.EXPIRABLE_1H:
      case AuthorizationCondition.EXPIRABLE_8H:
        if (level) {
          openPrompt.resolve?.(true);
          Storage.addActivePermission(host ?? '', condition, level);
        } else {
          console.warn('No authorization level provided');
        }
        break;
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
  let id = Math.random().toString().slice(4);

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
          browser.windows.get(openPrompt.windowId as number).then(win => {
            resolve(win);
          });
        } else {
          reject();
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
    openPromptPromise.then(win => {
      // add the prompt to the local map
      openPromptMap[id] = { id, windowId: win.id, resolve, reject };
      // add to the storage
      PromptManager.add({ id, windowId: win.id, host, level, params });
    });
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
    setCachedPin(pin);
  }

  // Decrypt private key using PIN
  try {
    const encryptedKey = await Storage.getEncryptedPrivateKey();
    if (!encryptedKey) {
      throw new Error('Encrypted private key not found');
    }
    const decryptedKey = await decryptPrivateKey(pin, encryptedKey);
    return decryptedKey;
  } catch (error) {
    // Decryption failed, clear cache and return error
    clearCachedPin();
    throw error;
  }
}

/**
 * Prompts the user for PIN entry
 * @param mode - 'setup', 'unlock', or 'disable'
 * @returns The entered PIN, or null if cancelled/error
 */
function promptPin(mode: 'setup' | 'unlock' | 'disable'): Promise<string | null> {
  let id = Math.random().toString().slice(4);

  return new Promise((resolve, reject) => {
    let openPinPromise: Promise<browser.Windows.Window | browser.Tabs.Tab>;

    // Check if there is already a PIN prompt window open
    const existingPinPrompt = Object.values(pinPromptMap).find(p => p.mode === mode);
    if (existingPinPrompt) {
      console.debug('There is already a PIN prompt window open.');
      openPinPromise = new Promise((resolve, reject) => {
        if (existingPinPrompt.windowId) {
          browser.windows.get(existingPinPrompt.windowId as number).then(win => {
            resolve(win);
          });
        } else {
          reject();
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

/**
 * Handles PIN-related messages from the PIN prompt UI
 */
async function handlePinMessage(
  message: PinMessage,
  sender: browser.Runtime.MessageSender
): Promise<PinMessageResponse> {
  const { type, pin, encryptedKey, id } = message;
  const pinPrompt = id ? pinPromptMap[id] : pinPromptMap[Object.keys(pinPromptMap)[0]];

  if (!pinPrompt) {
    return { success: false, error: 'PIN prompt not found' };
  }

  try {
    switch (type) {
      case 'setupPin': {
        if (!pin || !encryptedKey) {
          return { success: false, error: 'Missing PIN or encrypted key' };
        }

        // Enable PIN protection with the provided encrypted key
        await Storage.setEncryptedPrivateKey(encryptedKey);

        // Encrypt all profile keys and store active public key
        await Storage.enablePinProtectionWithEncryptedKey(pin, encryptedKey);

        // Cache PIN
        setCachedPin(pin);

        // Resolve PIN prompt
        if (pinPrompt) {
          pinPrompt.resolve(pin);
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
        if (!pin) {
          return { success: false, error: 'Missing PIN' };
        }

        // Verify PIN by attempting to decrypt
        const encryptedKey = await Storage.getEncryptedPrivateKey();
        if (!encryptedKey) {
          return { success: false, error: 'No encrypted key found' };
        }

        try {
          await decryptPrivateKey(pin, encryptedKey);
          // PIN is correct, cache it
          setCachedPin(pin);

          // Resolve PIN prompt
          if (pinPrompt) {
            pinPrompt.resolve(pin);
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
          return { success: false, error: 'Incorrect PIN' };
        }
      }

      case 'disablePin': {
        if (!pin) {
          return { success: false, error: 'Missing PIN' };
        }

        // Verify PIN and disable protection
        await Storage.disablePinProtection(pin);
        clearCachedPin();

        // Resolve PIN prompt
        if (pinPrompt) {
          pinPrompt.resolve(pin);
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
  }
}

// prepare a cache of the last 100 shared keys used
const secretsCache = new LRUCache<string, Uint8Array>(100);
let previousSk: Uint8Array | null = null;
function getSharedSecret(sk: Uint8Array, peer: string) {
  // Detect a private key change and erase the cache if they changed their key
  if (previousSk !== sk) {
    secretsCache.clear();
  }

  let key = secretsCache.get(peer);

  if (!key) {
    key = nip44.v2.utils.getConversationKey(sk, peer);
    secretsCache.set(peer, key);
  }

  return key;
}
