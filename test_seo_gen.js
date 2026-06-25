require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Replicate OR_FREE_MODELS and parseAIJSON from index.js
const OR_FREE_MODELS = [
  'openai/gpt-oss-120b:free',
  'openai/gpt-oss-20b:free',
  'google/gemini-2.5-flash',
  'meta-llama/llama-3.1-8b-instruct'
];
let orModelIndex = 0;

function parseAIJSON(str) {
  if (typeof str !== 'string') return {};
  let cleaned = str.trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) cleaned = match[0];
  cleaned = cleaned.replace(/\\(?!["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\');

  let insideQuote = false;
  let result = '';
  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    const isEscaped = i > 0 && cleaned[i - 1] === '\\' && (i < 2 || cleaned[i - 2] !== '\\');

    if (char === '"' && !isEscaped) {
      insideQuote = !insideQuote;
      result += char;
    } else if (insideQuote) {
      if (char === '\n') result += '\\n';
      else if (char === '\r') result += '\\r';
      else if (char === '\t') result += '\\t';
      else result += char;
    } else {
      result += char;
    }
  }

  return JSON.parse(result);
}

async function test() {
  try {
    const product = {
      title: 'Now Foods Magnesium Citrate 200 mg 250 Tablets',
      brand: { name: 'Now Foods' },
      category: { name: 'فيتامينات ومعادن' }
    };

    console.log(`Using product: ${product.title}`);
    const brandName = product.brand?.name || 'The VitaHub';
    const categoryName = product.category?.name || 'فيتامينات ومكملات';
    const apiKey = process.env.OPENROUTER_API_KEY;

    const prompt = `أنت خبير محتوى محترف وعالم صيدلة سريرية متخصص في المكملات والمنتجات الصحية في مصر.
مهمتك هي كتابة محتوى متكامل، غني وعالي الجودة، ومتوافق تماماً مع محركات البحث (SEO) باللغة العربية لمنتج مكمل غذائي.
- اسم المنتج: ${product.title}
- الماركة: ${brandName}
- القسم: ${categoryName}

يجب عليك إرجاع كائن JSON فقط بدون أي نصوص خارجية أو تنسيق Markdown وبدقة علمية تامة. يجب أن يحتوي كائن JSON على الهيكل التالي تماماً:
{
  "desc": "وصف تفصيلي كامل ومقنع باللغة العربية يتجاوز 350 كلمة، يشرح الفوائد والمكونات ودواعي الاستخدام وكيف يساعد العميل بالتفصيل، مع دمج الكلمات المفتاحية بشكل طبيعي ولماذا الشراء من The VitaHub هو الأفضل.",
  "descEn": "Detailed professional description in English exceeding 350 words naturally integrating SEO keywords.",
  "usage": "طريقة الاستخدام والجرعات الموصى بها بالتفصيل باللغة العربية.",
  "usageEn": "Detailed usage and dosage instructions in English.",
  "ingredients": "المكونات بالتفصيل باللغة العربية.",
  "ingredientsEn": "Detailed ingredients list in English.",
  "warnings": "المحاذير الطبية وموانع الاستعمال باللغة العربية.",
  "warningsEn": "Medical warnings and precautions in English.",
  "seoKeywords": "قائمة ضخمة ومكثفة تتكون من 300 كلمة أو عبارة بحث مفتاحية متنوعة وقوية باللغة العربية مفصولة بفواصل، لتغطية كافة عمليات البحث الممكنة.",
  "seoKeywordsEn": "An extensive list of 300 highly relevant English search keywords separated by commas.",
  "seoDesc": "وصف ميتا للبحث بالعربية مقنع وجذاب ويشجع على الشراء (حد أقصى 155 حرفاً).",
  "seoDescEn": "A brief, compelling Meta Description in English for SEO (max 155 characters).",
  "faqs": [
    {
      "question_ar": "سؤال شائع 1 بالعربية؟",
      "answer_ar": "إجابة احترافية 1 بالعربية.",
      "question_en": "Question 1 in English?",
      "answer_en": "Professional answer 1 in English."
    }
  ]
}`;

    const modelName = OR_FREE_MODELS[orModelIndex];
    console.log(`Requesting OpenRouter model: ${modelName}...`);

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://the-vitahub.com',
        'X-Title': 'The VitaHub Auto SEO'
      },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 4000,
        response_format: { type: 'json_object' }
      })
    });

    console.log('Status:', response.status);
    const data = await response.json();
    if (!response.ok) {
      console.error('Error payload:', JSON.stringify(data));
      return;
    }

    const rawContent = data.choices?.[0]?.message?.content;
    console.log('Raw output length:', rawContent?.length);
    console.log('Raw output snippet:', rawContent?.substring(0, 300));
    console.log('Raw output end snippet:', rawContent?.substring(rawContent.length - 200));

    try {
      const parsed = parseAIJSON(rawContent);
      console.log('Success! Parsed JSON keys:', Object.keys(parsed));
      console.log('Number of Arabic keywords generated:', parsed.seoKeywords?.split(/[،,]/).length);
    } catch (e) {
      console.error('Parsing failed:', e.message);
    }

  } catch (err) {
    console.error('Test failed:', err.message);
  } finally {
    prisma.$disconnect();
  }
}

test();
