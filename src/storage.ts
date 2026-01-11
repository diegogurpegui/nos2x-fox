import browser from 'webextension-polyfill';
import { getPublicKey } from 'nostr-tools';

import {
  AuthorizationCondition,
  ConfigurationKeys,
  OpenPromptItem,
  PermissionConfig,
  ProfileConfig,
  ProfilesConfig,
  RelaysConfig
} from './types';
import {
  convertHexToUint8Array,
  isPrivateKeyEncrypted,
  derivePublicKeyFromPrivateKey,
  canDerivePublicKeyFromPrivateKey
} from './common';
import { encryptPrivateKey, decryptPrivateKey } from './pinEncryption';
import { clearStringReference } from './memoryUtils';

export async function readActivePrivateKey(): Promise<string> {
  const data = await browser.storage.local.get(ConfigurationKeys.PRIVATE_KEY);
  return data[ConfigurationKeys.PRIVATE_KEY] as string;
}

export async function updateActivePrivateKey(privateKey: string) {
  // Critical: If PIN protection is enabled, reject plain-text storage
  const pinEnabled = await isPinEnabled();
  if (pinEnabled && privateKey) {
    throw new Error(
      'Cannot store plain-text private key when PIN protection is enabled. Use setEncryptedPrivateKey() instead.'
    );
  }

  if (privateKey == null || privateKey == '') {
    console.log('Removing active profile (private key)');
    await removeActivePublicKey();
  } else {
    console.log('Storing new active pubKey');
    // Always store active public key for consistent profile lookup
    const publicKey = derivePublicKeyFromPrivateKey(privateKey);
    await setActivePublicKey(publicKey);
  }

  return browser.storage.local.set({
    [ConfigurationKeys.PRIVATE_KEY]: privateKey
  });
}

//#region PIN Protection >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

/**
 * Checks if PIN protection is enabled
 */
export async function isPinEnabled(): Promise<boolean> {
  const data = await browser.storage.local.get(ConfigurationKeys.PIN_ENABLED);
  return (data[ConfigurationKeys.PIN_ENABLED] as boolean) ?? false;
}

/**
 * Sets PIN protection enabled/disabled state
 */
export async function setPinEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({
    [ConfigurationKeys.PIN_ENABLED]: enabled
  });
}

/**
 * Gets the PIN cache duration in milliseconds
 * Default: 10 seconds (10000 ms)
 */
export async function getPinCacheDuration(): Promise<number> {
  const data = await browser.storage.local.get(ConfigurationKeys.PIN_CACHE_DURATION);
  return (data[ConfigurationKeys.PIN_CACHE_DURATION] as number) ?? 10 * 1000; // Default: 10 seconds
}

/**
 * Sets the PIN cache duration in milliseconds
 */
export async function setPinCacheDuration(durationMs: number): Promise<void> {
  await browser.storage.local.set({
    [ConfigurationKeys.PIN_CACHE_DURATION]: durationMs
  });
}

/**
 * Gets the encrypted private key from storage
 */
export async function getEncryptedPrivateKey(): Promise<string | null> {
  const data = await browser.storage.local.get(ConfigurationKeys.ENCRYPTED_PRIVATE_KEY);
  return (data[ConfigurationKeys.ENCRYPTED_PRIVATE_KEY] as string) ?? null;
}

/**
 * Sets the encrypted private key in storage
 */
export async function setEncryptedPrivateKey(encryptedKey: string): Promise<void> {
  await browser.storage.local.set({
    [ConfigurationKeys.ENCRYPTED_PRIVATE_KEY]: encryptedKey
  });
}

/**
 * Enables PIN protection by encrypting all private keys
 * @param pin - The PIN to use for encryption
 */
