import { Event, VerifiedEvent } from 'nostr-tools';
import {
  ContentScriptMessageResponseError,
  PromptParams,
  RelaysConfig
} from './types';

const EXTENSION_CODE = 'nos2x-fox';

window.nostr = {
  _requests: {},
  _pubkey: null,

  async getPublicKey(): Promise<string | ContentScriptMessageResponseError> {
    if (this._pubkey) return this._pubkey;
    this._pubkey = await this._call('getPublicKey', {});
    return this._pubkey;
  },

  async signEvent(
    event: Event
  ): Promise<VerifiedEvent | ContentScriptMessageResponseError> {
    return this._call('signEvent', { event });
  },

  async getRelays(): Promise<RelaysConfig | ContentScriptMessageResponseError> {
    return this._call('getRelays', {});
  },

  nip04: {
    async encrypt(
      peer: string,
      plaintext: string
    ): Promise<string | ContentScriptMessageResponseError> {
      return window.nostr._call('nip04.encrypt', { peer, plaintext });
    },

    async decrypt(
      peer: string,
      ciphertext: string
    ): Promise<string | ContentScriptMessageResponseError> {
      return window.nostr._call('nip04.decrypt', { peer, ciphertext });
    }
  },

  nip44: {
    async encrypt(
      peer: string,
      plaintext: string
    ): Promise<string | ContentScriptMessageResponseError> {
      return window.nostr._call('nip44.encrypt', { peer, plaintext });
    },

    async decrypt(
      peer: string,
      ciphertext: string
    ): Promise<string | ContentScriptMessageResponseError> {
      return window.nostr._call('nip44.decrypt', { peer, ciphertext });
    }
  },

  _call(type: string, params: PromptParams) {
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : Array.from(crypto.getRandomValues(new Uint8Array(16)), b =>
            b.toString(16).padStart(2, '0')
          ).join('');
    const targetOrigin =
      typeof window.location?.origin === 'string' && window.location.origin !== 'null'
        ? window.location.origin
        : '*';

    return new Promise((resolve, reject) => {
      this._requests[id] = { resolve, reject };
      window.postMessage(
        {
          id,
          ext: EXTENSION_CODE,
          type,
          params
        },
        targetOrigin
      );
    });
  }
};

window.addEventListener('message', message => {
  if (
    message.source !== window ||
    !message.data ||
    message.data.response === null ||
    message.data.response === undefined ||
    message.data.ext !== EXTENSION_CODE ||
    !Object.prototype.hasOwnProperty.call(window.nostr._requests, message.data.id)
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

  delete window.nostr._requests[message.data.id];
});
