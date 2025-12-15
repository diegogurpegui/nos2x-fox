![](src/assets/logo/logotype.png)
# nos2x-fox (nos2x for Firefox)
notes and other stuff signed by an extension

This is a fork from https://github.com/fiatjaf/nos2x focused on Firefox and related browsers.

## Nostr Signer Extension

This allows you to sign [Nostr](https://github.com/fiatjaf/nostr) events on web-apps without having to give them your keys.

It provides a `window.nostr` object which has the following methods:

```javascript
async window.nostr.getPublicKey(): string // returns your public key as hex
async window.nostr.signEvent(event): Event // returns the full event object signed
async window.nostr.getRelays(): { [url: string]: RelayPolicy } // returns a map of relays

async window.nostr.nip04.encrypt(pubkey, plaintext): string // returns ciphertext+iv as specified in nip04
async window.nostr.nip04.decrypt(pubkey, ciphertext): string // takes ciphertext+iv as specified in nip04

async window.nostr.nip44.encrypt(pubkey, plaintext): string // takes pubkey, plaintext, returns ciphertext as specified in nip-44
async window.nostr.nip44.decrypt(pubkey, ciphertext): string // takes pubkey, ciphertext, returns plaintext as specified in nip-44
```

## Install

* By yourself from file: look into [Releases](https://github.com/diegogurpegui/nos2x-fox/releases)
* From the site [Firefox Add-on](https://addons.mozilla.org/en-US/firefox/addon/nos2x-fox/)

## Develop

To run the plugin from this code:

```
$ git clone https://github.com/diegogurpegui/nos2x-fox
$ cd nos2x-fox
$ yarn install
$ yarn run build
```

After you build the extension, follow these steps:
1. Open Firefox
2. Go to about:debugging
3. Click on "This Firefox" on the left
4. Click on "Load Temporary Add-on..."
5. Select any file from the `dist/` folder of the extension


## PIN Protection

nos2x-fox includes optional PIN protection to encrypt your private keys. When enabled, your private keys are encrypted using a PIN you choose, and you'll need to enter the PIN each time you use the extension (after the first unlock, the PIN is cached for 10 minutes).

### How to Enable/Disable PIN Protection

1. Open the extension options page
2. In the "Keys" section, click "Enable PIN Protection" or "Disable PIN Protection"
3. Enter your PIN (4-6 digits)
4. If enabling, confirm your PIN
5. If disabling, enter your PIN one last time to verify

### Security Model

- **Ephemeral PIN Cache**: The PIN is stored in memory only and is lost when the browser closes, regardless of how much time has passed
- **Encrypted Storage**: When PIN protection is enabled, private keys are encrypted before being stored. No plain-text private keys are stored anywhere
- **Global Protection**: PIN protection applies to all profiles simultaneously

### Encryption Specification

Private keys are encrypted using the following specification:

- **Algorithm**: AES-GCM-256
- **Key Derivation**: PBKDF2 with SHA-256
- **Iterations**: 100,000
- **Salt**: 16 bytes (random, stored with encrypted data)
- **IV**: 12 bytes (random, stored with encrypted data)
- **Cache Duration**: 10 minutes (ephemeral, lost on browser close)

The encrypted data is stored as a JSON string containing base64-encoded salt, IV, and ciphertext.

## Screenshots

![](screenshots/screenshot_popup.png)
![](screenshots/screenshot_options.png)
![](screenshots/screenshot_prompt.png)

## Feedback and ideas

If you are experiencing any issue, you can report it in the [Issues](https://github.com/diegogurpegui/nos2x-fox/issues) secion.

If you have any feature suggestion or idea for this extension, feel free to leave it in the [Discussions](https://github.com/diegogurpegui/nos2x-fox/discussions/categories/ideas).  
Also, if you like any of the already proposed ideas, upvote them!

---

## License and Credits

LICENSE: public domain.
Original work by [fiatjaf](https://github.com/fiatjaf).

Design taken from [Flydexo](https://github.com/Flydexo). See https://github.com/fiatjaf/nos2x/pull/15

Icons from [IonIcons](https://ionic.io/ionicons).
