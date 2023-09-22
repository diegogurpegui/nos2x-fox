import React, { useState, useCallback, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useDebouncedCallback } from 'use-debounce';
import { getPublicKey, generatePrivateKey, nip19 } from 'nostr-tools';
import { format, formatDistance } from 'date-fns';

import { Alert, Modal } from './components';

import {
  PermissionConfig,
  ProfileConfig,
  ProfilesConfig,
  RelaysConfig
} from './types';
import * as Storage from './storage';
import { getPermissionsString, isHexadecimal, isValidRelayURL } from './common';
import logotype from './assets/logo/logotype.png';
import WarningIcon from './assets/icons/warning-outline.svg';
import CopyIcon from './assets/icons/copy-outline.svg';
import DiceIcon from './assets/icons/dice-outline.svg';
import RadioIcon from './assets/icons/radio-outline.svg';
import TrashIcon from './assets/icons/trash-outline.svg';

type RelayConfig = {
  url: string;
  policy: { read: boolean; write: boolean };
};

function Options() {
  let [selectedProfilePubKey, setSelectedProfilePubKey] = useState<string>('');
  let [profiles, setProfiles] = useState<ProfilesConfig>({});
  let [profileJson, setProfileJson] = useState('');
  let [isModalShown, setModalShown] = useState(false);

  let [privateKey, setPrivateKey] = useState('');
  let [isKeyHidden, setKeyHidden] = useState(true);
  let [relays, setRelays] = useState([]);
  let [newRelayURL, setNewRelayURL] = useState('');
  let [isNewRelayURLValid, setNewRelayURLValid] = useState(true);
  let [permissions, setPermissions] = useState();
  let [message, setMessage] = useState('');
  let [messageType, setMessageType] = useState('info');

  let [version, setVersion] = useState('0.0.0');

  /**
   * Load options from Storage
   */
  useEffect(() => {
    Storage.readActivePrivateKey().then(privateKey => {
      if (privateKey) {
        setPrivateKey(nip19.nsecEncode(privateKey));
      }
    });

    Storage.readActiveRelays().then(relays => {
      if (relays) {
        let relaysList = convertRelaysToUIArray(relays);
        setRelays(relaysList);
      }
    });

    Storage.readProfiles().then(profiles => {
      if (profiles) {
        setProfiles(profiles);

        // load active profile
        let activePubKey = Object.keys(profiles)[0];
        if (privateKey != '') {
          // there is an active private key
          activePubKey = getPublicKey(privateKey);
          console.log(`Public key loaded from private key`);
        }
        console.log('Active pub key', activePubKey);
        setSelectedProfilePubKey(activePubKey);
      }
    });
  }, []);

  /**
   * Initialization
   */
  useEffect(() => {
    loadPermissions();

    fetch('./manifest.json')
      .then(response => response.json())
      .then(json => setVersion(json.version));
  }, []);

  /**
   * When relays are updated
   */
  useEffect(() => {
    saveRelaysInStorage()
      ?.then(() => console.log('Relays stored.'))
      .catch(err => console.error('Error storing relays', err));
  }, [relays]);

  /**
   * When active public key changes
   */
  useEffect(() => {
    loadProfile(selectedProfilePubKey);
  }, [selectedProfilePubKey]);

  const showMessage = useCallback((msg, type = 'info', timeout = 3000) => {
    setMessageType(type);
    setMessage(msg);
    if (timeout > 0) {
      setTimeout(setMessage, 3000);
    }
  });

  //#region Profiles

  function loadProfile(pubKey: string) {
    const profile: ProfileConfig = profiles[pubKey];
    if (!profile) {
      console.warn(`The profile for pubkey '${pubKey}' does not exist.`);
      return;
    }
    // setActiveProfilePubKey(pubKey);
    setRelays(convertRelaysToUIArray(profile.relays));
    setPermissions(convertPermissionsToUIObject(profile.permissions));
    if (profile.privateKey) {
      setPrivateKey(nip19.nsecEncode(profile.privateKey));
    } else {
      setPrivateKey('');
    }

    console.log(`The profile for pubkey '${pubKey}' was loaded.`);
  }

  function handleActiveProfileChange(event) {
    const pubKey = event.target.value;
    setSelectedProfilePubKey(pubKey);
    // loadProfile(pubKey);
  }

  function handleNewProfileClick(event) {
    const newProfile: ProfileConfig = {
      privateKey: ''
    };
    setProfiles({ ...profiles, ...{ ['']: newProfile } });
    setSelectedProfilePubKey('');

    setRelays([]);
    setPermissions(null);
    setPrivateKey('');
  }

  function isNewProfilePending() {
    return Object.keys(profiles).includes('');
  }

  function getActiveProfile(): ProfileConfig | null {
    if (selectedProfilePubKey) {
      return profiles[selectedProfilePubKey];
    } else {
      return null;
    }
  }

  function handleExportProfileClick() {
    const profile = getActiveProfile();
    const profileJson = JSON.stringify(profile);
    setProfileJson(profileJson);
    setModalShown(true);
  }

  function handleExportProfileCopyClick() {
    navigator.clipboard.writeText(profileJson);
  }

  function handleModalClose() {
    setModalShown(false);
  }

  function saveProfiles() {
    Storage.updateProfiles(profiles);
  }

  //#endregion Profiles

  //#region Private key

  async function savePrivateKey() {
    if (!isKeyValid()) return;

    let hexOrEmptyPrivKey = privateKey;

    try {
      let { type, data } = nip19.decode(privateKey);
      if (type === 'nsec') hexOrEmptyPrivKey = data;
    } catch (err) {
      console.error('Converting key to hexa (decode NIP19)', err);
    }

    if (hexOrEmptyPrivKey !== '') {
      await Storage.updateActivePrivateKey(hexOrEmptyPrivKey);

      const privKeyNip19 = nip19.nsecEncode(hexOrEmptyPrivKey);
      setPrivateKey(privKeyNip19);

      // if new profile need to re-calculate pub key
      const newPubKey = getPublicKey(hexOrEmptyPrivKey);
      profiles[newPubKey] = profiles[selectedProfilePubKey];
      profiles[newPubKey].privateKey = hexOrEmptyPrivKey; // save the hex version in the profile
      delete profiles[selectedProfilePubKey];
      setSelectedProfilePubKey(newPubKey);
      // loadProfile(newPubKey);

      saveProfiles();
    } else {
      console.warn('Saving and empty private key');
    }

    showMessage('Saved private key!', 'success');
  }

  function isKeyValid() {
    if (privateKey === '') return true;
    if (privateKey.match(/^[a-f0-9]{64}$/)) return true;
    try {
      if (nip19.decode(privateKey).type === 'nsec') return true;
    } catch (e) {
      console.error(`Error decoding NIP19 key: ${e}`);
    }
    return false;
  }

  async function handleKeyChange(e) {
    let key = e.target.value.toLowerCase().trim();
    setPrivateKey(key);
  }

  async function generateRandomPrivateKey() {
    setPrivateKey(nip19.nsecEncode(generatePrivateKey()));
  }

  //#endregion Private key

  //#region Permissions

  function convertPermissionsToUIObject(permissions?: PermissionConfig) {
    if (!permissions) return undefined;

    return Object.entries(permissions).map(
      ([host, { level, condition, created_at }]) => ({
        host,
        level,
        condition,
        created_at
      })
    );
  }

  async function handleRevoke(e) {
    e.preventDefault();
    let host = e.target.dataset.domain;
    if (window.confirm(`Revoke all permissions from ${host}?`)) {
      await Storage.removeActivePermissions(host);
      showMessage(`Removed permissions from ${host}`);
      loadPermissions();
    }
  }

  function loadPermissions() {
    Storage.readActivePermissions().then(permissions => {
      setPermissions(convertPermissionsToUIObject(permissions));
    });
  }

  //#endregion Permissions

  //#region Relays

  function convertRelaysToUIArray(relays?: RelaysConfig) {
    if (!relays) return [];

    let relaysList: RelayConfig[] = [];
    for (let url in relays) {
      relaysList.push({
        url,
        policy: relays[url]
      });
    }

    return relaysList;
  }

  const saveRelaysInStorage = useDebouncedCallback(async () => {
    if (privateKey) {
      // if there is a selected profile (private key)
      let relaysToSave = {};
      if (relays && relays.length) {
        relaysToSave = Object.fromEntries(
          relays
            .filter(({ url }) => url.trim() !== '')
            .map(({ url, policy }) => [url.trim(), policy])
        );
      }
      await Storage.updateActiveRelays(relaysToSave);

      showMessage('Saved relays!', 'success');
    }
  }, 700);

  function handleChangeRelayURL(i, ev) {
    setRelays([
      ...relays.slice(0, i),
      { url: ev.target.value, policy: relays[i].policy },
      ...relays.slice(i + 1)
    ]);
  }

  function handleToggleRelayPolicy(i, cat) {
    setRelays([
      ...relays.slice(0, i),
      {
        url: relays[i].url,
        policy: { ...relays[i].policy, [cat]: !relays[i].policy[cat] }
      },
      ...relays.slice(i + 1)
    ]);
  }

  function handleNewRelayURLChange(e) {
    setNewRelayURL(e.target.value);
    if (!isRelayURLValid(e.target.value)) {
      setNewRelayURLValid(false);
    }
  }

  function handleAddRelayClick() {
    if (!isRelayURLValid()) {
      return;
    }

    setNewRelayURLValid(true);
    setRelays([
      ...relays,
      {
        url: newRelayURL,
        policy: { read: true, write: true }
      }
    ]);
    setNewRelayURL('');
  }

  function handleRemoveRelayClick(event: React.MouseEvent<HTMLButtonElement>) {
    const relayUrl = event.currentTarget.id;
    const newRelays = relays.filter(relay => relay.url != relayUrl);
    setRelays(newRelays);
  }

  /**
   * Check if the URL is valid. If no URL is provided is taken from the state
   * @param url Url to check.
   * @returns
   */
  function isRelayURLValid(url?: string) {
    const urlToCheck = url ? url : newRelayURL;
    return isValidRelayURL(urlToCheck);
  }

  //#endregion Relays

  function handleClearStorageClick() {
    if (
      confirm('Are you sure you want to delete everything from this browser?')
    ) {
      Storage.clear();
      // reload the page
      window.location.reload();
    }
  }

  return (
    <>
      <header className="header">
        <h1>
          <img src={logotype} alt="nos2x-fox" />
        </h1>
        <p>nostr signer extension</p>
      </header>
      <main>
        <h2>Options</h2>
        {message && <Alert message={message} type={messageType} />}

        <section>
          <h3>Profile</h3>
          <div className="form-field">
            <label htmlFor="active-profile">Active profile:</label>
            <div className="select" id="active-profile">
              <select
                value={selectedProfilePubKey}
                onChange={handleActiveProfileChange}
              >
                {Object.keys(profiles).map(profilePubKey => (
                  <option value={profilePubKey} key={profilePubKey}>
                    {profilePubKey == ''
                      ? '(new profile)'
                      : nip19.npubEncode(profilePubKey)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="profile-actions">
            <button
              disabled={isNewProfilePending()}
              onClick={handleNewProfileClick}
            >
              New profile
            </button>
            <button onClick={handleExportProfileClick}>Export profile</button>
          </div>
        </section>

        <section>
          <h3>Keys</h3>
          <div className="form-field">
            <label htmlFor="private-key">Private key:</label>
            <div className="input-group">
              <input
                id="private-key"
                type={isKeyHidden ? 'password' : 'text'}
                value={privateKey}
                readOnly={selectedProfilePubKey != ''}
                onChange={handleKeyChange}
                onFocus={() => setKeyHidden(false)}
                onBlur={() => setKeyHidden(true)}
              />
              <button onClick={generateRandomPrivateKey}>
                <DiceIcon /> Generate
              </button>
            </div>
          </div>
          <button
            disabled={!isKeyValid() || selectedProfilePubKey != ''}
            onClick={savePrivateKey}
          >
            Save key
          </button>
        </section>

        <section>
          <h3>Permissions</h3>
          {permissions?.length > 0 ? (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Domain</th>
                    <th>Permissions</th>
                    <th>Condition</th>
                    <th>Since</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {permissions.map(({ host, level, condition, created_at }) => (
                    <tr key={host}>
                      <td>{host}</td>
                      <td>{getPermissionsString(level)}</td>
                      <td>{condition}</td>
                      <td
                        style={{ cursor: 'help' }}
                        title={formatDistance(
                          new Date(created_at * 1000),
                          new Date()
                        )}
                      >
                        {format(
                          new Date(created_at * 1000),
                          'yyyy-MM-dd HH:mm:ss'
                        )}
                      </td>
                      <td>
                        <button onClick={handleRevoke} data-domain={host}>
                          revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p>(No permissions defined)</p>
          )}
        </section>

        <section>
          <h3>Preferred relays</h3>
          <div className="relays-list">
            {relays.map(({ url, policy }, i) => (
              <div key={i} className="relays-list-item">
                <button
                  className="button-onlyicon button-remove"
                  onClick={handleRemoveRelayClick}
                  title="Remove"
                  id={url}
                >
                  <TrashIcon />
                </button>
                <RadioIcon />
                <input
                  value={url}
                  onChange={handleChangeRelayURL.bind(null, i)}
                />
                <label>
                  read
                  <input
                    type="checkbox"
                    checked={policy.read}
                    onChange={handleToggleRelayPolicy.bind(null, i, 'read')}
                  />
                </label>
                <label>
                  write
                  <input
                    type="checkbox"
                    checked={policy.write}
                    onChange={handleToggleRelayPolicy.bind(null, i, 'write')}
                  />
                </label>
              </div>
            ))}
          </div>
          <div
            className={`form-field ${
              !isNewRelayURLValid ? 'validation-error' : ''
            }`}
          >
            <label htmlFor="new-relay-url">New relay URL:</label>
            <input
              id="new-relay-url"
              placeholder="wss://..."
              value={newRelayURL}
              onChange={handleNewRelayURLChange}
            />
            <button disabled={!isRelayURLValid()} onClick={handleAddRelayClick}>
              Add relay
            </button>
          </div>
        </section>

        <section className="danger">
          <button
            className="button button-danger"
            onClick={handleClearStorageClick}
          >
            <WarningIcon />
            Delete configuration
            <WarningIcon />
          </button>
        </section>
      </main>
      <footer>version {version}</footer>

      <Modal show={isModalShown} onClose={handleModalClose}>
        <p>
          This is the JSON that represents your profile (WARNING: it contains
          your private key):
        </p>
        <code>{profileJson}</code>
        <button onClick={handleExportProfileCopyClick}>
          <CopyIcon /> Copy
        </button>
      </Modal>
    </>
  );
}

const root = createRoot(document.getElementById('main'));
root.render(<Options />);
