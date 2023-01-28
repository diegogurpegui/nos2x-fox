import browser from 'webextension-polyfill';
import React, { useState, useCallback, useEffect } from 'react';
import { render } from 'react-dom';
import { useDebouncedCallback } from 'use-debounce';
import { generatePrivateKey } from 'nostr-tools';

import { PermissionConfig } from './types';
import { Alert } from './alert';

import {
  getPermissionsString,
  readPermissions,
  removePermissions
} from './common';
import logotype from './assets/logo/logotype.png';
import DiceIcon from './assets/icons/dice-outline.svg';
import RadioIcon from './assets/icons/radio-outline.svg';

import manifest from './manifest.json';

type RelayConfig = {
  url: string;
  policy: { read: boolean; write: boolean };
};

function Options() {
  let [key, setKey] = useState('');
  let [relays, setRelays] = useState([]);
  let [newRelayURL, setNewRelayURL] = useState('');
  let [permissions, setPermissions] = useState();
  let [message, setMessage] = useState('');
  let [messageType, setMessageType] = useState('info');

  useEffect(() => {
    saveRelays();
  }, [relays]);

  useEffect(() => {
    browser.storage.local.get(['private_key', 'relays']).then(results => {
      if (results.private_key) setKey(results.private_key);
      if (results.relays) {
        let relaysList: RelayConfig[] = [];
        for (let url in results.relays) {
          relaysList.push({
            url,
            policy: results.relays[url]
          });
        }
        setRelays(relaysList);
      }
    });
  }, []);

  useEffect(() => {
    loadPermissions();
  }, []);

  const showMessage = useCallback((msg, type = 'info', timeout = 3000) => {
    setMessageType(type);
    setMessage(msg);
    if (timeout > 0) {
      setTimeout(setMessage, 3000);
    }
  });

  const saveRelays = useDebouncedCallback(async () => {
    await browser.storage.local.set({
      relays: Object.fromEntries(
        relays
          .filter(({ url }) => url.trim() !== '')
          .map(({ url, policy }) => [url.trim(), policy])
      )
    });
    showMessage('saved relays!');
  }, 700);

  async function savePrivateKey(key) {
    setKey(key);

    if (key.match(/^[a-f0-9]{64}$/) || key === '') {
      await browser.storage.local.set({
        private_key: key
      });
      showMessage('Key saved!', 'success');
    } else {
      showMessage('The key is not valid.', 'warning', 0);
    }
  }

  async function handleKeyChange(e) {
    let key = e.target.value.toLowerCase().trim();
    savePrivateKey(key);
  }

  async function handleRevoke(e) {
    e.preventDefault();
    let host = e.target.dataset.domain;
    if (window.confirm(`Revoke all permissions from ${host}?`)) {
      await removePermissions(host);
      showMessage(`Removed permissions from ${host}`);
      loadPermissions();
    }
  }

  function loadPermissions() {
    readPermissions().then(permissions => {
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

  async function generateRandomPrivateKey() {
    savePrivateKey(generatePrivateKey());
  }

  function changeRelayURL(i, ev) {
    setRelays([
      ...relays.slice(0, i),
      { url: ev.target.value, policy: relays[i].policy },
      ...relays.slice(i + 1)
    ]);
  }

  function toggleRelayPolicy(i, cat) {
    setRelays([
      ...relays.slice(0, i),
      {
        url: relays[i].url,
        policy: { ...relays[i].policy, [cat]: !relays[i].policy[cat] }
      },
      ...relays.slice(i + 1)
    ]);
  }

  function addNewRelay() {
    relays.push({
      url: newRelayURL,
      policy: { read: true, write: true }
    });
    setRelays(relays);
    setNewRelayURL('');
  }

  return (
    <>
      <header className="header">
        <h1>
          <img src={logotype} alt="nos2x" />
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
              <input id="private-key" value={key} onChange={handleKeyChange} />
              <button onClick={generateRandomPrivateKey}>
                <DiceIcon /> Generate
              </button>
            </div>
          </div>
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
                      <td>
                        {new Date(created_at * 1000)
                          .toISOString()
                          .split('.')[0]
                          .split('T')
                          .join(' ')}
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
                <input value={url} onChange={changeRelayURL.bind(null, i)} />
                <label>
                  read
                  <input
                    type="checkbox"
                    checked={policy.read}
                    onChange={toggleRelayPolicy.bind(null, i, 'read')}
                  />
                </label>
                <label>
                  write
                  <input
                    type="checkbox"
                    checked={policy.write}
                    onChange={toggleRelayPolicy.bind(null, i, 'write')}
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
              onChange={e => setNewRelayURL(e.target.value)}
              onBlur={addNewRelay}
            />
          </div>
        </section>
      </main>
      <footer>version {manifest.version}</footer>
    </>
  );
}

render(<Options />, document.getElementById('main'));
