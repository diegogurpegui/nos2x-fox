import React, { useState, useCallback, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useDebouncedCallback } from 'use-debounce';
import { getPublicKey, generateSecretKey, nip19 } from 'nostr-tools';
import { format, formatDistance } from 'date-fns';

import { Alert, Modal } from './components';

import {
  PermissionConfig,
  ProfileConfig,
  ProfilesConfig,
  RelaysConfig
} from './types';
import * as Storage from './storage';
import {
  convertHexToUint8Array,
  convertUint8ArrayToHex,
  getPermissionsString,
  isHexadecimal,
  isValidRelayURL,
  truncatePublicKeys
} from './common';
import logotype from './assets/logo/logotype.png';
import AddCircleIcon from './assets/icons/add-circle-outline.svg';
import ArrowUpCircleIcon from './assets/icons/arrow-up-circle-outline.svg';
import CopyIcon from './assets/icons/copy-outline.svg';
import DiceIcon from './assets/icons/dice-outline.svg';
import EyeIcon from './assets/icons/eye-outline.svg';
import EyeOffIcon from './assets/icons/eye-off-outline.svg';
import DownloadIcon from './assets/icons/download-outline.svg';
import RadioIcon from './assets/icons/radio-outline.svg';
import TrashIcon from './assets/icons/trash-outline.svg';
import WarningIcon from './assets/icons/warning-outline.svg';

type RelayConfig = {
  url: string;
  policy: { read: boolean; write: boolean };
};

