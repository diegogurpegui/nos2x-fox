import browser from 'webextension-polyfill';
import React, { useState, useEffect } from 'react';

import InformationCircleIcon from '../assets/icons/information-circle-outline.svg';
import CheckmarkCircleIcon from '../assets/icons/checkmark-circle-outline.svg';
import WarningDiceIcon from '../assets/icons/warning-outline.svg';

interface AlertProps {
  message: String;
  type: 'info|warning|success';
}

export function Alert<AlertProps>({ message, type }) {
  return (
    <div className={`alert ${type}`}>
      {type == 'info' ? (
        <InformationCircleIcon />
      ) : type == 'warning' ? (
        <WarningDiceIcon />
      ) : (
        <CheckmarkCircleIcon />
      )}
      {message}
    </div>
  );
}
