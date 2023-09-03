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
  let [publicKeyHexa, setPublicKeyHexa] = useState('');
  let [publiKeyNIP19, setPublicKeyNIP19] = useState('');
  let [selectedKeyType, setSelectedKeyType] = useState('npub');

  useEffect(() => {
    Storage.readActivePrivateKey().then(privateKey => {
      if (privateKey) {
        const pubKey = getPublicKey(privateKey);
        setPublicKeyHexa(pubKey);
        setPublicKeyNIP19(nip19.npubEncode(pubKey));

        Storage.readActiveRelays().then(relays => {
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

        console.log(`The profile for pubkey '${pubKey}' was loaded.`);
      } else {
        setPublicKeyHexa(null);
        setPublicKeyNIP19(null);
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
    navigator.clipboard.writeText(selectedKeyType === 'hex' ? publicKeyHexa : publiKeyNIP19);
  }

  return (
    <>
      <h1>
        <img src={logotype} alt="nos2x-fox" />
      </h1>
      {publicKeyHexa === null ? (
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
                {truncatePublicKeys(selectedKeyType === 'hex' ? publicKeyHexa : publiKeyNIP19)}
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