export async function enablePinProtection(pin: string): Promise<void> {
  // Get all profiles
  const profiles = await readProfiles();
  const activePrivateKey = await readActivePrivateKey();

  if (!activePrivateKey) {
    throw new Error('No active private key to encrypt');
  }

  // Get active public key before encrypting (should already be stored, but ensure it)
  const activePublicKey = derivePublicKeyFromPrivateKey(activePrivateKey);
  await setActivePublicKey(activePublicKey);

  // Encrypt active private key
  const encryptedActiveKey = await encryptPrivateKey(pin, activePrivateKey);
  await setEncryptedPrivateKey(encryptedActiveKey);

  // Encrypt all profile private keys
  for (const pubKey in profiles) {
    const profile = profiles[pubKey];
    if (profile.privateKey) {
      profile.privateKey = await encryptPrivateKey(pin, profile.privateKey);
    }
  }
  await updateProfiles(profiles);

  // Clear plain-text private key
  await browser.storage.local.remove(ConfigurationKeys.PRIVATE_KEY);

  // Enable PIN protection
  await setPinEnabled(true);
}

/**
 * Enables PIN protection with an already encrypted key (used by background script)
 * @param pin - The PIN used for encryption
 * @param encryptedKey - The already encrypted private key
 */
export async function enablePinProtectionWithEncryptedKey(
  pin: string,
  encryptedKey: string
): Promise<void> {
  // Get all profiles
  const profiles = await readProfiles();
  const currentPrivateKey = await readActivePrivateKey();

  if (!currentPrivateKey) {
    throw new Error('No active private key found');
  }

  // Get active public key before encrypting (should already be stored, but ensure it)
  const activePublicKey = derivePublicKeyFromPrivateKey(currentPrivateKey);
  await setActivePublicKey(activePublicKey);

  // Store encrypted key
  await setEncryptedPrivateKey(encryptedKey);

  // Encrypt all profile private keys
  for (const pubKey in profiles) {
    const profile = profiles[pubKey];
    if (profile.privateKey && !isPrivateKeyEncrypted(profile.privateKey)) {
      // Encrypt profile private key
      profile.privateKey = await encryptPrivateKey(pin, profile.privateKey);
    }
  }
  await updateProfiles(profiles);

  // Clear plain-text private key
  await browser.storage.local.remove(ConfigurationKeys.PRIVATE_KEY);

  // Enable PIN protection
  await setPinEnabled(true);
}

/**
 * Gets the active public key (used when PIN protection is enabled)
 */
export async function getActivePublicKey(): Promise<string | null> {
  const data = await browser.storage.local.get(ConfigurationKeys.ACTIVE_PUBLIC_KEY);
  return (data[ConfigurationKeys.ACTIVE_PUBLIC_KEY] as string) ?? null;
}

/**
 * Sets the active public key (used when PIN protection is enabled)
 */
export async function setActivePublicKey(publicKey: string): Promise<void> {
  await browser.storage.local.set({
    [ConfigurationKeys.ACTIVE_PUBLIC_KEY]: publicKey
  });
}

/**
 * Removes the active public key
 */
export async function removeActivePublicKey(): Promise<void> {
  await browser.storage.local.remove(ConfigurationKeys.ACTIVE_PUBLIC_KEY);
}

/**
 * Disables PIN protection by decrypting all private keys
 * @param pin - The PIN to use for decryption
 */
export async function disablePinProtection(pin: string): Promise<void> {
  const encryptedKey = await getEncryptedPrivateKey();
  if (!encryptedKey) {
    throw new Error('No encrypted private key found');
  }

  // Decrypt active private key
  let decryptedActiveKey = await decryptPrivateKey(pin, encryptedKey);

  try {
    // Decrypt all profile private keys
    const profiles = await readProfiles();
    for (const pubKey in profiles) {
      const profile = profiles[pubKey];
      if (profile.privateKey) {
        try {
          profile.privateKey = await decryptPrivateKey(pin, profile.privateKey);
        } catch (error) {
          console.error(`Failed to decrypt profile ${pubKey}:`, error);
          throw new Error(`Failed to decrypt profile private key: ${error.message}`);
        }
      }
    }
    await updateProfiles(profiles);

    // Clear encrypted private key
    await browser.storage.local.remove(ConfigurationKeys.ENCRYPTED_PRIVATE_KEY);

    // Disable PIN protection BEFORE updating private key to allow plain-text storage
    await setPinEnabled(false);

    // Update active private key (this will also update active public key)
    // This must happen after disabling PIN protection to avoid the error
    await updateActivePrivateKey(decryptedActiveKey);
  } finally {
    // Clear decrypted active key reference from memory
    // Note: Strings are immutable, but we null the reference to minimize exposure
    decryptedActiveKey = clearStringReference(decryptedActiveKey) as any;
  }
}

