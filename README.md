# nos2x (for Forefox)
notes and other stuff signed by an extension

This is a fork from https://github.com/fiatjaf/nos2x focused on Firefox and related browsers.

## Nostr Signer Extension

This allows you to sign [Nostr](https://github.com/fiatjaf/nostr) events on web-apps without having to give them your keys.

It provides a `window.nostr` object which has the following methods:

```
async window.nostr.getPublicKey(): string // returns your public key as hex
async window.nostr.signEvent(event): Event // returns the full event object signed
async window.nostr.getRelays(): { [url: string]: RelayPolicy } // returns a map of relays
async window.nostr.nip04.encrypt(pubkey, plaintext): string // returns ciphertext+iv as specified in nip04
async window.nostr.nip04.decrypt(pubkey, ciphertext): string // takes ciphertext+iv as specified in nip04
```

## Install

* [Firefox Add-on](https://addons.mozilla.org/en-US/firefox/addon/nos2x/)
  This is the one originally published by **fiatjaf**.

## Develop

To run the plugin from this code:

```
git clone https://github.com/fiatjaf/nos2x
cd nos2x
git checkout chromium                       # or git checkout firefox
yarn                                        # or use npm or pnpm
yarn run build
```

1. Open Firefox
2. go to about:debugging
3. "This Firefox"
4. "Load Temporary Add-on..."
5. select any file from the `extension/` folder


## Demo Video (original nos2x for Chrome)

https://user-images.githubusercontent.com/1653275/149637382-65d50a85-fe30-4259-b7de-99c88b089b53.mp4

## Screenshots

![](screenshots/screenshot_popup.png)
![](screenshots/screenshot_options.png)
![](screenshots/screenshot_popup-with-key.png)
![](screenshots/screenshot_prompt.png)

---

## License and Credits

LICENSE: public domain.
Original work by [fiatjaf](https://github.com/fiatjaf)

Design taken from [Flydexo](https://github.com/Flydexo). See https://github.com/fiatjaf/nos2x/pull/15