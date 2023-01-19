import browser from 'webextension-polyfill'
import React, {useState, useEffect} from 'react'
import {render} from 'react-dom'
import {generatePrivateKey} from 'nostr-tools'

import {getPermissionsString, readPermissions} from './common'
import logotype from './assets/logo/logotype.png'
import DiceIcon from './assets/icons/dice-outline.svg'

import manifest from './manifest.json'

function Options() {
  let [key, setKey] = useState('')
  let [permissions, setPermissions] = useState()
  let [message, setMessage] = useState('')

  useEffect(() => {
    browser.storage.local.get(['private_key']).then(results => {
      if (results.private_key) setKey(results.private_key)
    })
  }, [])

  useEffect(() => {
    readPermissions().then(permissions => {
      setPermissions(
        Object.entries(permissions).map(
          ([host, {level, condition, created_at}]) => ({
            host,
            level,
            condition,
            created_at
          })
        )
      )
    })
  }, [])

  async function savePrivateKey(key) {
    setKey(key)

    if (key.match(/^[a-f0-9]{64}$/) || key === '') {
      await browser.storage.local.set({
        private_key: key
      })
      setMessage('saved!')
      setTimeout(setMessage, 3000)
    } else {
      setMessage('The key is not valid.')
    }
  }

  async function handleKeyChange(e) {
    let key = e.target.value.toLowerCase().trim()
    savePrivateKey(key)
  }

  async function generateRandomPrivateKey() {
    savePrivateKey(generatePrivateKey())
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
        <div className="form-field">
          <label htmlFor="private-key">Private key:</label>
          <div className="input-group">
            <input id="private-key" value={key} onChange={handleKeyChange} />
            <button onClick={generateRandomPrivateKey}>
              <DiceIcon /> Generate
            </button>
          </div>
        </div>
        {permissions?.length > 0 && (
          <>
            <h2>Permissions</h2>
            <table>
              <thead>
                <tr>
                  <th>domain</th>
                  <th>permissions</th>
                  <th>condition</th>
                  <th>since</th>
                </tr>
              </thead>
              <tbody>
                {permissions.map(({host, level, condition, created_at}) => (
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
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {message && <div className="info-message">ℹ️ {message}</div>}
      </main>
      <footer>version {manifest.version}</footer>
    </>
  )
}

render(<Options />, document.getElementById('main'))
