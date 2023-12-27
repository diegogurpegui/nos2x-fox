import browser from 'webextension-polyfill';
import {
  validateEvent,
  signEvent,
  getEventHash,
  getPublicKey
} from 'nostr-tools';
import { nip04 } from 'nostr-tools';

import * as Storage from './storage';
import { AuthorizationCondition } from './types';
import { PERMISSIONS_REQUIRED, readPermissionLevel } from './common';

let openPrompt = null;

browser.runtime.onMessage.addListener((message, sender) => {
  let { prompt } = message;

  if (prompt) {
    return handlePromptMessage(message, sender);
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

async function handleContentScriptMessage({ type, params, host }) {
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
          error: `Insufficient permissions, required ${PERMISSIONS_REQUIRED[type]}`
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

  let sk = privateKey;

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
        let { event } = params;

        if (!event.pubkey) event.pubkey = getPublicKey(sk);
        if (!event.id) event.id = getEventHash(event);

        if (!validateEvent(event)) return { error: 'invalid event' };

        event.sig = await signEvent(event, sk);
        return event;
      }
      case 'nip04.encrypt': {
        let { peer, plaintext } = params;
        return nip04.encrypt(sk, peer, plaintext);
      }
      case 'nip04.decrypt': {
        let { peer, ciphertext } = params;
        return nip04.decrypt(sk, peer, ciphertext);
      }
    }
  } catch (error) {
    return { error: { message: error.message, stack: error.stack } };
  }
}

function handlePromptMessage({ id, condition, host, level }, sender) {
  try {
    switch (condition) {
      case AuthorizationCondition.FOREVER:
      case AuthorizationCondition.EXPIRABLE_5M:
      case AuthorizationCondition.EXPIRABLE_1H:
      case AuthorizationCondition.EXPIRABLE_8H:
        openPrompt?.resolve?.(true);
        Storage.addActivePermission(host, {
          level,
          condition
        });
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
