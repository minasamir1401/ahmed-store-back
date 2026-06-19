require('dotenv').config();
const apiKey = process.env.OPENROUTER_API_KEY || '';

const models = [
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash:free",
  "meta-llama/llama-3.1-8b-instruct:free",
  "google/gemma-2-9b-it",
  "meta-llama/llama-3.1-8b-instruct"
];

async function testModel(model) {
  console.log(`Trying ${model}...`);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: "user", content: `Return ONLY the official website domain for brand "Optimum Nutrition" (e.g. brand.com). Do not include markdown or other text.` }]
      })
    });

    console.log(`- ${model} Status:`, response.status);
    const data = await response.json();
    if (response.ok) {
      console.log(`- ${model} Result:`, data.choices?.[0]?.message?.content);
      return true;
    } else {
      console.log(`- ${model} Error:`, JSON.stringify(data.error));
      return false;
    }
  } catch (error) {
    console.error(`- ${model} Fetch error:`, error.message);
    return false;
  }
}

async function run() {
  for (const m of models) {
    const success = await testModel(m);
    if (success) {
      console.log(`Model ${m} worked!`);
    }
    console.log('---');
  }
}

run();
