import browser from 'webextension-polyfill';

import { buildNostrLinkUrl } from './common';
import * as Storage from './storage';
import { ConfigurationKeys } from './types';

const EXTENSION_CODE = 'nos2x-fox';

// The only message types a web page may ask for. Everything else the background can do — the PIN
// handlers, key encryption, opening a prompt window — belongs to the extension's own pages.
//
// An allow-list rather than a block-list on purpose. Before it, the page chose `type` freely and
// the background answered `getCachedPin` above every permission check, handing any site the PIN
// that decrypts the private key. The other privileged handlers were unreachable only by accident:
// they read fields this bridge does not copy across. The next handler written without arguments
// would have been exposed the day it was added, and nobody would have noticed.
const CALLABLE_FROM_PAGE = new Set([
  'getPublicKey',
  'getRelays',
  'signEvent',
  'nip04.encrypt',
  'nip04.decrypt',
  'nip44.encrypt',
  'nip44.decrypt'
]);

//#region Nostr link handler
let linkHandlerTemplate = '';
let handlersAttached = false;

function isNostrLink(element: Element | null): element is HTMLAnchorElement {
  if (!(element instanceof HTMLAnchorElement)) return false;
  const href = element.getAttribute('href');
  return !!href && href.toLowerCase().startsWith('nostr:');
}

function openNostrLink(event: MouseEvent) {
  if (!linkHandlerTemplate.trim()) return;

  const link = (event.target as Element | null)?.closest('a') ?? null;
  if (!isNostrLink(link)) return;

  const href = link.getAttribute('href');
  if (!href) return;

  const destinationUrl = buildNostrLinkUrl(linkHandlerTemplate, href);
  if (!destinationUrl) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const openInNewTab =
    event.button === 1 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    link.target === '_blank';

  if (openInNewTab) {
    window.open(destinationUrl, '_blank', 'noopener');
  } else {
    window.location.assign(destinationUrl);
  }
}

function syncLinkHandlers() {
  const enabled = linkHandlerTemplate.trim() !== '';

  if (enabled && !handlersAttached) {
    document.addEventListener('click', openNostrLink, true);
    document.addEventListener('auxclick', openNostrLink, true);
    handlersAttached = true;
  } else if (!enabled && handlersAttached) {
    document.removeEventListener('click', openNostrLink, true);
    document.removeEventListener('auxclick', openNostrLink, true);
    handlersAttached = false;
  }
}

async function loadLinkHandlerTemplate() {
  linkHandlerTemplate = await Storage.getNostrLinkHandlerUrlTemplate();
  syncLinkHandlers();
}

loadLinkHandlerTemplate();

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[ConfigurationKeys.NOSTR_LINK_HANDLER_URL]) return;

  linkHandlerTemplate = (changes[ConfigurationKeys.NOSTR_LINK_HANDLER_URL].newValue as string) ?? '';
  syncLinkHandlers();
});

//#endregion Nostr link handler

// inject the script that will provide window.nostr
const script = document.createElement('script');
script.setAttribute('async', 'false');
script.setAttribute('type', 'text/javascript');
script.setAttribute('src', browser.runtime.getURL('nostr-provider.js'));
document.head.appendChild(script);

// listen for messages from that script
window.addEventListener('message', async message => {
  if (message.source !== window) return;
  if (!message.data) return;
  if (!message.data.params) return;
  if (message.data.ext !== EXTENSION_CODE) return;

  // Answer rather than ignore: a caller that gets nothing back waits on a promise forever, and an
  // honest one deserves to be told it asked for something that is not on offer.
  if (!CALLABLE_FROM_PAGE.has(message.data.type)) {
    window.postMessage(
      {
        id: message.data.id,
        ext: EXTENSION_CODE,
        response: { error: { message: `${message.data.type} is not callable from a page` } }
      },
      message.origin
    );
    return;
  }

  // pass on to background
  let response;
  try {
    response = await browser.runtime.sendMessage({
      type: message.data.type,
      params: message.data.params,
      host: location.host
    });
  } catch (error) {
    console.error('Error from calling extension.', error);
    response = { error };
  }

  // return response
  window.postMessage(
    { id: message.data.id, ext: EXTENSION_CODE, response },
    message.origin
  );
});
