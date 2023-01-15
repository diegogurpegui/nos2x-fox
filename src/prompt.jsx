import browser from 'webextension-polyfill'
import {render} from 'react-dom'
import React from 'react'

import {getAllowedCapabilities} from './common'

import ShieldCheckmarkIcon from './assets/icons/shield-checkmark-outline.svg'
import TimerIcon from './assets/icons/timer-outline.svg'
import CheckmarkCircleIcon from './assets/icons/checkmark-circle-outline.svg'
import CloseCircleIcon from './assets/icons/close-circle-outline.svg'

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
      <div className="prompt-action-buttons">
        <button className="button" onClick={authorizeHandler('forever')}>
          <ShieldCheckmarkIcon /> Authorize forever
        </button>
        <button className="button" onClick={authorizeHandler('expirable')}>
          <TimerIcon />
          Authorize for 5 minutes
        </button>
        <button className="button" onClick={authorizeHandler('single')}>
          <CheckmarkCircleIcon />
          Authorize just this
        </button>
        <button className="button" onClick={authorizeHandler('no')}>
          <CloseCircleIcon /> Reject
        </button>
      </div>
      {params && (
        <>
          <p>now acting on</p>
          <pre className="prompt-request-raw">
            <code>{JSON.stringify(params, null, 2)}</code>
          </pre>
        </>
      )}
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
