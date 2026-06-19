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

// Rotating list of free models — fastest/most reliable first.
// When one model is rate-limited the script automatically tries the next one.
const FREE_MODELS = [
  'openai/gpt-oss-120b:free',
  'openai/gpt-oss-20b:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen3-coder:free'
];

// Tracks which model index to use next (module-level so it persists across products)
let currentModelIndex = 0;

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

  const prompt = `أنت خبير محتوى محترف وعالم صيدلة سريرية متخصص في المكملات والمنتجات الصحية في مصر.
مهمتك هي كتابة محتوى متكامل، غني وعالي الجودة، ومتوافق تماماً مع محركات البحث (SEO) باللغتين العربية والإنجليزية لمنتج مكمل غذائي.
- اسم المنتج: ${product.title}
- الماركة: ${brandName}
- القسم: ${categoryName}

يجب عليك إرجاع كائن JSON فقط بدون أي نصوص خارجية أو تنسيق Markdown وبدقة علمية تامة. يجب أن يحتوي كائن JSON على الهيكل التالي تماماً:
{
  "desc": "وصف تفصيلي كامل ومقنع باللغة العربية يتجاوز 100 كلمة، يشرح الفوائد والمكونات ودواعي الاستخدام وكيف يساعد العميل، مع دمج الكلمات المفتاحية بشكل طبيعي ولماذا الشراء من The VitaHub هو الأفضل.",
  "descEn": "Detailed professional description in English exceeding 100 words naturally integrating SEO keywords.",
  "usage": "طريقة الاستخدام والجرعات الموصى بها بالتفصيل باللغة العربية.",
  "usageEn": "Detailed usage and dosage instructions in English.",
  "ingredients": "المكونات بالتفصيل باللغة العربية.",
  "ingredientsEn": "Detailed ingredients list in English.",
  "warnings": "المحاذير الطبية وموانع الاستعمال باللغة العربية.",
  "warningsEn": "Medical warnings and precautions in English.",
  "seoKeywords": "سلسلة من الكلمات المفتاحية باللغة العربية مفصولة بفواصل (من 10 إلى 15 كلمة مفتاحية).",
  "seoKeywordsEn": "A comma-separated string of 10-15 highly relevant English search keywords.",
  "seoDesc": "وصف ميتا للبحث بالعربية مقنع وجذاب ويشجع على الشراء (حد أقصى 155 حرفاً).",
  "seoDescEn": "A brief, compelling Meta Description in English for SEO (max 155 characters).",
  "faqs": [
    {
      "question_ar": "سؤال شائع 1 بالعربية؟",
      "answer_ar": "إجابة احترافية 1 بالعربية.",
      "question_en": "Question 1 in English?",
      "answer_en": "Professional answer 1 in English."
    },
    {
      "question_ar": "سؤال شائع 2 بالعربية؟",
      "answer_ar": "إجابة احترافية 2 بالعربية.",
      "question_en": "Question 2 in English?",
      "answer_en": "Professional answer 2 in English."
    },
    {
      "question_ar": "سؤال شائع 3 بالعربية؟",
      "answer_ar": "إجابة احترافية 3 بالعربية.",
      "question_en": "Question 3 in English?",
      "answer_en": "Professional answer 3 in English."
    }
  ]
}

تأكد من أن الوصف العربي يتجاوز 100 كلمة، وأن الوصف الإنجليزي يتجاوز 100 كلمة. اتبع المعايير العلمية والطبية الدقيقة. أرجع كائن JSON فقط.`;

  let attempts = 0;
  const maxAttempts = FREE_MODELS.length * 3; // Try each model up to 3 times

  while (attempts < maxAttempts) {
    attempts++;
    const modelName = FREE_MODELS[currentModelIndex];
    console.log(`  🔄 Using model: ${modelName} (attempt ${attempts}/${maxAttempts})`);

    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://the-vitahub.com',
        'X-Title': 'The VitaHub SEO Updater'
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 1200,
        response_format: { type: 'json_object' }
      })
    });

    if (response.status === 429) {
      const errorText = await response.text();
      console.warn(`⚠️ Model "${modelName}" is rate-limited (429). Switching to next model...`);
      
      // Rotate to next model immediately — no long wait needed
      currentModelIndex = (currentModelIndex + 1) % FREE_MODELS.length;
      
      // If we've cycled through all models, wait before trying again
      if (currentModelIndex === 0) {
        console.log('  ⏳ All models rate-limited. Waiting 30s before retrying...');
        await delay(30000);
      } else {
        // Small pause between model switches (5s)
        await delay(5000);
      }
      continue;
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`⚠️ Model "${modelName}" returned error ${response.status}. Switching to next model...`);
      currentModelIndex = (currentModelIndex + 1) % FREE_MODELS.length;
      await delay(3000);
      continue;
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) {
      console.warn(`⚠️ Model "${modelName}" returned empty response. Switching to next model...`);
      currentModelIndex = (currentModelIndex + 1) % FREE_MODELS.length;
      await delay(3000);
      continue;
    }

    // Success! Keep using this model for the next product (it's working)
    console.log(`  ✅ Got response from "${modelName}"`);
    return parseJsonResponse(rawContent);
  }

  throw new Error(`Failed to generate SEO after ${maxAttempts} attempts across all models.`);
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

        // Wait 1.5 seconds between products
        await delay(1500);
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
