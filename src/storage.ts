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
import { convertHexToUint8Array } from './common';

export async function readActivePrivateKey(): Promise<string> {
  const data = await browser.storage.local.get(ConfigurationKeys.PRIVATE_KEY);
  return data[ConfigurationKeys.PRIVATE_KEY] as string;
}
export async function updateActivePrivateKey(privateKey: string) {
  if (privateKey == null || privateKey == '') {
    console.log('Removing active profile (private key)');
  } else {
    console.log('Storing new active pubKey');
  }

  return browser.storage.local.set({
    [ConfigurationKeys.PRIVATE_KEY]: privateKey
  });
}

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
    return updateProfile(profile);
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
    activeProfile.permissions = permissions;
    await updateProfile(activeProfile);
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
  return updateProfile(profile);
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
  return updateProfile(profile);
}

//#region Profiles >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
export async function readProfiles(): Promise<ProfilesConfig> {
  const { profiles = {} } = (await browser.storage.local.get(ConfigurationKeys.PROFILES)) as {
    [ConfigurationKeys.PROFILES]: ProfilesConfig;
  };

  const pubKeys = Object.keys(profiles);
  // if there are no profiles, check if there's an active profile
  if (pubKeys.length == 0) {
    const privateKey = await readActivePrivateKey();

    if (privateKey) {
      // there is a private key, so I need to initialize the profiles
      const profile: ProfileConfig = {
        privateKey,
        relays: await readActiveRelays(),
        permissions: await readActivePermissions()
      };
      const pubKey = getPublicKey(convertHexToUint8Array(privateKey));

      profiles[pubKey] = profile;
      // save it
      browser.storage.local.set({ [ConfigurationKeys.PROFILES]: profiles });
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
    await updateActivePrivateKey(profiles[profilePubKey].privateKey);
  }

  return profiles;
}
export async function addProfile(profile: ProfileConfig): Promise<ProfilesConfig> {
  const profiles = await readProfiles();
  profiles[getPublicKey(convertHexToUint8Array(profile.privateKey))] = profile;

  await browser.storage.local.set({
    [ConfigurationKeys.PROFILES]: profiles
  });

  // if it's the first profile to be added, then set it as the active one
  const activePrivateKey = await readActivePrivateKey();
  if (!activePrivateKey && Object.keys(profiles).length == 1) {
    await updateActivePrivateKey(profile.privateKey);
  }

  return profiles;
}
export async function updateProfile(profile: ProfileConfig): Promise<ProfilesConfig> {
  const profiles = await readProfiles();
  profiles[getPublicKey(convertHexToUint8Array(profile.privateKey))] = profile;

  await browser.storage.local.set({
    [ConfigurationKeys.PROFILES]: profiles
  });

  return profiles;
}
export async function deleteProfile(profilePublicKey: string): Promise<ProfilesConfig> {
  console.debug(`Deleting profile: ${profilePublicKey}...`);
  const profiles = await readProfiles();

  // get the profile and private key for later checks
  const profileToBeDeleted = profiles[profilePublicKey];
  const privateKeyToBeDeleted = profileToBeDeleted.privateKey;

  // delete from storage
  delete profiles[profilePublicKey];
  await browser.storage.local.set({
    [ConfigurationKeys.PROFILES]: profiles
  });

  // now change the active, if it was removed
  let activePrivateKey = await readActivePrivateKey();
  if (activePrivateKey == privateKeyToBeDeleted) {
    if (Object.keys(profiles).length > 0) {
      activePrivateKey = Object.entries(profiles)[0][1].privateKey;
    } else {
      activePrivateKey = '';
    }
    await updateActivePrivateKey(activePrivateKey);
  }

  return profiles;
}
export async function getActiveProfile(): Promise<ProfileConfig> {
  const privateKey = await readActivePrivateKey();
  if (privateKey) {
    const publicKey = getPublicKey(convertHexToUint8Array(privateKey));
    const profiles = await readProfiles();
    return profiles[publicKey];
  } else {
    throw new Error('There is no active private key.');
  }
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
