require('dotenv').config();
const apiKey = process.env.OPENROUTER_API_KEY || '';

async function test() {
  console.log('Testing with key:', apiKey.slice(0, 15) + '...');
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        max_tokens: 1000,
        messages: [{ role: "user", content: "Say hello!" }]
      })
    });

    console.log("Status:", response.status);
    const data = await response.json();
    console.log("Response:", JSON.stringify(data));
  } catch (err) {
    console.error("Error:", err.message);
  }
}

test();
