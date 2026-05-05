const fetch = require('node-fetch');

async function test() {
  try {
    const res = await fetch('http://localhost:5000/api/products');
    const json = await res.json();
    console.log('API Response:', JSON.stringify(json, null, 2));
  } catch (err) {
    console.error('Fetch failed:', err.message);
  }
}

test();
