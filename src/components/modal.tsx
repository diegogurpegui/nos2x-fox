import browser from 'webextension-polyfill';
import React from 'react';

interface ModalProps {
  show: boolean;
}
export function Modal({ show, children }: React.PropsWithChildren<ModalProps>) {
  return <div class={`modal ${show ? 'show' : ''}`}>{children}</div>;
}
