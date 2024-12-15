export const PERMISSIONS_REQUIRED = {
  getPublicKey: 1,
  getRelays: 5,
  signEvent: 10,
  'nip04.encrypt': 20,
  'nip04.decrypt': 20,
  'nip44.encrypt': 20,
  'nip44.decrypt': 20
};

const ORDERED_PERMISSIONS: [number, (keyof typeof PERMISSIONS_REQUIRED)[]][] = [
  [1, ['getPublicKey']],
  [5, ['getRelays']],
  [10, ['signEvent']],
  [20, ['nip04.encrypt', 'nip04.decrypt', 'nip44.encrypt', 'nip44.decrypt']]
];

const PERMISSION_NAMES: Record<keyof typeof PERMISSIONS_REQUIRED, string> = {
  getPublicKey: 'read your public key',
  getRelays: 'read your list of preferred relays',
  signEvent: 'sign events using your private key',
  'nip04.encrypt': 'encrypt messages to peers',
  'nip04.decrypt': 'decrypt messages from peers',
  'nip44.encrypt': 'encrypt messages to peers (nip44)',
  'nip44.decrypt': 'decrypt messages from peers (nip44)'
};

/**
 * Returns a list of capabilities that are allowed based on the provided
 * permission level. The capabilities correspond to methods that a host
 * can perform if granted the specified permission.
 *
 * @param permission - The permission level to evaluate.
 * @returns An array of strings describing the allowed capabilities.
 *          If no capabilities are allowed, returns ['nothing'].
 */
export function getAllowedCapabilities(permission: number): string[] {
  let requestedMethods: string[] = [];
  for (let i = 0; i < ORDERED_PERMISSIONS.length; i++) {
    let [perm, methods] = ORDERED_PERMISSIONS[i];
    if (perm > permission) break;
    requestedMethods = requestedMethods.concat(methods);
  }

  if (requestedMethods.length === 0) return ['nothing'];

  return requestedMethods.map(method => PERMISSION_NAMES[method]);
}

/**
 * Given a permission level, returns a string describing the capabilities
 * that the host will have if the user grants this permission.
 *
 * The string will be in English, and will be one of the following:
 * - 'nothing' if the permission level is 0
 * - a single capability (e.g. 'read your public key')
 * - a comma-separated list of capabilities, with an 'and' between the
 *   last two (e.g. 'read your public key, read your list of preferred
 *   relays, and sign events using your private key')
 */
export function getPermissionsString(permission: number) {
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
