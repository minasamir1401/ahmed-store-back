const { google } = require('googleapis');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
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

const jwtClient = key ? new google.auth.JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ['https://www.googleapis.com/auth/indexing']
}) : null;

/**
 * Notifies Google Indexing API about a URL update or deletion and logs to DB.
 * @param {string} url - The exact URL that was updated or deleted.
 * @param {'URL_UPDATED' | 'URL_DELETED'} type - The type of notification.
 */
async function notifyGoogleIndexing(url, type = 'URL_UPDATED') {
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
