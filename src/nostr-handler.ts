import { buildNostrLinkUrl } from './common';
import * as Storage from './storage';

/**
 * Redirects to the configured handler for nostr: protocol links.
 *
 * Extracts the 'uri' param, substitutes it into the handler template, and redirects.
 * Closes the window if input is missing or invalid.
 *
 * @async
 */
async function handleNostrProtocolLink(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const nostrUri = params.get('uri');
  const template = await Storage.getNostrLinkHandlerUrlTemplate();

  if (!template.trim() || !nostrUri) {
    window.close();
    return;
  }

  const destinationUrl = buildNostrLinkUrl(template, decodeURIComponent(nostrUri));
  if (!destinationUrl) {
    window.close();
    return;
  }

  location.replace(destinationUrl);
}

handleNostrProtocolLink();
