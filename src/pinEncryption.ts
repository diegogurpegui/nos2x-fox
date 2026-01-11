/**
 * PIN-based encryption utilities for private key protection
 * Uses AES-GCM-256 with PBKDF2 key derivation
 */

const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16; // bytes
const IV_LENGTH = 12; // bytes (for AES-GCM)

export interface EncryptedData {
  salt: string; // base64
  iv: string; // base64
  ciphertext: string; // base64
}

/**
 * Derives an encryption key from a PIN using PBKDF2
 */
async function deriveKeyFromPin(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const pinData = encoder.encode(pin);

  const baseKey = await crypto.subtle.importKey('raw', pinData, 'PBKDF2', false, [
    'deriveBits',
    'deriveKey'
  ]);

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts a private key using a PIN
 * @param pin - The PIN to use for encryption
 * @param privateKey - The private key to encrypt (hex string)
 * @returns JSON string containing encrypted data (salt, iv, ciphertext)
 */
export async function encryptPrivateKey(pin: string, privateKey: string): Promise<string> {
  // Generate random salt and IV
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  // Derive encryption key from PIN
  const key = await deriveKeyFromPin(pin, salt);

  // Convert private key to bytes
  const encoder = new TextEncoder();
  const privateKeyBytes = encoder.encode(privateKey);

  // Encrypt
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv
    },
    key,
    privateKeyBytes
  );

  // Convert to base64 for storage
  const encryptedData: EncryptedData = {
    salt: arrayBufferToBase64(salt),
    iv: arrayBufferToBase64(iv),
    ciphertext: arrayBufferToBase64(ciphertext)
  };

  return JSON.stringify(encryptedData);
}

/**
 * Decrypts a private key using a PIN
 * @param pin - The PIN used for encryption
 * @param encryptedKey - JSON string containing encrypted data
 * @returns The decrypted private key (hex string)
 * @throws Error if decryption fails (wrong PIN or corrupted data)
 */
export async function decryptPrivateKey(pin: string, encryptedKey: string): Promise<string> {
  let encryptedData: EncryptedData;
  try {
    encryptedData = JSON.parse(encryptedKey);
  } catch (error) {
    throw new Error('Invalid encrypted key format');
  }

  // Convert from base64
  const salt = base64ToUint8Array(encryptedData.salt);
  const iv = base64ToUint8Array(encryptedData.iv);
  const ciphertext = base64ToUint8Array(encryptedData.ciphertext);

  // Derive encryption key from PIN
  const key = await deriveKeyFromPin(pin, salt);

  // Decrypt
  let decryptedBytes: ArrayBuffer;
  try {
    decryptedBytes = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv as BufferSource
      },
      key,
      ciphertext as BufferSource
    );
  } catch (error) {
    throw new Error('Decryption failed - incorrect PIN or corrupted data');
  }

  // Convert back to string
  const decoder = new TextDecoder();
  return decoder.decode(decryptedBytes);
}

/**
 * Converts an ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Converts a base64 string to Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
