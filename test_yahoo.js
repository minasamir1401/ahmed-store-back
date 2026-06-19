async function searchYahooImages(query) {
  console.log(`Searching Yahoo Images for: "${query}"...`);
  try {
    const url = `https://images.search.yahoo.com/search/images?p=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    const html = await response.text();
    // Yahoo image search results are usually in data-src or inside script tags or img src
    // Let's find all occurrences of "murl":"http..." which is Yahoo's way of storing metadata (media url)
    const matches = [];
    const regex = /"murl":"(https?:\/\/[^"]+)"/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      if (match[1]) {
        // Clean URL escapes
        const cleanUrl = match[1].replace(/\\/g, '');
        matches.push(cleanUrl);
      }
    }

    console.log(`Found ${matches.length} images.`);
    return matches.slice(0, 10);
  } catch (error) {
    console.error("Yahoo Search Error:", error);
    return [];
  }
}

async function run() {
  const images = await searchYahooImages("Optimum Nutrition Gold Standard 100% Whey Double Rich Chocolate 5 lbs");
  console.log("Image URLs:\n", images);

  console.log("\nVerifying URLs...");
  for (const img of images) {
    try {
      const check = await fetch(img, { method: 'HEAD', timeout: 3000 });
      console.log(`- ${check.status} ${check.ok ? "OK" : "FAILED"} - ${img}`);
    } catch (e) {
      console.log(`- Error: ${e.message} - ${img}`);
    }
  }
}

run();
