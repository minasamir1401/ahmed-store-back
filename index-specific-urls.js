const { notifyGoogleIndexing } = require('./src/services/googleIndexingService');
require('dotenv').config();

const urls = [
  'https://the-vitahub.com/product/cmqfiiw5n0005lh01k884ra73',
  'https://the-vitahub.com/product/cmqfidref0002lh012wnto2g3'
];

async function run() {
  console.log('[Indexer] Starting indexing for specific URLs...');
  for (const url of urls) {
    console.log(`[Indexer] Sending notification for: ${url}`);
    try {
      const result = await notifyGoogleIndexing(url, 'URL_UPDATED');
      console.log(`[Indexer] Processed: ${url}`);
    } catch (err) {
      console.error(`[Indexer] Failed for ${url}:`, err.message);
    }
  }
  console.log('[Indexer] Indexing finished.');
}

run();
