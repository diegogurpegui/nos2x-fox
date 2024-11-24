import browser from 'webextension-polyfill';
import { validateEvent, finalizeEvent, getPublicKey, nip44 } from 'nostr-tools';
import { nip04 } from 'nostr-tools';

import * as Storage from './storage';
import { AuthorizationCondition, PromptResponse } from './types';
import { PERMISSIONS_REQUIRED, convertHexToUint8Array } from './common';
import { LRUCache } from './LRUCache';

let openPrompt: { resolve: Function; reject: Function } | null = null;

browser.runtime.onMessage.addListener((message, sender) => {
  let { prompt } = message;

  if (prompt) {
    handlePromptMessage(message, sender);
  } else {
    return handleContentScriptMessage(message);
  }
});

browser.runtime.onMessageExternal.addListener(
  async ({ type, params }, sender) => {
    let extensionId = new URL(sender.url).host;
    handleContentScriptMessage({ type, params, host: extensionId });
  }
);

browser.windows.onRemoved.addListener(_windowId => {
  if (openPrompt) {
    // If the window is closed, then take it as a Reject
    handlePromptMessage(
      {
        prompt: true,
        condition: AuthorizationCondition.REJECT,
        host: null
      },
      null
    );
  }
});

async function handleContentScriptMessage({ type, params, host }) {
  let level = await readPermissionLevel(host);

  let permName = type
  // initPublicKey doesn't need a separate permission, use getPublicKey.
  if (type == 'initPublicKey') permName = 'getPublicKey';

  if (level >= PERMISSIONS_REQUIRED[permName]) {
    // authorized, proceed
  } else {
    if (type === 'initPublicKey') {
      // Pubkey not authorized.
      return null
    }

    // ask for authorization
    try {
      const isAllowed = await promptPermission(
        host,
        PERMISSIONS_REQUIRED[permName],
        params
      );
      if (!isAllowed) {
        // not authorized, stop here
        return {
          error: `Insufficient permissions, required ${PERMISSIONS_REQUIRED[permName]}`
        };
      }
    } catch (error) {
      console.error('Error asking for permission.', error);
      return { error: { message: error.message, stack: error.stack } };
    }
  }

  let privateKey = await Storage.readActivePrivateKey();
  if (!privateKey) {
    return { error: 'no private key found' };
  }

  // privateKey is in hexa, we must convert to UInt8Array for working
  const sk = convertHexToUint8Array(privateKey);

  try {
    switch (type) {
      case 'initPublicKey':
      case 'getPublicKey': {
        return getPublicKey(sk);
      }
      case 'getRelays': {
        let relays = await Storage.readActiveRelays();
        return relays || {};
      }
      case 'signEvent': {
        const activePubKey = getPublicKey(sk);
        // check if the pubkey used corresponds to the active profile
        // only do it when pubkey is not empty, since some sites don't specify it
        if (params.event.pubkey && params.event.pubkey !== activePubKey) {
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
        return nip04.encrypt(sk, peer, plaintext);
      }
      case 'nip04.decrypt': {
        let { peer, ciphertext } = params;
        return nip04.decrypt(sk, peer, ciphertext);
      }
      case 'nip44.encrypt': {
        const { peer, plaintext } = params;
        const key = getSharedSecret(sk, peer);
        return nip44.v2.encrypt(plaintext, key);
      }
      case 'nip44.decrypt': {
        const { peer, ciphertext } = params;
        const key = getSharedSecret(sk, peer);
        return nip44.v2.decrypt(ciphertext, key);
      }
    }
  } catch (error) {
    return { error: { message: error.message, stack: error.stack } };
  }
}

function handlePromptMessage(
  { id, condition, host, level }: PromptResponse,
  sender
) {
  try {
    switch (condition) {
      case AuthorizationCondition.FOREVER:
      case AuthorizationCondition.EXPIRABLE_5M:
      case AuthorizationCondition.EXPIRABLE_1H:
      case AuthorizationCondition.EXPIRABLE_8H:
        if (level) {
          openPrompt?.resolve?.(true);
          Storage.addActivePermission(host ?? '', condition, level);
        } else {
          console.warn('No authorization level provided');
        }
        break;
      case AuthorizationCondition.SINGLE:
        openPrompt?.resolve?.(true);
        break;
      case AuthorizationCondition.REJECT:
        openPrompt?.resolve?.(false);
        break;
    }

    openPrompt = null;

    // close prompt
    if (sender) {
      if (browser.windows) {
        browser.windows.remove(sender.tab.windowId);
      } else {
        // Android Firefox
        browser.tabs.remove(sender.tab.id);
      }
    }
  } catch (error) {
    console.error('Error handling prompt response.', error);
    openPrompt?.reject?.(error);
  }
}

function promptPermission(host, level, params) {
  let id = Math.random().toString().slice(4);
  let qs = new URLSearchParams({
    host,
    level,
    id,
    params: JSON.stringify(params)
  });

  return new Promise((resolve, reject) => {
    const url = `${browser.runtime.getURL('prompt.html')}?${qs.toString()}`;
    if (browser.windows) {
      browser.windows.create({
        url,
        type: 'popup',
        width: 600,
        height: 400
      });
    } else {
      // Android Firefox
      browser.tabs.create({
        url,
        active: true
      });
    }

    openPrompt = { resolve, reject };
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
