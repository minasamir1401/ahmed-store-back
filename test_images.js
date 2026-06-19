require('dotenv').config();
const apiKey = process.env.OPENROUTER_API_KEY || '';

const title = "Optimum Nutrition Gold Standard 100% Whey Double Rich Chocolate 5 lbs";

const prompt = `You are an expert product image locator.
Find high-quality direct image URLs (jpg/png) for the product: "${title}".
We need:
1. A front image of the product (clean, white background, no store logo or watermark).
2. A back image of the product (showing the supplement facts, ingredients, or nutrition label).
3. Additional product images if available.

Suggest real, valid, direct image URLs from reputable sources like:
- iHerb (e.g., https://images.images-iherb.com/images/products/large/...)
- Amazon (e.g., https://m.media-amazon.com/images/I/...)
- Bodybuilding.com
- Official brand website (e.g., optimum nutrition, now foods, etc.)

Return ONLY a JSON array of objects with the following fields:
- url: The direct image URL.
- type: Either "front", "back", or "other".
- source: The name of the website/source (e.g., "iHerb", "Amazon", etc.).

Do not include markdown code block syntax (like \`\`\`json), just return raw JSON text. If you cannot find real URLs, try to construct likely valid URLs based on standard patterns or return an empty array [].`;

async function run() {
  console.log("Calling OpenRouter...");
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1000
      })
    });

    console.log("Status:", response.status);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    console.log("Raw Response:\n", content);

    // Try parsing
    try {
      const parsed = JSON.parse(content.replace(/```json/g, '').replace(/```/g, '').trim());
      console.log("Parsed JSON:\n", parsed);

      // Verify URLs
      console.log("\nVerifying URLs...");
      for (const item of parsed) {
        try {
          const check = await fetch(item.url, { method: 'HEAD', timeout: 3000 });
          console.log(`- ${item.type} (${item.source}): ${check.status} ${check.ok ? "OK" : "FAILED"} - ${item.url}`);
        } catch (e) {
          console.log(`- ${item.type} (${item.source}): Error - ${e.message} - ${item.url}`);
        }
      }
    } catch (err) {
      console.error("Failed to parse JSON:", err.message);
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

run();
