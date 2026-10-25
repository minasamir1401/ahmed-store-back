const fs = require('node:fs/promises');
const sharp = require('sharp');
const { normalizeCatalogImage } = require('../src/utils/catalogImageFormat');

// --normalize tests the actual processing function locally; it does not deploy
// or alter the remote images. Without it, test the published image responses.
const args = process.argv.slice(2);
const normalize = args.includes('--normalize');
const report = args.find(value => value.startsWith('--report='))?.slice(9) || 'catalog-image-audit.json';
const base = args.find(value => value.startsWith('--base='))?.slice(7) || 'https://the-vitahub.com';

async function run() {
  const feed = await fetch(`${base}/facebook-feed.xml`, { signal: AbortSignal.timeout(30000) });
  if (!feed.ok) throw new Error(`Feed HTTP ${feed.status}`);
  const xml = await feed.text();
  const urls = [...new Set([...xml.matchAll(/<g:(image_link|additional_image_link)>(.*?)<\/g:\1>/g)].map(match => match[2].replaceAll('&amp;', '&')))];
  const results = [];
  let next = 0;
  async function worker() {
    while (next < urls.length) {
      const url = urls[next++];
      let result;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await fetch(url, {
            headers: { Origin: 'https://business.facebook.com', Referer: 'https://business.facebook.com/', 'User-Agent': 'facebookexternalhit/1.1' },
            signal: AbortSignal.timeout(20000),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const source = Buffer.from(await response.arrayBuffer());
          const original = await sharp(source).metadata();
          const output = normalize ? await normalizeCatalogImage(source) : source;
          const metadata = await sharp(output).metadata();
          const stats = await sharp(output).stats();
          const origin = response.headers.get('access-control-allow-origin');
          if (!['*', 'https://business.facebook.com'].includes(origin)) throw new Error('Meta origin is not allowed by CORS');
          if (metadata.format !== 'jpeg' || metadata.width !== 1024 || metadata.height !== 1024 || metadata.channels !== 3 || metadata.space !== 'srgb') throw new Error(`Unexpected output: ${metadata.format} ${metadata.width}x${metadata.height} ${metadata.space}`);
          if (output.length >= 8 * 1024 * 1024) throw new Error('Image exceeds 8 MB');
          if (stats.channels.every(channel => channel.stdev < 0.5)) throw new Error('Blank image');
          result = { url, ok: true, originalWidth: original.width, originalHeight: original.height, width: metadata.width, height: metadata.height, bytes: output.length, origin };
          break;
        } catch (error) {
          result = { url, ok: false, error: error.message };
        }
      }
      results.push(result);
      if (results.length % 50 === 0) console.log(`Checked ${results.length}/${urls.length}`);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  const summary = {
    date: new Date().toISOString(), mode: normalize ? 'local-processing-of-published-images' : 'published-images',
    total: results.length, passed: results.filter(result => result.ok).length,
    failed: results.filter(result => !result.ok).length,
    originalBelow500: results.filter(result => result.originalWidth < 500 || result.originalHeight < 500).length,
  };
  await fs.writeFile(report, JSON.stringify({ summary, results }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(results.filter(result => !result.ok).slice(0, 10), null, 2));
  process.exitCode = summary.failed ? 1 : 0;
}

run().catch(error => { console.error(error); process.exitCode = 1; });
