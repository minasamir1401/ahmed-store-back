const { google } = require('googleapis');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
let clientEmail = process.env.GOOGLE_INDEXING_CLIENT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL;
let privateKey = process.env.GOOGLE_INDEXING_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY;

if (privateKey) {
  privateKey = privateKey.trim().replace(/^["']/, '').replace(/["']$/, '').replace(/\\n/g, '\n');
}

if (!clientEmail || !privateKey) {
  try {
    let key;
    if (process.env.GOOGLE_INDEXING_CREDENTIALS) {
      key = JSON.parse(process.env.GOOGLE_INDEXING_CREDENTIALS);
    } else {
      key = require('../../google-indexing-key.json');
    }
    if (key) {
      clientEmail = clientEmail || key.client_email;
      privateKey = privateKey || key.private_key;
    }
  } catch (err) {
    if (!clientEmail || !privateKey) {
      console.error('[Google Indexing API] Could not load credentials:', err.message);
    }
  }
}

const jwtClient = (clientEmail && privateKey) ? new google.auth.JWT({
  email: clientEmail,
  key: privateKey,
  scopes: ['https://www.googleapis.com/auth/indexing']
}) : null;

const INDEXNOW_KEY = '8c772c63ef1a4030ab7b09ab491ff2c6';

/**
 * Notifies Bing IndexNow API about a URL update.
 * @param {string} url - The exact URL that was updated.
 */
async function notifyIndexNow(url) {
  try {
    const parsedUrl = new URL(url);
    const host = parsedUrl.host;
    
    console.log(`[IndexNow API] Notifying IndexNow for: ${url}`);
    
    const response = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({
        host: host,
        key: INDEXNOW_KEY,
        keyLocation: `https://${host}/${INDEXNOW_KEY}.txt`,
        urlList: [url]
      })
    });

    if (response.ok) {
      console.log(`[IndexNow API] Successfully notified IndexNow for ${url}. Status: ${response.status}`);
    } else {
      const errText = await response.text();
      console.warn(`[IndexNow API] Failed to notify IndexNow for ${url}. Status: ${response.status}. Response: ${errText}`);
    }
  } catch (err) {
    console.error(`[IndexNow API] Error notifying IndexNow for ${url}:`, err.message);
  }
}

/**
 * Notifies Google Indexing API about a URL update or deletion and logs to DB.
 * @param {string} url - The exact URL that was updated or deleted.
 * @param {'URL_UPDATED' | 'URL_DELETED'} type - The type of notification.
 */
async function notifyGoogleIndexing(url, type = 'URL_UPDATED') {
  // Call IndexNow in parallel for Bing/Yahoo (only for updates)
  if (type === 'URL_UPDATED') {
    notifyIndexNow(url).catch(err => console.error('[IndexNow API] error:', err));
  }

  if (!jwtClient) {
    const errorMsg = 'Credentials are missing or could not be loaded.';
    console.warn(`[Google Indexing API] Cannot notify ${type} for ${url} because credentials are missing.`);
    
    // Log credentials failure in DB
    try {
      await prisma.indexingLog.create({
        data: {
          url: url,
          action: type,
          status: 'failed',
          response: errorMsg
        }
      });
    } catch (dbErr) {
      console.error('[Google Indexing API] Failed to write log to database:', dbErr.message);
    }
    return;
  }

  try {
    const indexing = google.indexing({
      version: 'v3',
      auth: jwtClient
    });

    const response = await indexing.urlNotifications.publish({
      requestBody: {
        url: url,
        type: type
      }
    });

    console.log(`[Google Indexing API] Successfully notified ${type} for ${url}. Status: ${response.status}`);

    // Log success in DB
    try {
      await prisma.indexingLog.create({
        data: {
          url: url,
          action: type,
          status: 'success',
          response: JSON.stringify(response.data || { status: response.status })
        }
      });
    } catch (dbErr) {
      console.error('[Google Indexing API] Failed to write log to database:', dbErr.message);
    }

    return response.data;
  } catch (error) {
    console.error(`[Google Indexing API] Error notifying ${type} for ${url}:`, error.message);
    
    let errorResponse = error.message;
    if (error.response && error.response.data) {
      console.error('[Google Indexing API] Response data:', JSON.stringify(error.response.data, null, 2));
      errorResponse += ' | ' + JSON.stringify(error.response.data);
    }

    // Log failure in DB
    try {
      await prisma.indexingLog.create({
        data: {
          url: url,
          action: type,
          status: 'failed',
          response: errorResponse
        }
      });
    } catch (dbErr) {
      console.error('[Google Indexing API] Failed to write log to database:', dbErr.message);
    }
    // We don't throw the error so that the main application flow doesn't crash.
  }
}

module.exports = {
  notifyGoogleIndexing
};
