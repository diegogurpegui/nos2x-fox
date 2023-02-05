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
  '44': 'Channel Mute User'
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

export type PromptParams = {
  event: {
    kind: number;
  };
};
