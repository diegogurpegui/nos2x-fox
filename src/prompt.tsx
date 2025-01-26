import React, { useEffect, useState } from 'react';
import browser from 'webextension-polyfill';
import { createRoot } from 'react-dom/client';
import { getPublicKey, nip19 } from 'nostr-tools';

import {
  convertHexToUint8Array,
  getAllowedCapabilities,
  truncatePublicKeys
} from './common';
import {
  AuthorizationCondition,
  KindNames,
  ProfileConfig,
  PromptResponse
} from './types';
import * as Storage from './storage';

import ShieldCheckmarkIcon from './assets/icons/shield-checkmark-outline.svg';
import TimerIcon from './assets/icons/timer-outline.svg';
import CaretBackIcon from './assets/icons/caret-back-outline.svg';
import CaretForwradIcon from './assets/icons/caret-forward-outline.svg';
import CheckmarkCircleIcon from './assets/icons/checkmark-circle-outline.svg';
import CloseCircleIcon from './assets/icons/close-circle-outline.svg';
import { useOpenPrompts } from './PromptManager';

function Prompt() {
  const openPrompts = useOpenPrompts();

  const [activeProfile, setActiveProfile] = useState<ProfileConfig>();
  const [activePubKeyNIP19, setActivePubKeyNIP19] = useState<string>('');

  // const [openPrompts, setOpenPromps] = useState<OpenPromptItem[]>();
  const [activePromptIndex, setActivePrompt] = useState<number>(0);

  const [kindName, setKindName] = useState<string | null>(null);
  const [kind, setKind] = useState<number | null>(null);

  const [showCloseConfirmation, setShowCloseConfirmation] = useState(false);

  useEffect(() => {
    Storage.getActiveProfile().then(profile => {
      setActiveProfile(profile);
      const pkUint = convertHexToUint8Array(profile.privateKey);
      setActivePubKeyNIP19(nip19.npubEncode(getPublicKey(pkUint)));
    });
  }, []);

  /** Pepare params of event */
  useEffect(() => {
    try {
      if (openPrompts?.[activePromptIndex]?.params) {
        const params = openPrompts[activePromptIndex].params;
        if (params.event) {
          setKind(params.event.kind);
          setKindName(getKindDescription(params.event.kind));
        } else {
          console.warn('params.event is not defined');
        }
      } else {
        console.error('Param is null');
      }
    } catch (err) {
      console.error('Error parsing params.', err);
    }
  }, [activePromptIndex, openPrompts]);

  useEffect(() => {
    // if there are more than one prompt, then set the onbeforeunload
    if (openPrompts && openPrompts.length > 1) {
      const handleBeforeUnload = (event: BeforeUnloadEvent) => {
        if (!showCloseConfirmation) {
          event.preventDefault();
          event.returnValue = ''; // Required for Chrome
          setShowCloseConfirmation(true);
        }
      };
      window.addEventListener('beforeunload', handleBeforeUnload);

      // clean it up, if the dirty state changes
      return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
      };
    }

    // since this is not dirty, don't do anything
    return () => {};
  }, [openPrompts]);

  function handleCloseConfirm() {
    // Actually close the window
    window.close();
  }

  function handleCloseCancel() {
    setShowCloseConfirmation(false);
  }

  function getKindDescription(kind: number): string | null {
    // 1. Try to find the specific kind key
    const kindEntry = KindNames[kind];
    if (kindEntry) {
      return kindEntry;
    }

    // 2. Fallback to find the range that the kind belongs to
    const rangeEntry = Object.entries(KindNames).find(([key]) => {
      const [start, end] = key.split('-').map(Number);
      return kind >= start && kind <= (end ?? start);
    });
    return rangeEntry ? rangeEntry[1] : null;
  }

  function authorizeHandler(condition) {
    return function (ev) {
      ev.preventDefault();

      // if no promps this shouldn't be valid (it won't be called anyway)
      if (!openPrompts || !openPrompts.length) {
        return;
      }

      const promptResponse: PromptResponse = {
        prompt: true,
        id: openPrompts[activePromptIndex].id,
        host: openPrompts[activePromptIndex].host,
        level: openPrompts[activePromptIndex].level,
        condition
      };
      browser.runtime.sendMessage(promptResponse);
    };
  }

  function movePrompt(direction: number) {
    if (openPrompts && openPrompts.length > 0) {
      let newIndex = activePromptIndex + direction;
      if (newIndex < 0) {
        newIndex = 0;
      }
      if (newIndex >= openPrompts.length) {
        newIndex = openPrompts.length - 1;
      }
      setActivePrompt(newIndex);
    }
  }

  if (!openPrompts || !openPrompts.length) {
    return <div className="p-2">There is no action to authorize</div>;
  }

  return (
    <>
      {/* Close confirmation modal */}
      {showCloseConfirmation && (
        <div className="close-confirm-dialog-wrapper">
          <div className="close-confirm-dialog">
            <p>
              If you close this window, all prompts will be taken as rejected.
            </p>
            <div className="action-buttons">
              <button onClick={handleCloseCancel}>Cancel</button>
              <button className="button-danger" onClick={handleCloseConfirm}>
                Reject all
              </button>
            </div>
          </div>
        </div>
      )}

      <div>
        {openPrompts.length > 1 && (
          <div className="prompt-navigator">
            <button
              className="button-onlyicon"
              disabled={activePromptIndex === 0}
              onClick={movePrompt.bind(null, -1)}
              title="Previous"
            >
              <CaretBackIcon />
            </button>
            <span>
              {activePromptIndex + 1} / {openPrompts.length}
            </span>
            <button
              className="button-onlyicon"
              disabled={activePromptIndex === openPrompts.length - 1}
              onClick={movePrompt.bind(null, 1)}
              title="Next"
            >
              <CaretForwradIcon />
            </button>
          </div>
        )}
        <h1 className="prompt-host">{openPrompts[activePromptIndex].host}</h1>
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
          {getAllowedCapabilities(openPrompts[activePromptIndex].level).map(
            cap => (
              <li key={cap}>{cap}</li>
            )
          )}
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
      {openPrompts[activePromptIndex].params && (
        <>
          <p>Acting on:</p>
          <pre className="prompt-request-raw">
            <code>
              {JSON.stringify(openPrompts[activePromptIndex].params, null, 2)}
            </code>
          </pre>
        </>
      )}
    </>
  );
}

const root = createRoot(document.getElementById('main'));
root.render(<Prompt />);
