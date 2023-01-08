import browser from 'webextension-polyfill'
import {render} from 'react-dom'
import {getPublicKey} from 'nostr-tools'
import React, {useState, useEffect} from 'react'

import logotype from './assets/icons/logotype.png'

function Popup() {
  let [key, setKey] = useState('')

  useEffect(() => {
    browser.storage.local.get('private_key').then(results => {
      if (results.private_key) {
        setKey(getPublicKey(results.private_key))
      } else {
        setKey(null)
      }
    })
  }, [])

  function goToOptionsPage() {
    browser.tabs.create({
      url: browser.runtime.getURL('options.html'),
      active: true
    })
  }

  return (
    <>
      <h1>
        <img src={logotype} alt="nos2x" />
      </h1>
      {key === null ? (
        <p>
          you don't have a private key set. use the{' '}
          <a href="#" onClick={goToOptionsPage}>
            options page
          </a>{' '}
          to set one.
        </p>
      ) : (
        <>
          <p>your public key:</p>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              width: '100px'
            }}
          >
            <code>{key}</code>
          </pre>
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
