require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('❌ Error: OPENROUTER_API_KEY is not defined in your .env file.');
  process.exit(1);
}

// OpenRouter configuration
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL_NAME = 'google/gemini-2.5-flash:free'; // Highly capable, fast, and completely free model for structured JSON outputs

// Helper delay function to stay within API rate limits
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to clean Markdown JSON code blocks from the API response
const parseJsonResponse = (text) => {
  try {
    const cleaned = text
      .trim()
      .replace(/^```json/i, '')
      .replace(/^```/, '')
      .replace(/```$/, '')
      .trim();
    return JSON.parse(cleaned);
  } catch (err) {
    throw new Error('Response is not valid JSON: ' + err.message + '\nRaw text: ' + text);
  }
};

async function generateSeoForProduct(product) {
  const brandName = product.brand?.name || 'The VitaHub';
  const categoryName = product.category?.name || 'فيتامينات ومكملات';

  console.log(`\n🤖 Calling OpenRouter to generate SEO for: "${product.title}" (${brandName})...`);

  const prompt = `You are an expert SEO copywriter and clinical pharmacist specialized in health, nutrition, fitness, and dietary supplements in Egypt.
Your task is to generate complete, high-quality, professional, and detailed bilingual (Arabic and English) content for the following product:
- Product Title: ${product.title}
- Brand: ${brandName}
- Category: ${categoryName}

You MUST return a valid JSON object ONLY. Do not include any conversational explanation, markdown styling outside the json block, or formatting. The JSON object must have exactly the following structure:
{
  "desc": "A detailed Arabic description of the product. It must be scientifically accurate, highly engaging for customers, and exceed 250 words. It must naturally integrate relevant SEO keywords like 'مكملات غذائية', 'فيتامينات', and product-specific terms. Discuss the product purpose, benefits, why to buy it, and why The VitaHub is the best seller.",
  "descEn": "A detailed English description of the product. It must exceed 250 words and naturally integrate SEO keywords like 'dietary supplements', 'vitamins', and product-specific terms. Discuss product purpose, benefits, and quality.",
  "usage": "Clear, detailed step-by-step instructions in Arabic on how to use the product, recommended daily dosage, and best time of day to consume.",
  "usageEn": "Clear, detailed step-by-step instructions in English on how to use the product, recommended daily dosage, and best time of day.",
  "ingredients": "A complete list of active and inactive ingredients in Arabic (e.g. المكونات النشطة والمكونات الأخرى).",
  "ingredientsEn": "A complete list of active and inactive ingredients in English.",
  "warnings": "Important medical warnings, side effects, precautions, and contraindications in Arabic (e.g., consult doctor if pregnant, keep out of reach of children).",
  "warningsEn": "Important medical warnings, side effects, precautions, and contraindications in English.",
  "seoKeywords": "A comma-separated string of 10-15 highly relevant Arabic search keywords (e.g., مكملات غذائية, فيتامينات, أوميجا 3, ...).",
  "seoKeywordsEn": "A comma-separated string of 10-15 highly relevant English search keywords (e.g., dietary supplements, vitamins, omega 3, ...).",
  "seoDesc": "A brief, compelling Meta Description in Arabic for SEO (max 155 characters) summarizing the product and urging users to buy.",
  "seoDescEn": "A brief, compelling Meta Description in English for SEO (max 155 characters) summarizing the product.",
  "faqs": [
    {
      "question_ar": "Frequently asked question 1 in Arabic?",
      "answer_ar": "Detailed professional answer in Arabic.",
      "question_en": "Frequently asked question 1 in English?",
      "answer_en": "Detailed professional answer in English."
    },
    {
      "question_ar": "Frequently asked question 2 in Arabic?",
      "answer_ar": "Detailed professional answer in Arabic.",
      "question_en": "Frequently asked question 2 in English?",
      "answer_en": "Detailed professional answer in English."
    },
    {
      "question_ar": "Frequently asked question 3 in Arabic?",
      "answer_ar": "Detailed professional answer in Arabic.",
      "question_en": "Frequently asked question 3 in English?",
      "answer_en": "Detailed professional answer in English."
    }
  ]
}

Ensure the Arabic description is over 250 words long, and the English description is over 250 words long. Follow professional scientific guidelines. Return the JSON object.`;

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://the-vitahub.com',
      'X-Title': 'The VitaHub SEO Updater'
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API responded with status ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const rawContent = data.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error('OpenRouter returned an empty response choices array.');
  }

  return parseJsonResponse(rawContent);
}

async function main() {
  console.log('🏁 Starting SEO update process for existing products...');

  try {
    // 1. Fetch products needing updates
    // By default, this updates products that have a description of less than 200 characters
    // You can modify this filter to update all products if needed
    const products = await prisma.product.findMany({
      include: {
        brand: true,
        category: true
      }
    });

    console.log(`📦 Found ${products.length} products to process.`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      console.log(`\n========================================`);
      console.log(`[${i + 1}/${products.length}] Processing Product ID: ${product.id}`);
      console.log(`Title: ${product.title}`);

      // Optional: Skip if it already looks like it has a long description, unless forced
      const isAlreadyDetailed = product.desc && product.desc.length > 500 && product.faqs;
      if (isAlreadyDetailed && process.argv.includes('--only-missing')) {
        console.log(`⏭️ Product already has detailed description and FAQs. Skipping...`);
        continue;
      }

      try {
        const seoData = await generateSeoForProduct(product);

        // Save generated SEO content to the database
        await prisma.product.update({
          where: { id: product.id },
          data: {
            desc: seoData.desc,
            descEn: seoData.descEn,
            usage: seoData.usage,
            usageEn: seoData.usageEn,
            ingredients: seoData.ingredients,
            ingredientsEn: seoData.ingredientsEn,
            warnings: seoData.warnings,
            warningsEn: seoData.warningsEn,
            seoKeywords: seoData.seoKeywords,
            seoKeywordsEn: seoData.seoKeywordsEn,
            seoDesc: seoData.seoDesc,
            seoDescEn: seoData.seoDescEn,
            faqs: typeof seoData.faqs === 'object' ? JSON.stringify(seoData.faqs) : seoData.faqs
          }
        });

        console.log(`✅ Successfully updated product SEO inside database!`);
        successCount++;

        // Wait 2 seconds between requests to avoid rate limits
        await delay(2000);
      } catch (err) {
        console.error(`❌ Failed to update product ${product.id}:`, err.message);
        failCount++;
        // Wait 5 seconds before retrying next product
        await delay(5000);
      }
    }

    console.log(`\n🎉 Process complete.`);
    console.log(`✅ Successfully updated: ${successCount} products`);
    console.log(`❌ Failed: ${failCount} products`);

  } catch (error) {
    console.error('Fatal error running SEO update script:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
