require('dotenv').config();
const geminiKey = process.env.GEMINI_API_KEY || '';
console.log('Using Gemini Key:', geminiKey ? 'Present (ends with ' + geminiKey.slice(-5) + ')' : 'MISSING');

const name = "Optimum Nutrition";

const prompt = `Search the web and find the official website domain of the dietary supplement, health, or vitamin brand named "${name}". Only return the domain name (e.g., brand.com or company.co.uk). Do not include "www", protocols (http/https), slashes, markdown, or any other text. If not found, return "notfound".`;

const geminiPayload = {
  contents: [
    {
      role: 'user',
      parts: [{ text: prompt }]
    }
  ],
  tools: [
    {
      google_search: {} // Enable search grounding to get real domain
    }
  ]
};

async function test() {
  console.log('Sending request to Gemini API...');
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(geminiPayload)
    });

    console.log('Response Status:', response.status);
    const text = await response.text();
    console.log('Raw Response Length:', text.length);
    console.log('Raw Response:', text);
    
    if (response.ok) {
      const data = JSON.parse(text);
      const parts = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      console.log('Parsed text:', parts);
      const domain = parts.trim().toLowerCase().replace(/[^a-z0-9.\-]/g, '');
      console.log('Processed domain:', domain);
    }
  } catch (error) {
    console.error('Fetch error:', error);
  }
}

test();
