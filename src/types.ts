import { Event, VerifiedEvent } from 'nostr-tools';

export const KindNames = {
  '0': 'Metadata',
  '1': 'Text',
  '2': 'Recommend Relay',
  '3': 'Contacts',
  '4': 'Encrypted Direct Messages',
  '5': 'Event Deletion',
  '6': 'Repost',
  '7': 'Reaction',
  '40': 'Channel Creation',
  '41': 'Channel Metadata',
  '42': 'Channel Message',
  '43': 'Channel Hide Message',
  '44': 'Channel Mute User',
  '45-49': 'Public Chat (Reserved)',
  '1984': 'Reporting',
  '9734': 'Zap Request',
  '9735': 'Zap',
  '10002': 'Relay List Metadata',
  '22242': 'Client Authentication',
  '30023': 'Long-form Content',
  '31234': 'Draft Events',
  '1000-9999': 'Regular Event',
  '10000-19999': 'Replaceable Event',
  '20000-29999': 'Ephemeral Event',
  '30000-39999': 'Parameterized Replaceable Event'
};

//#region Configuration ----------------------

export enum ConfigurationKeys {
  PRIVATE_KEY = 'private_key',
  PROFILES = 'profiles',
  OPEN_PROMPTS = 'open_prompts',
  PIN_ENABLED = 'pin_enabled',
  ENCRYPTED_PRIVATE_KEY = 'encrypted_private_key',
  ACTIVE_PUBLIC_KEY = 'active_public_key',
  PIN_CACHE_DURATION = 'pin_cache_duration'
}

export type RelaysConfig = {
  [url: string]: { read: boolean; write: boolean };
};

export type PermissionConfig = {
  [host: string]: {
    condition: string;
    created_at: number;
    level: number;
  };
};

export type ProfileConfig = {
  privateKey: string;
  name?: string;
  relays?: RelaysConfig;
  permissions?: PermissionConfig;
};

export type ProfilesConfig = {
  [pubKey: string]: ProfileConfig;
};

//#endregion Configuration ----------------------

export enum AuthorizationCondition {
  REJECT = 'no',
  FOREVER = 'forever',
  EXPIRABLE_5M = 'expirable_5m',
  EXPIRABLE_1H = 'expirable_1h',
  EXPIRABLE_8H = 'expirable_8h',
  SINGLE = 'single'
}

export type PromptResponse = {
  /** ID assigned to the prompt */
  id: string;
  /** Indicates whether this message is a prompt */
  prompt: boolean;
  condition: AuthorizationCondition;
  host: string | null;
  level?: number;
};

export type PromptParams = {
  peer: string;
  plaintext?: string;
  ciphertext?: string;
  event?: Event;
};

export type ContentMessageArgs = {
  type: string;
  params: PromptParams;
  host: string;
};

export type ContentScriptMessageResponseError = {
  error: {
    message: string;
    stack?: any;
  };
};
export type ContentScriptMessageResponse =
  | ContentScriptMessageResponseError
  | string
  | VerifiedEvent
  | RelaysConfig;

export type OpenPromptItem = {
  id: string;
  windowId?: number;
  host: string;
  level: number;
  params: PromptParams;
};

export type PinMessage = {
  type: 'setupPin' | 'verifyPin' | 'disablePin';
  pin?: string;
  encryptedKey?: string;
  id?: string;
};

export type PinMessageResponse = {
  success: boolean;
  error?: string;
};
