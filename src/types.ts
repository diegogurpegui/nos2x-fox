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
  '1000-9999': 'Regular Event',
  '10000-19999': 'Replaceable Event',
  '20000-29999': 'Ephemeral Event',
  '30000-39999': 'Parameterized Replaceable Event'
};

export enum ConfigurationKeys {
  PRIVATE_KEY = 'private_key',
  RELAYS = 'relays',
  PERMISSIONS = 'permissions'
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

export enum AuthorizationCondition {
  REJECT = 'no',
  FOREVER = 'forever',
  EXPIRABLE_5M = 'expirable_5m',
  EXPIRABLE_1H = 'expirable_1h',
  EXPIRABLE_8H = 'expirable_8h',
  SINGLE = 'single'
}

export type PromptParams = {
  event: {
    kind: number;
  };
};
