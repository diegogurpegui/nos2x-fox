export const PERMISSIONS_REQUIRED = {
  getPublicKey: 1,
  getRelays: 5,
  signEvent: 10,
  'nip04.encrypt': 20,
  'nip04.decrypt': 20
};

const ORDERED_PERMISSIONS = [
  [1, ['getPublicKey']],
  [5, ['getRelays']],
  [10, ['signEvent']],
  [20, ['nip04.encrypt']],
  [20, ['nip04.decrypt']]
];

const PERMISSION_NAMES = {
  getPublicKey: 'read your public key',
  getRelays: 'read your list of preferred relays',
  signEvent: 'sign events using your private key',
  'nip04.encrypt': 'encrypt messages to peers',
  'nip04.decrypt': 'decrypt messages from peers',
  'nip44.encrypt': 'encrypt messages to peers (nip44)',
  'nip44.decrypt': 'decrypt messages from peers (nip44)'
};

export function getAllowedCapabilities(permission): string[] {
  let requestedMethods: string[] = [];
  for (let i = 0; i < ORDERED_PERMISSIONS.length; i++) {
    let [perm, methods] = ORDERED_PERMISSIONS[i];
    if (perm > permission) break;
    requestedMethods = requestedMethods.concat(methods as string[]);
  }

  if (requestedMethods.length === 0) return ['nothing'];

  return requestedMethods.map(method => PERMISSION_NAMES[method]);
}

export function getPermissionsString(permission) {
  let capabilities = getAllowedCapabilities(permission);

  if (capabilities.length === 0) return 'none';
  if (capabilities.length === 1) return capabilities[0];

  return (
    (capabilities.slice(0, -1) as string[]).join(', ') +
    ' and ' +
    capabilities[capabilities.length - 1]
  );
}

export function truncatePublicKeys(
  publicKey: String,
  startCount: number = 15,
  endCount: number = 15
): String {
  return `${publicKey.substring(0, startCount)}…${publicKey.substring(
    publicKey.length - endCount
  )}`;
}

/**
 * Checks wether the URL is valid
 * @param url Relay websocket URL
 * @returns {boolean}
 */
export function isValidRelayURL(url: string): boolean {
  return url != null && url.trim() != '' && url.startsWith('wss://');
}

export function isHexadecimal(value: string) {
  return /^[0-9A-Fa-f]+$/g.test(value);
}

export function convertHexToUint8Array(hexData: string): Uint8Array {
  // ensure even number of characters
  if (hexData.length % 2 != 0) {
    throw new Error(
      'WARNING: expecting an even number of characters in the hexString'
    );
  }

  // check for some non-hex characters
  const hasInvalidChars = hexData.match(/[G-Z\s]/i);
  if (hasInvalidChars) {
    throw new Error(
      `WARNING: found non-hex characters: ${hasInvalidChars.toString()}`
    );
  }

  // split the string into pairs of octets
  const octectPairs = hexData.match(/[\dA-F]{2}/gi);

  if (!octectPairs) {
    throw Error('Cannot extract octect pairs.');
  }

  // convert the octets to integers
  const integers = octectPairs.map(pair => {
    return parseInt(pair, 16);
  });

  const array = new Uint8Array(integers);
  return array;
}

export function convertUint8ArrayToHex(arrayData: Uint8Array): string {
  let hexData = '';
  for (let i = 0; i < arrayData.length; i++) {
    const value = arrayData[i];
    hexData = hexData + ('0' + value.toString(16)).slice(-2);
  }
  return hexData;
}
