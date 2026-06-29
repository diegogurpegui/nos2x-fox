# nos2x-fox

Firefox browser extension (Manifest V2) that implements [NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md): a Nostr signer exposing `window.nostr` to web apps so they can sign events and encrypt/decrypt without receiving private keys.

Fork of [nos2x](https://github.com/fiatjaf/nos2x), adapted for Firefox. Optional PIN protection (AES-GCM-256) encrypts stored keys; unlocked PIN is cached in memory for 10 minutes.

For functional details (install, PIN setup, API methods), see `README.md`.

## Stack

- TypeScript, React 19, WebExtension APIs (`webextension-polyfill`)
- [nostr-tools](https://github.com/nbd-wtf/nostr-tools) for Nostr crypto and event handling
- esbuild bundles `src/` → `dist/`

## Architecture

```
Web page  →  content-script.js  →  background.js  ←  popup / options / prompt / pin (React UIs)
              injects nostr-provider.js (window.nostr)
```

- **content-script.js** — Injects `nostr-provider.js` and relays messages between the page and the background.
- **nostr-provider.ts** — Defines `window.nostr` API; forwards calls to the background via messaging.
- **background.ts** — Core logic: key management, signing, encryption, permissions, prompt orchestration.
- **storage.ts** — Persists keys, relays, and settings via `browser.storage`.
- **pinEncryption.ts / pinCache.ts** — PIN setup, key encryption/decryption, ephemeral PIN cache.
- **common.ts** — Shared helpers (key derivation, popup windows, authorization rules).
- **types.ts** — Shared TypeScript types and message shapes.

## UI entry points

| File | Purpose |
|------|---------|
| `popup.tsx` | Toolbar popup — quick status and actions |
| `options.tsx` | Options page — keys, relays, PIN, permissions |
| `prompt.tsx` | Approval dialog when a site requests signing |
| `pin.tsx` | PIN setup / unlock / disable dialog |
| `PromptManager.tsx` | Queues and manages signing prompts |

## Commands

```bash
yarn install
yarn build          # production build → dist/
yarn watch          # rebuild on file changes
yarn start:firefox  # run extension in Firefox via web-ext
```

Load the extension from `dist/` (about:debugging → Load Temporary Add-on).

## Technical references

NIPs (Nostr Implementation Proposals) relevant to this project:

- [NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md) — `window.nostr` browser capability
- [NIP-04](https://github.com/nostr-protocol/nips/blob/master/04.md) — Encrypted Direct Message (deprecated in favor of NIP-17)
- [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md) — Private Direct Messages
- [NIP repository](https://github.com/nostr-protocol/nips?tab=readme-ov-file)

## Code guidelines

- **DRY** — Reuse existing code when appropriate.
- **KISS** — Keep changes as simple as possible.
- Do not add new dependencies; use only what is already in `package.json`.
- Update `README.md` when a change affects user-facing behavior already documented there.
- Group related code together (helpers, types, enums for the same domain).