/**
 * Gets the decrypted private key for a specific profile
 * This is used internally when PIN protection is enabled
 * @param pin - The PIN to decrypt with
 * @param publicKey - The public key of the profile (optional, defaults to active)
 */
export async function getDecryptedProfilePrivateKey(
  pin: string,
  publicKey?: string
): Promise<string> {
  const pinEnabled = await isPinEnabled();
  if (!pinEnabled) {
    // PIN not enabled, return plain key
    if (publicKey) {
      const profile = await getProfile(publicKey);
      return profile.privateKey;
    } else {
      return await readActivePrivateKey();
    }
  }

  // PIN enabled, decrypt
  if (publicKey) {
    const profile = await getProfile(publicKey);
    if (!profile.privateKey) {
      throw new Error('Profile private key not found');
    }
    return await decryptPrivateKey(pin, profile.privateKey);
  } else {
    const encryptedKey = await getEncryptedPrivateKey();
    if (!encryptedKey) {
      throw new Error('Encrypted private key not found');
    }
    return await decryptPrivateKey(pin, encryptedKey);
  }
}

//#endregion PIN Protection <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

export async function readActiveRelays(): Promise<RelaysConfig> {
  const activeProfile = await getActiveProfile();
  return activeProfile.relays || {};
}
export async function updateRelays(
  profilePublicKey: string,
  newRelays
): Promise<ProfilesConfig | undefined> {
  if (newRelays) {
    const profile = await getProfile(profilePublicKey);
    if (!profile) {
      console.warn(`There is no profile with the key '${profilePublicKey}'`);
      return;
    }
    profile.relays = newRelays;
    return updateProfile(profile, profilePublicKey);
  }
}

export async function readActivePermissions(): Promise<PermissionConfig> {
  const activeProfile = await getActiveProfile();

  let permissions = activeProfile.permissions;
  // if no permissions defined, return empty
  if (!permissions) {
    return {};
  }

  // delete expired
  var needsUpdate = false;
  for (let host in permissions) {
    if (
      (permissions[host].condition === AuthorizationCondition.EXPIRABLE_5M &&
        permissions[host].created_at < Date.now() / 1000 - 5 * 60) ||
      (permissions[host].condition === AuthorizationCondition.EXPIRABLE_1H &&
        permissions[host].created_at < Date.now() / 1000 - 1 * 60 * 60) ||
      (permissions[host].condition === AuthorizationCondition.EXPIRABLE_8H &&
        permissions[host].created_at < Date.now() / 1000 - 8 * 60 * 60)
    ) {
      delete permissions[host];
      needsUpdate = true;
    }
  }
  if (needsUpdate) {
    // Create a new profile object with only the permissions updated
    // Preserve the private key as-is (encrypted if PIN enabled)
    const updatedProfile: ProfileConfig = {
      ...activeProfile,
      permissions
    };
    const activePublicKey = await getActivePublicKey();
    if (!activePublicKey) {
      throw new Error('Cannot update profile: active public key not found');
    }
    await updateProfile(updatedProfile, activePublicKey);
  }

  return permissions;
}
export async function addActivePermission(
  host: string,
  condition: string,
  level: number
): Promise<ProfilesConfig> {
  let storedPermissions = await readActivePermissions();

  storedPermissions = {
    ...storedPermissions,
    [host]: {
      condition,
      level,
      created_at: Math.round(Date.now() / 1000)
    }
  };

  // update the active profile
  const profile = await getActiveProfile();
  profile.permissions = storedPermissions;
  const activePublicKey = await getActivePublicKey();
  if (!activePublicKey) {
    throw new Error('Cannot update profile: active public key not found');
  }
  return updateProfile(profile, activePublicKey);
}
export async function removePermissions(
  profilePublicKey: string,
  host: string
): Promise<ProfilesConfig> {
  const profile = await getProfile(profilePublicKey);
  let permissions = profile.permissions;
  if (permissions) {
    delete permissions[host];
  }
  // update the profile
  profile.permissions = permissions;
  return updateProfile(profile, profilePublicKey);
}

