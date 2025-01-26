import browser from 'webextension-polyfill';
import { validateEvent, finalizeEvent, getPublicKey, nip44 } from 'nostr-tools';
import { nip04 } from 'nostr-tools';

import * as Storage from './storage';
import {
  AuthorizationCondition,
  ContentMessageArgs,
  ContentScriptMessageResponse,
  OpenPromptItem,
  PromptParams,
  PromptResponse
} from './types';
import { PERMISSIONS_REQUIRED, convertHexToUint8Array } from './common';
import { LRUCache } from './LRUCache';
import PromptManager from './PromptManager';

/** Map to keep track of open prompts so we can properly capture the responses and close them */
const openPromptMap: Record<
  string,
  { id: string; windowId?: number; resolve: Function; reject: Function }
> = {};

browser.runtime.onMessage.addListener((message, sender) => {
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
  const openPrompts = Object.values(openPromptMap).filter(
    ({ windowId }) => windowId === _windowId
  );

  console.debug(
    `Window ${_windowId} closed. Closing ${openPrompts.length} prompts.`
  );

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
      const isAllowed = await promptPermission(
        host,
        PERMISSIONS_REQUIRED[type],
        params
      );
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

  let privateKey = await Storage.readActivePrivateKey();
  if (!privateKey) {
    return { error: { message: 'no private key found' } };
  }

  // privateKey is in hexa, we must convert to UInt8Array for working
  const sk = convertHexToUint8Array(privateKey);

  try {
    switch (type) {
      case 'getPublicKey': {
        return getPublicKey(sk);
      }
      case 'getRelays': {
        let relays = await Storage.readActiveRelays();
        return relays || {};
      }
      case 'signEvent': {
        if (!params.event) {
          return { error: { message: 'empty event' } };
        }

        const activePubKey = getPublicKey(sk);
        // check if the pubkey used corresponds to the active profile
        // only do it when pubkey is not empty, since some sites don't specify it
        if (params.event?.pubkey && params.event.pubkey !== activePubKey) {
          console.warn(
            `Pubkey used (${params.event.pubkey}) doesn't match the active profile (${activePubKey}).`
          );
          throw new Error(`Public key used doesn't match the active profile.`);
        }

        const event = finalizeEvent(params.event, sk);

        return validateEvent(event)
          ? event
          : { error: { message: 'invalid event' } };
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

function promptPermission(
  host: string,
  level: number,
  params: PromptParams
): Promise<boolean> {
  let id = Math.random().toString().slice(4);

  return new Promise((resolve, reject) => {
    const promptPageURL = `${browser.runtime.getURL('prompt.html')}`;

    let openPromptPromise: Promise<browser.Windows.Window | browser.Tabs.Tab>;

    // check if there is already a prompt popup window open
    if (Object.values(openPromptMap).length > 0) {
      console.debug('There is already a prompt popup window open.');
      // simulate the promise using the existing window id
      openPromptPromise = new Promise((resolve, reject) => {
        const openPrompt = Object.values(openPromptMap).find(
          ({ windowId }) => windowId
        );
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
