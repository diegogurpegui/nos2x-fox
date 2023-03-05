import browser from 'webextension-polyfill';
import { render } from 'react-dom';
import { getPublicKey, nip19 } from 'nostr-tools';
import React, { useState, useEffect } from 'react';

import { RelaysConfig } from './types';
import * as Storage from './storage';
import { truncatePublicKeys } from './common';

import logotype from './assets/logo/logotype.png';
import CopyIcon from './assets/icons/copy-outline.svg';
import CogIcon from './assets/icons/cog-outline.svg';

function Popup() {
  let [key, setKey] = useState('');
  let [keyNIP19, setKeyNIP19] = useState('');
  let [selectedKeyType, setSelectedKeyType] = useState('npub');

  useEffect(() => {
    Storage.readPrivateKey().then(privateKey => {
      if (privateKey) {
        const pubKey = getPublicKey(privateKey);
        setKey(pubKey);
        setKeyNIP19(nip19.npubEncode(pubKey));

        Storage.readRelays().then(relays => {
          if (relays) {
            let relaysList: string[] = [];
            for (let url in relays) {
              if (relays[url].write) {
                relaysList.push(url);
                if (relaysList.length >= 3) break;
              }
            }
            // if (relaysList.length) {
            //   let nprofileKey = nip19.nprofileEncode({
            //     pubkey: pubKey,
            //     relays: relaysList
            //   })
            //   keys.current.push(nprofileKey)
            // }
          }
        });
      } else {
        setKey(null);
        setKeyNIP19(null);
      }
    });
  }, []);

  function handleKeyTypeSelect(event) {
    setSelectedKeyType(event.target.value);
  }

  function goToOptionsPage() {
    browser.tabs.create({
      url: browser.runtime.getURL('options.html'),
      active: true
    }).then(() => {
      window.close();
    });
  }

  function clipboardCopyPubKey() {
    navigator.clipboard.writeText(selectedKeyType === 'hex' ? key : keyNIP19);
  }

  return (
    <>
      <h1>
        <img src={logotype} alt="nos2x-fox" />
      </h1>
      {key === null ? (
        <p>
          You don't have a private key set. Use the{' '}
          <a href="#" onClick={goToOptionsPage}>
            options page
          </a>{' '}
          to set one.
        </p>
      ) : (
        <>
          <p>Your public key:</p>
          <div className="public-key">
            <div className="pubkey-show">
              <code>
                {truncatePublicKeys(selectedKeyType === 'hex' ? key : keyNIP19)}
              </code>
              <button className="button-onlyicon" onClick={clipboardCopyPubKey}>
                <CopyIcon />
              </button>
            </div>
            <div className="select key-options">
              <select value={selectedKeyType} onChange={handleKeyTypeSelect}>
                <option value="npub">npub</option>
                <option value="hex">hex</option>
              </select>
            </div>
          </div>
          <p>
            <a className="button" href="#" onClick={goToOptionsPage}>
              <CogIcon className="svg-fill" /> Options
            </a>
          </p>
        </>
      )}
    </>
  );
}

render(<Popup />, document.getElementById('main'));
