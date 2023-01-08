import browser from 'webextension-polyfill'
import {render} from 'react-dom'
import React from 'react'

import {getAllowedCapabilities} from './common'

function Prompt() {
  let qs = new URLSearchParams(location.search)
  let id = qs.get('id')
  let host = qs.get('host')
  let level = parseInt(qs.get('level'))
  let params
  try {
    params = JSON.parse(qs.get('params'))
  } catch (err) {
    params = null
  }

  return (
    <>
      <div>
        <b class="prompt-host">{host}</b>{' '}
        <p>is requesting your permission to:</p>
        <ul class="prompt-requests">
          {getAllowedCapabilities(level).map(cap => (
            <li key={cap}>{cap}</li>
          ))}
        </ul>
      </div>
      {params && (
        <>
          <p>now acting on</p>
          <pre className="prompt-request-raw">
            <code>{JSON.stringify(params, null, 2)}</code>
          </pre>
        </>
      )}
      <div className="prompt-action-buttons">
        <button className="button" onClick={authorizeHandler('forever')}>
          ✅ Authorize forever
        </button>
        <button className="button" onClick={authorizeHandler('expirable')}>
          🕐 Authorize for 5 minutes
        </button>
        <button className="button" onClick={authorizeHandler('single')}>
          ☑️ Authorize just this
        </button>
        <button className="button" onClick={authorizeHandler('no')}>
          ❌ Reject
        </button>
      </div>
    </>
  )

  function authorizeHandler(condition) {
    return function (ev) {
      ev.preventDefault()
      browser.runtime.sendMessage({
        prompt: true,
        id,
        host,
        level,
        condition
      })
    }
  }
}

render(<Prompt />, document.getElementById('main'))
