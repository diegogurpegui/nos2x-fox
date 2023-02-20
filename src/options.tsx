import React, { useState, useCallback, useEffect } from 'react';
import { render } from 'react-dom';
import { useDebouncedCallback } from 'use-debounce';
import { generatePrivateKey, nip19 } from 'nostr-tools';
import { format, formatDistance } from 'date-fns';

import { Alert } from './alert';

import * as Storage from './storage';
import { getPermissionsString } from './common';
import logotype from './assets/logo/logotype.png';
import DiceIcon from './assets/icons/dice-outline.svg';
import RadioIcon from './assets/icons/radio-outline.svg';

// import manifest from './manifest.json';

type RelayConfig = {
  url: string;
  policy: { read: boolean; write: boolean };
};

function Options() {
  let [key, setKey] = useState('');
  let [isKeyHidden, setKeyHidden] = useState(true);
  let [relays, setRelays] = useState([]);
  let [newRelayURL, setNewRelayURL] = useState('');
  let [permissions, setPermissions] = useState();
  let [message, setMessage] = useState('');
  let [messageType, setMessageType] = useState('info');
  let [version, setVersion] = useState('0.0.0');

  useEffect(() => {
    Storage.readPrivateKey().then(privateKey => {
      if (privateKey) setKey(nip19.nsecEncode(privateKey));
    });

    Storage.readRelays().then(relays => {
      if (relays) {
        let relaysList: RelayConfig[] = [];
        for (let url in relays) {
          relaysList.push({
            url,
            policy: relays[url]
          });
        }
        setRelays(relaysList);
      }
    });
  }, []);

  useEffect(() => {
    loadPermissions();

    fetch('./manifest.json')
      .then(response => response.json())
      .then(json => setVersion(json.version));
  }, []);

  useEffect(() => {
    saveRelaysInStorage()
      ?.then(() => console.log('Relays stored.'))
      .catch(err => console.error('Error storing relays', err));
  }, [relays]);

  const showMessage = useCallback((msg, type = 'info', timeout = 3000) => {
    setMessageType(type);
    setMessage(msg);
    if (timeout > 0) {
      setTimeout(setMessage, 3000);
    }
  });

  //#region Private key

  async function savePrivateKey() {
    if (!isKeyValid()) return;

    let hexOrEmptyKey = key;

    try {
      let { type, data } = nip19.decode(key);
      if (type === 'nsec') hexOrEmptyKey = data;
    } catch (_) {}

    await Storage.updatePrivateKey(hexOrEmptyKey);

    if (hexOrEmptyKey !== '') {
      setKey(nip19.nsecEncode(hexOrEmptyKey));
    }

    showMessage('Saved private key!', 'success');
  }

  function isKeyValid() {
    if (key === '') return true;
    if (key.match(/^[a-f0-9]{64}$/)) return true;
    try {
      if (nip19.decode(key).type === 'nsec') return true;
    } catch (_) {}
    console.log('bad');
    return false;
  }

  async function handleKeyChange(e) {
    let key = e.target.value.toLowerCase().trim();
    setKey(key);
  }

  async function generateRandomPrivateKey() {
    setKey(nip19.nsecEncode(generatePrivateKey()));
  }

  //#endregion Private key

  //#region Permissions

  async function handleRevoke(e) {
    e.preventDefault();
    let host = e.target.dataset.domain;
    if (window.confirm(`Revoke all permissions from ${host}?`)) {
      await Storage.removePermissions(host);
      showMessage(`Removed permissions from ${host}`);
      loadPermissions();
    }
  }

  function loadPermissions() {
    Storage.readPermissions().then(permissions => {
      setPermissions(
        Object.entries(permissions).map(
          ([host, { level, condition, created_at }]) => ({
            host,
            level,
            condition,
            created_at
          })
        )
      );
    });
  }

  //#endregion Permissions

  //#region Relays

  const saveRelaysInStorage = useDebouncedCallback(async () => {
    await Storage.updateRelays(
      Object.fromEntries(
        relays
          .filter(({ url }) => url.trim() !== '')
          .map(({ url, policy }) => [url.trim(), policy])
      )
    );

    showMessage('Saved relays!', 'success');
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
  }

  function handleAddRelayClick() {
    if (!isRelayURLValid()) return;

    setRelays([
      ...relays,
      {
        url: newRelayURL,
        policy: { read: true, write: true }
      }
    ]);
    setNewRelayURL('');
  }

  /**
   * Check if the URL is valid. If no URL is provided is taken from the state
   * @param url Url to check.
   * @returns
   */
  function isRelayURLValid(url?: string) {
    const urlToCheck = url ? url : newRelayURL;
    return urlToCheck != null && urlToCheck.trim() != '';
  }

  //#endregion Relays

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
          <div className="form-field">
            <label htmlFor="private-key">Private key:</label>
            <div className="input-group">
              <input
                id="private-key"
                type={isKeyHidden ? 'password' : 'text'}
                value={key}
                onChange={handleKeyChange}
                onFocus={() => setKeyHidden(false)}
                onBlur={() => setKeyHidden(true)}
              />
              <button onClick={generateRandomPrivateKey}>
                <DiceIcon /> Generate
              </button>
            </div>
          </div>
          <button disabled={!isKeyValid()} onClick={savePrivateKey}>
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
          <div className="form-field">
            <label htmlFor="new-relay-url">New relay URL:</label>
            <input
              id="new-relay-url"
              value={newRelayURL}
              onChange={handleNewRelayURLChange}
            />
            <button disabled={!isRelayURLValid()} onClick={handleAddRelayClick}>
              Add relay
            </button>
          </div>
        </section>
      </main>
      <footer>version {version}</footer>
    </>
  );
}

render(<Options />, document.getElementById('main'));
