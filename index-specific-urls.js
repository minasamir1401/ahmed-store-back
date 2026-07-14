const { notifyGoogleIndexing } = require('./src/services/googleIndexingService');
require('dotenv').config();

const urls = [
  'https://the-vitahub.com/',
  'https://the-vitahub.com/products',
  'https://the-vitahub.com/categories',
  'https://the-vitahub.com/offers',
  'https://the-vitahub.com/brands',
  'https://the-vitahub.com/health-tips',
  'https://the-vitahub.com/bmi-calculator',
  'https://the-vitahub.com/about',
  'https://the-vitahub.com/faq',
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
