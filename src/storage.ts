import browser from 'webextension-polyfill';

import { ConfigurationKeys, PermissionConfig, RelaysConfig } from './types';

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
      permissions[host].condition === 'expirable' &&
      permissions[host].created_at < Date.now() / 1000 - 5 * 60
    ) {
      delete permissions[host];
      needsUpdate = true;
    }
  }
  if (needsUpdate) browser.storage.local.set({ permissions });

  return permissions;
}

export async function updatePermission(host: string, permission) {
  browser.storage.local.set({
    permissions: {
      ...((await browser.storage.local.get(ConfigurationKeys.PERMISSIONS)
        .permissions) || {}),
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