//#region Profiles >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
export async function readProfiles(): Promise<ProfilesConfig> {
  const { profiles = {} } = (await browser.storage.local.get(ConfigurationKeys.PROFILES)) as {
    [ConfigurationKeys.PROFILES]: ProfilesConfig;
  };

  const pubKeys = Object.keys(profiles);
  // if there are no profiles, check if there's an active profile
  if (pubKeys.length == 0) {
    const pinEnabled = await isPinEnabled();

    if (pinEnabled) {
      // With PIN enabled, we can't decrypt without PIN, so skip initialization
      // The profile will be created when needed after PIN is entered
      return profiles;
    }

    // Without PIN, try to initialize from private key
    const privateKey = await readActivePrivateKey();
    if (privateKey) {
      // there is a private key, so I need to initialize the profiles
      const pubKey = derivePublicKeyFromPrivateKey(privateKey);
      const profile: ProfileConfig = {
        privateKey,
        relays: {},
        permissions: {}
      };

      profiles[pubKey] = profile;
      // save it (this will also store active public key via updateActivePrivateKey)
      await updateProfiles(profiles);
    }
  }

  return profiles;
}
export async function getProfile(publicKey: string): Promise<ProfileConfig> {
  const profiles = await readProfiles();
  return profiles[publicKey];
}
export async function updateProfiles(profiles: ProfilesConfig): Promise<ProfilesConfig> {
  await browser.storage.local.set({
    [ConfigurationKeys.PROFILES]: profiles
  });

  // if there's only one profile, then set it as the active one
  const activePrivateKey = await readActivePrivateKey();
  if (!activePrivateKey && Object.keys(profiles).length == 1) {
    const profilePubKey = Object.keys(profiles)[0];
    const profile = profiles[profilePubKey];
    const pinEnabled = await isPinEnabled();

    // Always store active public key first
    await setActivePublicKey(profilePubKey);

    // Then update private key based on PIN status
    if (pinEnabled) {
      // When PIN enabled, store encrypted private key if available
      if (profile.privateKey && isPrivateKeyEncrypted(profile.privateKey)) {
        await setEncryptedPrivateKey(profile.privateKey);
      }
    } else {
      // When PIN disabled, store private key
      await updateActivePrivateKey(profile.privateKey);
    }
  }

  return profiles;
}
export async function addProfile(
  profile: ProfileConfig,
  publicKey?: string
): Promise<ProfilesConfig> {
  const pinEnabled = await isPinEnabled();

  // If PIN is enabled, ensure private key is encrypted
  if (pinEnabled && profile.privateKey) {
    // Check if it's already encrypted (starts with {)
    if (!isPrivateKeyEncrypted(profile.privateKey)) {
      throw new Error(
        'Cannot add profile with plain-text private key when PIN protection is enabled'
      );
    }
  }

  const profiles = await readProfiles();

  // Derive public key: use provided publicKey, or derive from private key if not encrypted
  let profilePublicKey: string;
  if (publicKey) {
    profilePublicKey = publicKey;
  } else if (!canDerivePublicKeyFromPrivateKey(profile.privateKey, pinEnabled)) {
    // When PIN is enabled and private key is encrypted, we can't derive public key
    throw new Error('Public key must be provided when adding a profile with encrypted private key');
  } else {
    // Derive public key from plain-text private key
    profilePublicKey = derivePublicKeyFromPrivateKey(profile.privateKey);
  }

  profiles[profilePublicKey] = profile;

  await browser.storage.local.set({
    [ConfigurationKeys.PROFILES]: profiles
  });

  // if it's the first profile to be added, then set it as the active one
  const activePrivateKey = await readActivePrivateKey();
  if (!activePrivateKey && Object.keys(profiles).length == 1) {
    const profilePubKey = Object.keys(profiles)[0];

    // Always store active public key first
    await setActivePublicKey(profilePubKey);

    // Then update private key based on PIN status
    if (pinEnabled) {
      // If PIN enabled, store encrypted private key if available
      if (profile.privateKey && isPrivateKeyEncrypted(profile.privateKey)) {
        await setEncryptedPrivateKey(profile.privateKey);
      }
    } else {
      // If PIN disabled, store private key (which also ensures public key is stored)
      await updateActivePrivateKey(profile.privateKey);
    }
  }

  return profiles;
}
export async function updateProfile(
  profile: ProfileConfig,
  publicKey?: string
): Promise<ProfilesConfig> {
  const pinEnabled = await isPinEnabled();

  // If PIN is enabled, ensure private key is encrypted
  if (pinEnabled && profile.privateKey) {
    // Check if it's already encrypted (starts with {)
    if (!isPrivateKeyEncrypted(profile.privateKey)) {
      // If updating permissions/relays only, preserve the existing encrypted key from storage
      const existingProfiles = await readProfiles();
      let existingProfile: ProfileConfig | undefined;

      if (publicKey) {
        existingProfile = existingProfiles[publicKey];
      } else {
        // Try to find existing profile by matching other fields
        const activePublicKey = await getActivePublicKey();
        if (activePublicKey) {
          existingProfile = existingProfiles[activePublicKey];
        }
      }

      // If we found an existing profile with encrypted key, use it instead
      if (existingProfile?.privateKey && isPrivateKeyEncrypted(existingProfile.privateKey)) {
        profile.privateKey = existingProfile.privateKey;
      } else {
        throw new Error(
          'Cannot update profile with plain-text private key when PIN protection is enabled'
        );
      }
    }
  }

  const profiles = await readProfiles();

  // Determine which profile to update
  let profilePublicKey: string;
  if (publicKey) {
    profilePublicKey = publicKey;
  } else if (!canDerivePublicKeyFromPrivateKey(profile.privateKey, pinEnabled)) {
    // When PIN is enabled and private key is encrypted, try to find existing profile
    // by matching the encrypted private key (since we can't derive public key)
    const existingProfiles = Object.entries(profiles);
    const matchingProfile = existingProfiles.find(([_, p]) => p.privateKey === profile.privateKey);

    if (matchingProfile) {
      profilePublicKey = matchingProfile[0];
    } else if (existingProfiles.length === 1) {
      // If only one profile exists, update that one
      profilePublicKey = existingProfiles[0][0];
    } else {
      throw new Error(
        'Public key must be provided when updating a profile with encrypted private key and multiple profiles exist'
      );
    }
  } else {
    // Derive public key from plain-text private key
    profilePublicKey = derivePublicKeyFromPrivateKey(profile.privateKey);
  }

  profiles[profilePublicKey] = profile;

  await browser.storage.local.set({
    [ConfigurationKeys.PROFILES]: profiles
  });

  return profiles;
}
export async function deleteProfile(profilePublicKey: string): Promise<ProfilesConfig> {
  console.debug(`Deleting profile: ${profilePublicKey}...`);
  const profiles = await readProfiles();

  // Determine if the deleted profile was the active one
  // Always use active public key for comparison (it's always stored now)
  const activePublicKey = await getActivePublicKey();
  const isActiveProfile = activePublicKey === profilePublicKey;

  // delete from storage
  delete profiles[profilePublicKey];
  await browser.storage.local.set({
    [ConfigurationKeys.PROFILES]: profiles
  });

  // now change the active, if it was removed
  if (isActiveProfile) {
    const pinEnabled = await isPinEnabled();

    if (Object.keys(profiles).length > 0) {
      // Set the first remaining profile as active
      const newActivePublicKey = Object.keys(profiles)[0];
      const newActiveProfile = profiles[newActivePublicKey];

      // Always update active public key first
      await setActivePublicKey(newActivePublicKey);

      // Then update private key based on PIN status
      if (pinEnabled) {
        // When PIN enabled, update encrypted private key
        if (newActiveProfile.privateKey && isPrivateKeyEncrypted(newActiveProfile.privateKey)) {
          await setEncryptedPrivateKey(newActiveProfile.privateKey);
        } else {
          // No encrypted key in profile, clear encrypted key
          await browser.storage.local.remove(ConfigurationKeys.ENCRYPTED_PRIVATE_KEY);
        }
      } else {
        // When PIN disabled, update active private key
        await updateActivePrivateKey(newActiveProfile.privateKey || '');
      }
    } else {
      // No profiles left, clear active profile
      await removeActivePublicKey();
      if (pinEnabled) {
        await browser.storage.local.remove(ConfigurationKeys.ENCRYPTED_PRIVATE_KEY);
      } else {
        await updateActivePrivateKey('');
      }
    }
  }

  return profiles;
}
export async function getActiveProfile(): Promise<ProfileConfig> {
  // Always use stored active public key for consistent behavior
  let publicKey = await getActivePublicKey();

  if (!publicKey) {
    // Fallback: derive from private key if available (for migration)
    // Note: This fallback only works when PIN is disabled, as we can't derive from encrypted keys
    const privateKey = await readActivePrivateKey();
    if (privateKey) {
      publicKey = derivePublicKeyFromPrivateKey(privateKey);
      // Store it for future use
      await setActivePublicKey(publicKey);
    }

    // If still no public key, try single profile fallback
    if (!publicKey) {
      const profiles = await readProfiles();
      const profileKeys = Object.keys(profiles);
      if (profileKeys.length === 1) {
        publicKey = profileKeys[0];
        await setActivePublicKey(publicKey);
      } else {
        throw new Error('Cannot determine active profile.');
      }
    }
  }

  const profiles = await readProfiles();
  const profile = profiles[publicKey];
  if (!profile) {
    throw new Error(`Profile not found for public key: ${publicKey}`);
  }
  return profile;
}
//#endregion Profiles <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

