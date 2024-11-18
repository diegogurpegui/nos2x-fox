import React, { useEffect } from 'react';
import browser from 'webextension-polyfill';
import { createRoot } from 'react-dom/client';

import {
  convertHexToUint8Array,
  getAllowedCapabilities,
  truncatePublicKeys
} from './common';
import {
  AuthorizationCondition,
  KindNames,
  ProfileConfig,
  PromptParams,
  PromptResponse
} from './types';
import * as Storage from './storage';

import ShieldCheckmarkIcon from './assets/icons/shield-checkmark-outline.svg';
import TimerIcon from './assets/icons/timer-outline.svg';
import CheckmarkCircleIcon from './assets/icons/checkmark-circle-outline.svg';
import CloseCircleIcon from './assets/icons/close-circle-outline.svg';
import { getPublicKey, nip19 } from 'nostr-tools';

function Prompt() {
  const [activeProfile, setActiveProfile] = React.useState<ProfileConfig>();
  const [activePubKeyNIP19, setActivePubKeyNIP19] = React.useState<string>('');

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
      if (params.event) {
        kind = params.event.kind;
        kindName = getKindDescription(kind);
      } else {
        console.warn('params.event is not defined');
      }
    } else {
      console.error('Param is null');
    }
  } catch (err) {
    console.error('Error parsing params.', err);
  }

  useEffect(() => {
    Storage.getActiveProfile().then(profile => {
      setActiveProfile(profile);
      const pkUint = convertHexToUint8Array(profile.privateKey);
      setActivePubKeyNIP19(nip19.npubEncode(getPublicKey(pkUint)));
    });
  });

  function authorizeHandler(condition) {
    return function (ev) {
      ev.preventDefault();
      const promptResponse: PromptResponse = {
        prompt: true,
        id,
        host,
        level,
        condition
      };
      browser.runtime.sendMessage(promptResponse);
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

  return (
    <>
      <div>
        <h1 className="prompt-host">{host}</h1>
        <p>
          Signing with profile:{' '}
          <strong>
            {activeProfile && (
              <span>
                {activeProfile.name} (
                {truncatePublicKeys(activePubKeyNIP19, 10, 10)})
              </span>
            )}
          </strong>
        </p>
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
        <button
          className="button"
          onClick={authorizeHandler(AuthorizationCondition.FOREVER)}
        >
          <ShieldCheckmarkIcon /> Authorize forever
        </button>
        <div className="button-group">
          <button
            className="button"
            onClick={authorizeHandler(AuthorizationCondition.EXPIRABLE_5M)}
          >
            <TimerIcon />
            Authorize for 5 m
          </button>
          <button
            className="button"
            onClick={authorizeHandler(AuthorizationCondition.EXPIRABLE_1H)}
          >
            1 h
          </button>
          <button
            className="button"
            onClick={authorizeHandler(AuthorizationCondition.EXPIRABLE_8H)}
          >
            8 h
          </button>
        </div>
        <button
          className="button button-success"
          onClick={authorizeHandler(AuthorizationCondition.SINGLE)}
        >
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
}

const root = createRoot(document.getElementById('main'));
root.render(<Prompt />);
