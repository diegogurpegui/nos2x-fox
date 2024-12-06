import { inspect } from 'util';
const EXTENSION_CODE = 'nos2x-fox';

window.nostr = {
  _requests: {},
  pubkey: window.__nostr_pubkey,

  async getPublicKey() {
    console.warn("Deprecated")
    this.pubkey = await this._call('getPublicKey', {});
    return this.pubkey;
  },

  async login() {
    this.pubkey = await this._call('getPublicKey', {});
    return this.pubkey;
  },

  async logout() {
    // TODO: clear the permission for page in browser extension
  },

  async signEvent(event) {
    return this._call('signEvent', { event });
  },

  async getRelays() {
    return this._call('getRelays', {});
  },

  nip04: {
    async encrypt(peer, plaintext) {
      return window.nostr._call('nip04.encrypt', { peer, plaintext });
    },

    async decrypt(peer, ciphertext) {
      return window.nostr._call('nip04.decrypt', { peer, ciphertext });
    }
  },

  nip44: {
    async encrypt(peer, plaintext) {
      return window.nostr._call('nip44.encrypt', { peer, plaintext });
    },

    async decrypt(peer, ciphertext) {
      return window.nostr._call('nip44.decrypt', { peer, ciphertext });
    }
  },

  _call(type, params) {
    let id = Math.random().toString().slice(-4);
    console.log(
      '%c[nos2x-fox:%c' +
        id +
        '%c]%c calling %c' +
        type +
        '%c with %c' +
        JSON.stringify(params || {}),
      'background-color:#f1b912;font-weight:bold;color:white',
      'background-color:#f1b912;font-weight:bold;color:#a92727',
      'background-color:#f1b912;color:white;font-weight:bold',
      'color:auto',
      'font-weight:bold;color:#08589d;font-family:monospace',
      'color:auto',
      'font-weight:bold;color:#90b12d;font-family:monospace'
    );

    return new Promise((resolve, reject) => {
      this._requests[id] = { resolve, reject };
      window.postMessage(
        {
          id,
          ext: EXTENSION_CODE,
          type,
          params
        },
        '*'
      );
    });
  }
};
delete window.__nostr_pubkey;

window.addEventListener('message', message => {
  if (
    !message.data ||
    message.data.response === null ||
    message.data.response === undefined ||
    message.data.ext !== EXTENSION_CODE ||
    !window.nostr._requests[message.data.id]
  )
    return;

  if (message.data.response.error) {
    const errorMessage =
      message.data.response.error.message ?? message.data.response.error;
    let error = new Error(`${EXTENSION_CODE}: ` + errorMessage);
    error.stack = message.data.response.error.stack;
    window.nostr._requests[message.data.id].reject(error);
  } else {
    window.nostr._requests[message.data.id].resolve(message.data.response);
  }

  console.log(
    '%c[nos2x-fox:%c' +
      message.data.id +
      '%c]%c result: %c' +
      JSON.stringify(
        message?.data?.response || message?.data?.response?.error?.message || {}
      ),
    'background-color:#f1b912;font-weight:bold;color:white',
    'background-color:#f1b912;font-weight:bold;color:#a92727',
    'background-color:#f1b912;color:white;font-weight:bold',
    'color:auto',
    'font-weight:bold;color:#08589d'
  );

  delete window.nostr._requests[message.data.id];
});
