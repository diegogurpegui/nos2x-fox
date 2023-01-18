import browser from 'webextension-polyfill'
import {render} from 'react-dom'
import {getPublicKey, nip19} from 'nostr-tools'
import React, {useState, useEffect} from 'react'

import logotype from './assets/logo/logotype.png'
import CopyIcon from './assets/icons/copy-outline.svg'
import CogIcon from './assets/icons/cog-outline.svg'

function Popup() {
  let [key, setKey] = useState('')
  let [keyNIP19, setKeyNIP19] = useState('')
  let [selectedKeyType, setSelectedKeyType] = useState('npub')

  useEffect(() => {
    browser.storage.local.get('private_key').then(results => {
      if (results.private_key) {
        const pubKey = getPublicKey(results.private_key)
        setKey(pubKey)
        setKeyNIP19(nip19.npubEncode(pubKey))
      } else {
        setKey(null)
        setKeyNIP19(null)
      }
    })
  }, [])

  function handleKeyTypeSelect(event) {
    setSelectedKeyType(event.target.value)
  }

  function goToOptionsPage() {
    browser.tabs.create({
      url: browser.runtime.getURL('options.html'),
      active: true
    })
  }

  function clipboardCopyPubKey() {
    navigator.clipboard.writeText(key)
  }
  function clipboardCopyPubKeyNIP19() {
    navigator.clipboard.writeText(keyNIP19)
  }

  return (
    <>
      <h1>
        <img src={logotype} alt="nos2x" />
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
              <code>{`${(selectedKeyType === 'hex' ? key : keyNIP19).substring(0, 15)}…${(selectedKeyType === 'hex' ? key : keyNIP19).substring(((selectedKeyType === 'hex' ? key : keyNIP19).length - 10))}`}</code>
              <button className="button-onlyicon" onClick={(selectedKeyType === 'hex' ? clipboardCopyPubKey : clipboardCopyPubKeyNIP19)}>
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
  )
}

render(<Popup />, document.getElementById('main'))
