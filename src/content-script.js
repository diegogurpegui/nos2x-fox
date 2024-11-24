import browser from 'webextension-polyfill';

const EXTENSION_CODE = 'nos2x-fox';

async function main() {
  // fetch the script
  let r = await fetch(browser.runtime.getURL('nostr-provider.js'));
  let nostr_provider_src = await r.text();

  let pubkey = await browser.runtime.sendMessage({
    type: "initPublicKey",
    params: {},
    host: location.host
  });
  let inject_script = `
    window.__nostr_pubkey = ${JSON.stringify(pubkey)};
    ${nostr_provider_src}
  `
  // inject the script that will provide window.nostr
  let script = document.createElement('script');
  script.setAttribute('async', 'false');
  script.setAttribute('type', 'text/javascript');
  script.textContent = inject_script;
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
}

main()
