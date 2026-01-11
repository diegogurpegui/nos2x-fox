import browser from 'webextension-polyfill';
import { createRoot } from 'react-dom/client';
import { getPublicKey, nip19 } from 'nostr-tools';
import React, { useState, useEffect } from 'react';

import { ProfilesConfig } from './types';
import * as Storage from './storage';
import { truncatePublicKeys } from './common';

import logotype from './assets/logo/logotype.png';
import CopyIcon from './assets/icons/copy-outline.svg';
import CogIcon from './assets/icons/cog-outline.svg';

function Popup() {
  let [publicKeyHexa, setPublicKeyHexa] = useState<string>();
  let [publiKeyNIP19, setPublicKeyNIP19] = useState<string>();
  let [selectedKeyType, setSelectedKeyType] = useState('npub');
  let [profiles, setProfiles] = useState<ProfilesConfig>({});

  useEffect(() => {
    async function loadActiveProfile() {
      // Always use stored active public key (it's always saved now)
      const activePublicKey = await Storage.getActivePublicKey();
      if (activePublicKey) {
        setPublicKeyHexa(activePublicKey);
      } else {
        setPublicKeyHexa(undefined);
        setPublicKeyNIP19(undefined);
      }
    }

    loadActiveProfile();

    Storage.readProfiles().then(profiles => {
      if (profiles) {
        setProfiles(profiles);
      }
    });
  }, []);

  /**
   * When active public key changes
   */
  useEffect(() => {
    if (publicKeyHexa) {
      setPublicKeyNIP19(nip19.npubEncode(publicKeyHexa));

      Storage.readActiveRelays().then(relays => {
        if (relays) {
          let relaysList: string[] = [];
          for (let url in relays) {
            if (relays[url].write) {
              relaysList.push(url);
              if (relaysList.length >= 3) break;
            }
          }
        }
      });

      console.log(`The profile for pubkey '${publicKeyHexa}' was loaded.`);
    }
  }, [publicKeyHexa]);

  function handleKeyTypeSelect(event) {
    setSelectedKeyType(event.target.value);
  }

  function goToOptionsPage() {
    browser.tabs
      .create({
        url: browser.runtime.getURL('options.html'),
        active: true
      })
      .then(() => {
        window.close();
      });
  }

  async function handleProfileChange(event) {
    const pubKey = event.target.value;
    setPublicKeyHexa(pubKey);
    const profile = profiles[pubKey];
    if (!profile) {
      console.warn(`The profile for pubkey '${pubKey}' does not exist.`);
      return;
    }

    // Always update active public key first
    await Storage.setActivePublicKey(pubKey);
    
    // Then update private key based on PIN status
    const pinEnabled = await Storage.isPinEnabled();
    if (pinEnabled) {
      // When PIN protection is enabled, update encrypted private key
      if (profile.privateKey) {
        await Storage.setEncryptedPrivateKey(profile.privateKey);
      }
    } else {
      // When PIN protection is disabled, update active private key
      await Storage.updateActivePrivateKey(profile.privateKey);
    }
  }

  function clipboardCopyPubKey() {
    navigator.clipboard.writeText(
      (selectedKeyType === 'hex' ? publicKeyHexa : publiKeyNIP19) ?? ''
    );
  }

  return (
    <>
      <h1>
        <img src={logotype} alt="nos2x-fox" />
      </h1>
      {!publicKeyHexa ? (
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
                {truncatePublicKeys(
                  (selectedKeyType === 'hex' ? publicKeyHexa : publiKeyNIP19) ?? ''
                )}
              </code>
              <button
                className="button-onlyicon"
                onClick={clipboardCopyPubKey}
                title="Copy the public key to the clipboard"
              >
                <CopyIcon />
              </button>
            </div>
            <div className="select profile-switch">
              <select value={publicKeyHexa} onChange={handleProfileChange}>
                {Object.keys(profiles).map(profilePubKey => (
                  <option value={profilePubKey} key={profilePubKey}>
                    {profiles[profilePubKey].name ?? nip19.npubEncode(profilePubKey)}
                  </option>
                ))}
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

const root = createRoot(document.getElementById('main'));
root.render(<Popup />);
