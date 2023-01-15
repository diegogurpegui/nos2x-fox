import browser from 'webextension-polyfill'
import {render} from 'react-dom'
import {getPublicKey, nip19} from 'nostr-tools'
import React, {useState, useEffect} from 'react'

import logotype from './assets/logo/logotype.png'
import copyIcon from './assets/icons/copy-outline.svg'

function Popup() {
  let [key, setKey] = useState('')
  let [keyNIP19, setKeyNIP19] = useState('')

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
          <div className="input public-key">
            <code>{key}</code>
            <img
              className="button-onlyicon"
              src={copyIcon}
              alt="copy"
              title="copy"
              onClick={clipboardCopyPubKey}
            />
          </div>
          <div className="input public-key">
            <code>{keyNIP19}</code>
            <img
              className="button-onlyicon"
              src={copyIcon}
              alt="copy"
              title="copy"
              onClick={clipboardCopyPubKeyNIP19}
            />
          </div>
          <p>
            <a className="button" href="#" onClick={goToOptionsPage}>
              ⚙️ Options
            </a>
          </p>
        </>
      )}
    </>
  )
}

render(<Popup />, document.getElementById('main'))