export async function readOpenPrompts(): Promise<OpenPromptItem[]> {
  const openPromptsData = await browser.storage.local.get(ConfigurationKeys.OPEN_PROMPTS);
  // parse from JSON string
  const openPromptStr = (openPromptsData[ConfigurationKeys.OPEN_PROMPTS] ?? '[]') as string;
  return JSON.parse(openPromptStr) as OpenPromptItem[];
}

export async function updateOpenPrompts(openPrompts: OpenPromptItem[]) {
  // stringify to JSON to make the change listeners fire (Firefox bug?)
  const openPromptsStr = JSON.stringify(openPrompts);
  await browser.storage.local.set({
    [ConfigurationKeys.OPEN_PROMPTS]: openPromptsStr
  });

  return openPrompts;
}

export function addOpenPromptChangeListener(callback: (newOpenPrompts: OpenPromptItem[]) => void) {
  return browser.storage.onChanged.addListener(changes => {
    // only notify if there's a change with Open Prompts
    if (changes[ConfigurationKeys.OPEN_PROMPTS]) {
      const newValueStr = (changes[ConfigurationKeys.OPEN_PROMPTS].newValue ?? '[]') as string;
      callback(JSON.parse(newValueStr) as OpenPromptItem[]);
    }
  });
}
export function removeOpenPromptChangeListener(listener) {
  return browser.storage.onChanged.removeListener(listener);
}

/**
 * Clear the entire configuration
 * @returns
 */
export async function empty(): Promise<void> {
  return await browser.storage.local.clear();
}

async function clearUnused(): Promise<void> {
  return await browser.storage.local.remove([
    'relays', // no longer used
    'permissions' // no longer used
  ]);
}

// clear unused
clearUnused()
  .then(() => console.debug('Storage cleared from unused.'))
  .catch(error => console.warn('There was a problem clearing the storage from unused.', error));
