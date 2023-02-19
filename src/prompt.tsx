import browser from 'webextension-polyfill';
import { render } from 'react-dom';
import React from 'react';

import { getAllowedCapabilities } from './common';
import { AuthorizationCondition, KindNames, PromptParams } from './types';

import ShieldCheckmarkIcon from './assets/icons/shield-checkmark-outline.svg';
import TimerIcon from './assets/icons/timer-outline.svg';
import CheckmarkCircleIcon from './assets/icons/checkmark-circle-outline.svg';
import CloseCircleIcon from './assets/icons/close-circle-outline.svg';

function Prompt() {
  const queryString = new URLSearchParams(location.search);
  const id = queryString.get('id');
  const host = queryString.get('host');
  const level = parseInt(queryString.get('level') as string);
  let params: PromptParams | null = null;
  let kindName: string | null = null;
  let kind: number | null = null;
  try {
    params = JSON.parse(queryString.get('params') as string) as PromptParams;
    if (params) {
      kind = params.event.kind;
      kindName = getKindDescription(kind);
    } else {
      console.error('Param is null');
    }
  } catch (err) {
    console.error('Error parsing params.');
  }

  return (
    <>
      <div>
        <h1 className="prompt-host">{host}</h1>
        <p>
          Event:{' '}
          <span className="badge">
            {kindName ?? `(not recognized. Kind: ${kind})`}
          </span>
        </p>
        <p>is requesting your permission to:</p>
        <ul className="prompt-requests">
          {getAllowedCapabilities(level).map(cap => (
            <li key={cap}>{cap}</li>
          ))}
        </ul>
      </div>
      <div className="prompt-action-buttons">
        <button className="button" onClick={authorizeHandler(AuthorizationCondition.FOREVER)}>
          <ShieldCheckmarkIcon /> Authorize forever
        </button>
        <button className="button" onClick={authorizeHandler(AuthorizationCondition.EXPIRABLE_5)}>
          <TimerIcon />
          Authorize for 5 minutes
        </button>
        <button className="button" onClick={authorizeHandler(AuthorizationCondition.SINGLE)}>
          <CheckmarkCircleIcon />
          Authorize just this
        </button>
        <button
          className="button button-danger"
          onClick={authorizeHandler(AuthorizationCondition.REJECT)}
        >
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
  );

  function authorizeHandler(condition) {
    return function (ev) {
      ev.preventDefault();
      browser.runtime.sendMessage({
        prompt: true,
        id,
        host,
        level,
        condition
      });
    };
  }

  function getKindDescription(kind: number) {
    for (const kindCode in KindNames) {
      if (kindCode.includes('-')) {
        // check whether the kind is within a recognized range
        const range = kindCode.split('-');
        if (kind >= parseInt(range[0]) && kind <= parseInt(range[1])) {
          return KindNames[kindCode];
        }
      } else {
        // check whether the kind is a specific value
        const kindCodeN = parseInt(kindCode);
        if (kind == kindCodeN) {
          return KindNames[kindCode];
        }
      }
    }
    return null;
  }
}

render(<Prompt />, document.getElementById('main'));
