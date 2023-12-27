import browser from 'webextension-polyfill';
import React, { useRef, useEffect, useState } from 'react';

interface ModalProps {
  show: boolean;
  className?: string;
  onClose: () => {};
}

export function Modal({
  show,
  onClose,
  className,
  children
}: React.PropsWithChildren<ModalProps>) {
  const modalRef = useRef<HTMLDivElement>(null);

  // const hide = () => {
  //   if (modalRef.current) {
  //     modalRef.current.style.display = 'none';
  //   }
  // };
  // const display = () => {
  //   if (modalRef.current) {
  //     modalRef.current.style.display = 'flex';
  //   }
  // };

  const handleOverlayClick = () => {
    show = false;
    if (onClose) onClose();
  };

  // useEffect(() => {
  //   console.log('useEffect show', show);
  // }, [show]);

  return show ? (
    <div className={`modal-wrapper ${className}`} ref={modalRef}>
      <div className={`modal`}>{children}</div>
      <div className="overlay" onClick={handleOverlayClick}></div>
    </div>
  ) : null;
}