function Options() {
  let [selectedProfilePubKey, setSelectedProfilePubKey] = useState<string>('');
  let [profiles, setProfiles] = useState<ProfilesConfig>({});
  let [isLoadingProfile, setLoadingProfile] = useState(false);
  let [profileExportJson, setProfileExportJson] = useState('');
  let [profileImportJson, setProfileImportJson] = useState('');
  let [isExportModalShown, setExportModalShown] = useState(false);
  let [isImportModalShown, setImportModalShown] = useState(false);

  let [privateKey, setPrivateKey] = useState<string>('');
  let [isKeyHidden, setKeyHidden] = useState(true);
  let [relays, setRelays] = useState<RelayConfig[]>([]);
  let [newRelayURL, setNewRelayURL] = useState('');
  let [isNewRelayURLValid, setNewRelayURLValid] = useState(true);
  let [permissions, setPermissions] = useState<
    {
      host: string;
      level: number;
      condition: string;
      created_at: number;
    }[]
  >();
  let [message, setMessage] = useState('');
  let [messageType, setMessageType] = useState('info');

  let [version, setVersion] = useState('0.0.0');

  /**
   * Load options from Storage
   */
  useEffect(() => {
    Storage.readProfiles().then(profiles => {
      if (profiles) {
        setProfiles(profiles);

        // load selected profile
        let selectedPubKey = Object.keys(profiles)[0];
        if (selectedProfilePubKey != '') {
          // there is an selected public key
          selectedPubKey = selectedProfilePubKey;
          console.debug(`Already selected public key`);
        }

        console.debug('Selected pub key to be loaded', selectedPubKey);
        // this call will load the profile in the screen
        setSelectedProfilePubKey(selectedPubKey);
      }
    });
  }, []);

  /**
   * Initialization
   */
  useEffect(() => {
    fetch('./manifest.json')
      .then(response => response.json())
      .then(json => setVersion(json.version));
  }, []);

  /**
   * When relays are updated
   */
  useEffect(() => {
    if (isLoadingProfile) return;

    saveRelaysInStorage()
      ?.then(() => console.log('Relays stored.'))
      .catch(err => console.error('Error storing relays', err));
  }, [relays]);

  /**
   * When selected public key changes
   */
  useEffect(() => {
    loadAndSelectProfile(selectedProfilePubKey);
  }, [selectedProfilePubKey]);

  const showMessage: (
    msg: string,
    type?: 'info' | 'success' | 'warning',
    timeout?: number
  ) => void = useCallback((msg, type = 'info', timeout = 3000) => {
    setMessageType(type);
    setMessage(msg);
    if (timeout > 0) {
      setTimeout(setMessage, 3000);
    }
  }, []);

  //#region Profiles

  function loadAndSelectProfile(pubKey: string) {
    const profile: ProfileConfig = profiles[pubKey];
    if (!profile) {
      console.warn(`The profile for pubkey '${pubKey}' does not exist.`);
      return;
    }
    setLoadingProfile(true);
    setRelays(convertRelaysToUIArray(profile.relays));
    setPermissions(convertPermissionsToUIObject(profile.permissions));
    if (profile.privateKey) {
      setPrivateKey(
        nip19.nsecEncode(convertHexToUint8Array(profile.privateKey))
      );
    } else {
      setPrivateKey('');
    }

    setLoadingProfile(false);
    console.log(`The profile for pubkey '${pubKey}' was loaded.`);
  }

  function reloadSelectedProfile() {
    loadAndSelectProfile(selectedProfilePubKey);
  }

  function handleSelectedProfileChange(event) {
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
    setPermissions(undefined);
    setPrivateKey('');
  }

  function isNewProfilePending() {
    return Object.keys(profiles).includes('');
  }

  function getSelectedProfile(): ProfileConfig | null {
    if (selectedProfilePubKey) {
      return profiles[selectedProfilePubKey];
    } else {
      return null;
    }
  }

  function handleExportProfileClick() {
    const profile = getSelectedProfile();
    const profileJson = JSON.stringify(profile);
    setProfileExportJson(profileJson);
    setExportModalShown(true);
  }

  function handleExportProfileCopyClick() {
    navigator.clipboard.writeText(profileExportJson);
  }

  function handleExportModalClose() {
    setExportModalShown(false);
  }

  function handleImportProfileClick() {
    setImportModalShown(true);
  }

  function handleChangeProfileImportJson(e) {
    setProfileImportJson(e.target.value);
  }

  async function handleImportProfileImportClick() {
    let newProfile: ProfileConfig;
    // validations
    try {
      newProfile = JSON.parse(profileImportJson);
    } catch (error) {
      console.warn(`Error parsing the entered JSON`, error);
      showMessage(
        `There was an error parsing the JSON. ${error.message}`,
        'warning'
      );
      return;
    }
    if (!newProfile) {
      console.warn(`The imported profile is empty.`);
      showMessage(`The imported profile is invalid.`, 'warning');
    }

    // store the new profile
    await Storage.addProfile(newProfile);

    const pkU8Array = convertHexToUint8Array(newProfile.privateKey);
    const newPubKey = getPublicKey(pkU8Array);
    setProfiles({ ...profiles, ...{ [newPubKey]: newProfile } });

    // now load in the component
    if (newProfile.privateKey) {
      setPrivateKey(nip19.nsecEncode(pkU8Array));
    } else {
      setPrivateKey('');
    }
    setSelectedProfilePubKey(newPubKey);

    setImportModalShown(false);
  }

  function handleImportModalClose() {
    setImportModalShown(false);
  }

  async function handleDeleteProfileClick(e) {
    e.preventDefault();
    if (
      window.confirm(
        `Delete the profile "${nip19.npubEncode(selectedProfilePubKey)}"?`
      )
    ) {
      // delete from storage
      await Storage.deleteProfile(selectedProfilePubKey);
      // now update component
      const updateProfiles = profiles;
      delete updateProfiles[selectedProfilePubKey];
      console.debug('updated profiles', updateProfiles);
      setProfiles(updateProfiles);
    }
  }

  async function saveProfiles() {
    await Storage.updateProfiles(profiles);
  }

  //#endregion Profiles

  //#region Private key

  async function savePrivateKey() {
    if (!isKeyValid()) return;

    if (privateKey == '') {
      console.warn("Won't save an empty private key");
      return;
    }

    let privateKeyIntArray: Uint8Array | undefined = undefined;

    if (isHexadecimal(privateKey)) {
      privateKeyIntArray = convertHexToUint8Array(privateKey);
    } else {
      try {
        let { type, data } = nip19.decode(privateKey);
        if (type === 'nsec') privateKeyIntArray = data as Uint8Array;
      } catch (err) {
        console.error('Converting key to hexa (decode NIP19)', err);
      }
    }

    if (privateKeyIntArray) {
      const privKeyNip19 = nip19.nsecEncode(privateKeyIntArray);
      setPrivateKey(privKeyNip19);

      // if new profile need to re-calculate pub key
      const newPubKey = getPublicKey(privateKeyIntArray);
      profiles[newPubKey] = profiles[selectedProfilePubKey];
      // save the hex version in the profile
      profiles[newPubKey].privateKey =
        convertUint8ArrayToHex(privateKeyIntArray);
      delete profiles[selectedProfilePubKey];
      setSelectedProfilePubKey(newPubKey); // this re-loads the profile in the screen

      await saveProfiles();
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
    } catch (err) {
      console.error(`Error decoding NIP19 key: ${err}`);
    }
    return false;
  }

  async function handlePrivateKeyChange(e) {
    let key = e.target.value.toLowerCase().trim();
    setPrivateKey(key);
  }

  async function generateRandomPrivateKey() {
    setPrivateKey(nip19.nsecEncode(generateSecretKey()));
  }

  function handlePrivateKeyShowClick() {
    setKeyHidden(!isKeyHidden);
  }

  //#endregion Private key

  //#region Permissions

  function convertPermissionsToUIObject(permissions?: PermissionConfig) {
    console.debug('Converting permissions to UI', permissions);
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
      await Storage.removePermissions(selectedProfilePubKey, host);
      showMessage(`Removed permissions from ${host}`);
      reloadSelectedProfile();
    }
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
    // if there is a selected profile
    if (selectedProfilePubKey) {
      let relaysToSave = {};
      if (relays && relays.length) {
        relaysToSave = Object.fromEntries(
          relays
            .filter(({ url }) => url.trim() !== '')
            .map(({ url, policy }) => [url.trim(), policy])
        );
      }
      console.debug('Relays to save', relaysToSave);
      await Storage.updateRelays(selectedProfilePubKey, relaysToSave);

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

  async function handleClearStorageClick() {
    if (
      confirm('Are you sure you want to delete everything from this browser?')
    ) {
      await Storage.empty();
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
            <label htmlFor="selected-profile">Selected profile:</label>
            <div className="select" id="selected-profile">
              <select
                value={selectedProfilePubKey}
                onChange={handleSelectedProfileChange}
              >
                {Object.keys(profiles).map(profilePubKey => (
                  <option value={profilePubKey} key={profilePubKey}>
                    {profilePubKey == ''
                      ? '(new profile)'
                      : truncatePublicKeys(
                          nip19.npubEncode(profilePubKey),
                          20,
                          20
                        )}
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
              <AddCircleIcon />
              New
            </button>
            <button onClick={handleExportProfileClick}>
              <DownloadIcon />
              Export
            </button>
            <button onClick={handleImportProfileClick}>
              <ArrowUpCircleIcon />
              Import
            </button>
            <button
              onClick={handleDeleteProfileClick}
              className="button button-danger"
            >
              <TrashIcon />
              Delete
            </button>
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
                onChange={handlePrivateKeyChange}
              />
              <button onClick={handlePrivateKeyShowClick}>
                {isKeyHidden ? <EyeIcon /> : <EyeOffIcon />}
              </button>
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
          {permissions && permissions.length > 0 ? (
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

      <Modal
        show={isExportModalShown}
        className="export-modal"
        onClose={handleExportModalClose}
      >
        <p>
          This is the JSON that represents your profile (WARNING: it contains
          your private key):
        </p>
        <code>{profileExportJson}</code>
        <button onClick={handleExportProfileCopyClick}>
          <CopyIcon /> Copy
        </button>
      </Modal>

      <Modal
        show={isImportModalShown}
        className="import-modal"
        onClose={handleImportModalClose}
      >
        <p>Paste the profile JSON in the following box:</p>
        <textarea
          value={profileImportJson}
          onChange={handleChangeProfileImportJson}
        ></textarea>
        <button onClick={handleImportProfileImportClick}>Import</button>
      </Modal>
    </>
  );
}

const root = createRoot(document.getElementById('main'));
root.render(<Options />);
