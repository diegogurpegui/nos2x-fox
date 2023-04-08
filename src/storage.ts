import browser from 'webextension-polyfill';
import { getPublicKey } from 'nostr-tools';

import {
  AuthorizationCondition,
  ConfigurationKeys,
  PermissionConfig,
  ProfileConfig,
  ProfilesConfig,
  RelaysConfig
} from './types';

export async function readPrivateKey(): Promise<string> {
  const data = await browser.storage.local.get(ConfigurationKeys.PRIVATE_KEY);
  return data[ConfigurationKeys.PRIVATE_KEY];
}
export async function updatePrivateKey(privateKey: string) {
  return browser.storage.local.set({
    [ConfigurationKeys.PRIVATE_KEY]: privateKey
  });
}

export async function readRelays(): Promise<RelaysConfig> {
  const data = await browser.storage.local.get(ConfigurationKeys.RELAYS);
  return data[ConfigurationKeys.RELAYS];
}
export async function updateRelays(relays) {
  return browser.storage.local.set({
    relays: relays
  });
}

export async function readPermissions(): Promise<PermissionConfig> {
  let { permissions = {} }: { permissions: PermissionConfig } =
    await browser.storage.local.get(ConfigurationKeys.PERMISSIONS);

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
  if (needsUpdate) browser.storage.local.set({ permissions });

  return permissions;
}
export async function updatePermission(host: string, permission) {
  const storedPermissions = (await readPermissions()) || {};

  browser.storage.local.set({
    permissions: {
      ...storedPermissions,
      [host]: {
        ...permission,
        created_at: Math.round(Date.now() / 1000)
      }
    }
  });
}
export async function removePermissions(host: string) {
  let { permissions = {} }: { permissions: PermissionConfig } =
    await browser.storage.local.get(ConfigurationKeys.PERMISSIONS);
  delete permissions[host];
  browser.storage.local.set({ permissions });
}

export async function readProfiles(): Promise<ProfilesConfig> {
  let { profiles = {} }: { [ConfigurationKeys.PROFILES]: ProfilesConfig } =
    await browser.storage.local.get(ConfigurationKeys.PROFILES);

  const pubKeys = Object.keys(profiles);
  // if there are no profiles, check if there's an active profile
  if (pubKeys.length == 0) {
    const privateKey = await readPrivateKey();

    if (privateKey) {
      // there is a private key, so I need to initialize the profiles
      const profile: ProfileConfig = {
        privateKey,
        relays: await readRelays(),
        permissions: await readPermissions()
      };
      const pubKey = getPublicKey(privateKey);

      profiles[pubKey] = profile;
      // save it
      browser.storage.local.set({ [ConfigurationKeys.PROFILES]: profiles });
    }
  }

  return profiles;
}

export async function updateProfiles(
  profiles: ProfilesConfig
): Promise<ProfilesConfig> {
  browser.storage.local.set({
    [ConfigurationKeys.PROFILES]: profiles
  });

  return profiles;
}
