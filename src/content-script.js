import browser from 'webextension-polyfill';

const EXTENSION_CODE = 'nos2x-fox';

// inject the script that will provide window.nostr
let script = document.createElement('script');
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
