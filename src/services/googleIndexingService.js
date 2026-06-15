const { google } = require('googleapis');
const path = require('path');
let key;
try {
  if (process.env.GOOGLE_INDEXING_CREDENTIALS) {
    key = JSON.parse(process.env.GOOGLE_INDEXING_CREDENTIALS);
  } else {
    key = require('../../google-indexing-key.json');
  }
} catch (err) {
  console.error('[Google Indexing API] Could not load credentials:', err.message);
}

const jwtClient = key ? new google.auth.JWT(
  key.client_email,
  null,
  key.private_key,
  ['https://www.googleapis.com/auth/indexing'],
  null
) : null;

/**
 * Notifies Google Indexing API about a URL update or deletion.
 * @param {string} url - The exact URL that was updated or deleted.
 * @param {'URL_UPDATED' | 'URL_DELETED'} type - The type of notification.
 */
async function notifyGoogleIndexing(url, type = 'URL_UPDATED') {
  if (!jwtClient) {
    console.warn(`[Google Indexing API] Cannot notify ${type} for ${url} because credentials are missing.`);
    return;
  }
  try {
    // Authorize before sending request
    await jwtClient.authorize();
    
    const options = {
      url: 'https://indexing.googleapis.com/v3/urlNotifications:publish',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        url: url,
        type: type,
      },
      auth: jwtClient,
    };

    const response = await google.request(options);
    console.log(`[Google Indexing API] Successfully notified ${type} for ${url}. Status: ${response.status}`);
    return response.data;
  } catch (error) {
    console.error(`[Google Indexing API] Error notifying ${type} for ${url}:`, error.message);
    if (error.response && error.response.data) {
      console.error('[Google Indexing API] Response data:', error.response.data);
    }
    // We don't throw the error so that the main application flow (like saving a product) doesn't crash.
  }
}

module.exports = {
  notifyGoogleIndexing
};
