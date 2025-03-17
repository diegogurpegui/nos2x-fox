import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

function PinPrompt() {
  const [pin, setPin] = useState('');

  function handlePinChange(e: React.ChangeEvent<HTMLInputElement>) {
    setPin(e.target.value);
  }

  function handleConfirm() {
    // TODO: implement PIN confirmation
  }

  return (
    <>
      <header>
        <p>Enter PIN</p>
      </header>
      <main>
        <input type="text" value={pin} maxLength={6} onChange={handlePinChange} />
        <button onClick={handleConfirm}>Confirm</button>
      </main>
    </>
  );
}

const root = createRoot(document.getElementById('main'));
root.render(<PinPrompt />);
