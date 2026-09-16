const XLSX = require('xlsx');

function normalizeHeader(str) {
  if (!str) return '';
  return str
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s_\-\.\(\)\[\]\%\:\/\\&+,]+/g, '');
}

function parseExpiryDate(val) {
  if (!val) return null;
  if (typeof val === 'number') {
    const parsed = XLSX.SSF.parse_date_code(val);
    if (parsed && parsed.y && parsed.m) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}`;
    }
  }

  let s = String(val).trim();
  if (!s) return null;

  s = s.replace(/8202(\d)/g, '202$1');

  // YYYY-MM or YYYY/MM
  let m = s.match(/^(\d{4})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}`;

  // MM-YYYY or MM/YYYY
  m = s.match(/^(\d{1,2})[-/](\d{4})/);
  if (m) return `${m[2]}-${String(m[1]).padStart(2, '0')}`;

  // MM/YY or MM-YY
  m = s.match(/^(\d{1,2})[-/](\d{2})$/);
  if (m) return `20${m[2]}-${String(m[1]).padStart(2, '0')}`;

  return s;
}

function parseNumber(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  const cleaned = String(val).replace(/[^0-9.-]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function cleanBrandName(name) {
  if (!name) return 'Other';
  const cleaned = name
    .toString()
    .trim()
    .replace(/\s*\.?brands?\s*$/i, '')
    .trim();
  return cleaned || 'Other';
}

function cleanImageUrl(url) {
  if (!url) return null;
  let s = String(url).trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^\/\//.test(s)) return `https:${s}`;
  if (/^www\./i.test(s)) return `https://${s}`;
  if (s.startsWith('/')) return s;
  if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\//.test(s)) {
    return `https://${s}`;
  }
  return null;
}


function detectCategory(titleAr = '', titleEn = '', desc = '') {
  const text = `${titleAr} ${titleEn} ${desc}`.toLowerCase();

  if (/omega|أوميجا|fish oil|زيت سمك|dha|epa|cod liver|krill/.test(text)) return 'مكملات الأوميجا';
  if (/collagen|كولاجين|biotin|بيوتين|بشرة|شعر|hair|skin|أظافر|bepanthene|bamboo silica/.test(text)) return 'البشرة والشعر';
  if (/glucosamine|chondroitin|msm|جلوكوزامين|كوندرويتين|مفاصل|عظام|غضاريف|joint|bone|calcium|مغنيسيوم|magnesium|ox bile/.test(text)) return 'عظام ومفاصل';
  if (/ashwagandha|أشواغاندا|berberine|بربرين|milk thistle|curcumin|كركم|مستخلص|عشبي|herbal|rhodiola|mastic gum|matcha|saffron|زعفران|boswellia|بوسويليا|bitter melon|valeryan|فاليريان|dgl|quercetin/.test(text)) return 'مكملات عشبية';
  if (/weight loss|leanfire|fat burner|تخسيس|حرق دهون|رشاقة|diet/.test(text)) return 'التخسيس واللياقة';
  if (/amino|arginine|citrulline|carnitine|ornithine|أحماض أمينية|أرجينين|alpha gpc|ألفا جي بي سي|5-htp/.test(text)) return 'أحماض أمينية';
  if (/multivitamin|فيتامينات متعددة|مالتي فيتامين|centrum|women|men|daily|adam/.test(text)) return 'فيتامينات متعددة';
  if (/liv-52|ليف-52|chlorophyll|كلوروفيل|probiotic|بروبيوتيك|detox|كبد|صحة عامة|manuka|عسل مانوكا|spirulina|سبيرولينا|pumpkin seed|بذور اليقطين|sea moss|طحلب/.test(text)) return 'الصحة العامة';

  return 'فيتامينات ومعادن';
}

function extractSizes(title = '') {
  if (!title) return null;
  const m = title.match(/(\d+\s*(?:tab|tablets|soft|softgels|cap|capsules|veg|veggie caps|gm|g|ml|oz|amp))\b/i);
  return m ? m[1].trim() : null;
}

function parseFaqs(faqsAr = '', faqsEn = '') {
  if (!faqsAr && !faqsEn) return null;
  const arLines = (faqsAr || '').split('\n').map(l => l.trim()).filter(Boolean);
  const enLines = (faqsEn || '').split('\n').map(l => l.trim()).filter(Boolean);

  const faqs = [];
  const count = Math.max(arLines.length, enLines.length);

  for (let i = 0; i < count; i++) {
    const arLine = arLines[i] || '';
    const enLine = enLines[i] || '';

    let qAr = '', aAr = '';
    const arMatch = arLine.match(/س[:\s]+(.*?)(?:ج[:\s]+(.*)|$)/);
    if (arMatch) {
      qAr = (arMatch[1] || '').trim();
      aAr = (arMatch[2] || '').trim();
    } else {
      qAr = arLine;
    }

    let qEn = '', aEn = '';
    const enMatch = enLine.match(/Q[:\s]+(.*?)(?:A[:\s]+(.*)|$)/i);
    if (enMatch) {
      qEn = (enMatch[1] || '').trim();
      aEn = (enMatch[2] || '').trim();
    } else {
      qEn = enLine;
    }

    if (qAr || qEn) {
      faqs.push({
        question_ar: qAr,
        answer_ar: aAr,
        question_en: qEn,
        answer_en: aEn
      });
    }
  }

  return faqs.length > 0 ? JSON.stringify(faqs) : null;
}

function parseSizeOptions(sizesAr = '', sizesEn = '', fallbackPrice = null) {
  if (!sizesAr && !sizesEn) return null;

  const arLines = (sizesAr || '').split(/[\n;]+/).map(l => l.trim()).filter(Boolean);
  const enLines = (sizesEn || '').split(/[\n;]+/).map(l => l.trim()).filter(Boolean);
  const count = Math.max(arLines.length, enLines.length);
  const options = [];

  for (let i = 0; i < count; i++) {
    const arLine = arLines[i] || '';
    const enLine = enLines[i] || '';

    let price = null;
    const priceMatch = arLine.match(/(?:سعر|السعر الاختياري|السعر)[:\s]*([\d,]+(?:\.\d+)?)/i) ||
                       enLine.match(/(?:price|optional price)[:\s]*([\d,]+(?:\.\d+)?)/i);
    if (priceMatch) {
      price = parseFloat(priceMatch[1].replace(/,/g, ''));
    } else {
      price = fallbackPrice;
    }

    let sizeAr = arLine
      .replace(/(?:السعر الاختياري|السعر|سعر)[:\s]*[\d,]+(?:\.\d+)?\s*(?:جنيه مصري|جنيه|ج\.م|egp|le)?(?:\s*\(.*?\))?/gi, '')
      .replace(/الحجم المتاح[:\s]*/gi, '')
      .replace(/[\.\,\s\-]+$/, '')
      .trim();

    let sizeEn = enLine
      .replace(/(?:optional price|price)[:\s]*[\d,]+(?:\.\d+)?\s*(?:egp|le)?(?:\s*\(.*?\))?/gi, '')
      .replace(/available size[:\s]*/gi, '')
      .replace(/[\.\,\s\-]+$/, '')
      .trim();

    if (sizeAr || sizeEn) {
      options.push({
        size: sizeAr || sizeEn,
        sizeEn: sizeEn || sizeAr,
        price: price !== null && !isNaN(price) ? price : (fallbackPrice || 0)
      });
    }
  }

  return options.length > 0 ? JSON.stringify(options) : null;
}

function parseSupplementFacts(factsAr = '', factsEn = '', titleAr = '', titleEn = '') {
  if (!factsAr && !factsEn) return null;

  const arLines = (factsAr || '').split('\n').map(l => l.trim()).filter(Boolean);
  const enLines = (factsEn || '').split('\n').map(l => l.trim()).filter(Boolean);
  const rows = [];

  if (arLines.length > 1 || enLines.length > 1) {
    const count = Math.max(arLines.length, enLines.length);
    for (let i = 0; i < count; i++) {
      const arLine = arLines[i] || '';
      const enLine = enLines[i] || '';

      let nameAr = '', amountAr = '', dvAr = '';
      let nameEn = '', amountEn = '', dvEn = '';

      const matchAr = arLine.match(/عنصر[:\s]+(.*?)[،,]\s*القوة(?: والتركيز)?[:\s]+(.*?)[،,]\s*النسبة(?: اليومية)?[:\s]+(.*)/);
      if (matchAr) {
        nameAr = matchAr[1].trim();
        amountAr = matchAr[2].trim();
        dvAr = matchAr[3].trim();
      } else {
        const parts = arLine.split(/[:؛;-]/);
        nameAr = parts[0]?.trim() || arLine;
        amountAr = parts[1]?.trim() || '';
        dvAr = parts[2]?.trim() || '†';
      }

      const matchEn = enLine.match(/ingredient[:\s]+(.*?)[,]\s*strength[:\s]+(.*?)[,]\s*daily value[:\s]+(.*)/i);
      if (matchEn) {
        nameEn = matchEn[1].trim();
        amountEn = matchEn[2].trim();
        dvEn = matchEn[3].trim();
      } else {
        const parts = enLine.split(/[:;]/);
        nameEn = parts[0]?.trim() || enLine;
        amountEn = parts[1]?.trim() || '';
        dvEn = parts[2]?.trim() || '†';
      }

      rows.push({
        name: nameAr || nameEn,
        name_ar: nameAr || nameEn,
        name_en: nameEn || nameAr,
        amount: amountAr || amountEn,
        amount_ar: amountAr || amountEn,
        amount_en: amountEn || amountAr,
        dv: dvAr || dvEn || '†'
      });
    }
  } else {
    const arText = arLines[0] || '';
    const enText = enLines[0] || '';
    const strengthArMatch = arText.match(/المادة\/التركيز المذكور[:\s]*([^\.]+)/);
    const strengthEnMatch = enText.match(/Named ingredient\/strength[:\s]*([^\.]+)/i);
    const strength = (strengthArMatch ? strengthArMatch[1].trim() : '') ||
                     (strengthEnMatch ? strengthEnMatch[1].trim() : '');

    const activeNameAr = titleAr ? titleAr.replace(/[\d,]+\s*(?:ملغ|ملجم|كبسولة|قرص|وحدة|veg).*/i, '').trim() : 'المكون الفعال';
    const activeNameEn = titleEn ? titleEn.replace(/[\d,]+\s*(?:mg|veg|capsules|tablets|iu).*/i, '').trim() : 'Active Ingredient';

    rows.push({
      name: activeNameAr,
      name_ar: activeNameAr,
      name_en: activeNameEn,
      amount: strength || 'حسب الملصق',
      amount_ar: strength || 'حسب الملصق',
      amount_en: strength || 'As labeled',
      dv: '†'
    });
  }

  return rows.length > 0 ? JSON.stringify(rows) : null;
}

function buildKeyInfo(data) {
  const obj = {};
  if (data.servingSize) {
    obj.servingSize = data.servingSize;
    if (data.servingSizeEn) obj.servingSize_en = data.servingSizeEn;
  }
  if (data.servingsPerContainer) {
    obj.totalServings = data.servingsPerContainer;
    if (data.servingsPerContainerEn) obj.totalServings_en = data.servingsPerContainerEn;
  }
  if (data.countryOfOrigin) {
    obj.origin = data.countryOfOrigin;
    if (data.countryOfOriginEn) obj.origin_en = data.countryOfOriginEn;
  }
  if (data.packagingExpiry || data.expiryDate) {
    obj.bestBefore = data.packagingExpiry || data.expiryDate;
    obj.bestBefore_en = data.packagingExpiry || data.expiryDate;
  }
  if (data.rawKeyInfoAr) obj.rawKeyInfo_ar = data.rawKeyInfoAr;
  if (data.rawKeyInfoEn) obj.rawKeyInfo_en = data.rawKeyInfoEn;

  return Object.keys(obj).length > 0 ? JSON.stringify(obj) : null;
}

function parseDosageCalculator(titleAr, titleEn, gender, icon, choiceTitleAr, choiceTitleEn, goalsAr = '', goalsEn = '') {
  if (!goalsAr && !goalsEn && !titleAr) return null;

  let genderTarget = 'both';
  if (gender) {
    if (/كلاهما|both|all|الجميع/i.test(gender)) genderTarget = 'both';
    else if (/أنثى|إناث|female|women/i.test(gender)) genderTarget = 'female';
    else if (/ذكر|ذكور|male|men/i.test(gender)) genderTarget = 'male';
  }

  const allowedIcons = ['Activity', 'Sun', 'Droplet', 'Moon', 'Dumbbell', 'Sparkles', 'Flame'];
  const calcIcon = allowedIcons.includes(icon) ? icon : 'Activity';

  const arLines = (goalsAr || '').split('\n').map(l => l.trim()).filter(Boolean);
  const enLines = (goalsEn || '').split('\n').map(l => l.trim()).filter(Boolean);

  const rules = [];
  const maxRules = Math.max(arLines.length, enLines.length);

  for (let i = 0; i < maxRules; i++) {
    const arLine = arLines[i] || '';
    const enLine = enLines[i] || '';

    const arParts = arLine.split(':');
    const labelAr = arParts[0] ? arParts[0].trim() : `خيار ${i + 1}`;
    const recAr = arParts.slice(1).join(':').trim() || labelAr;

    const enParts = enLine.split(':');
    const labelEn = enParts[0] ? enParts[0].trim() : `Option ${i + 1}`;
    const recEn = enParts.slice(1).join(':').trim() || labelEn;

    let ruleIcon = calcIcon;
    const combined = `${labelAr} ${labelEn}`.toLowerCase();
    if (/نوم|sleep|استرخاء|relax/i.test(combined)) ruleIcon = 'Moon';
    else if (/طاقة|energy|حرق|burn/i.test(combined)) ruleIcon = 'Flame';
    else if (/تمرين|عضل|muscle|workout/i.test(combined)) ruleIcon = 'Dumbbell';
    else if (/ماء|ترطيب|hydration|water/i.test(combined)) ruleIcon = 'Droplet';
    else if (/شمس|sun|d3|مناعة|immunity/i.test(combined)) ruleIcon = 'Sun';
    else if (/دماغ|ذاكرة|تركيز|focus|memory|brain/i.test(combined)) ruleIcon = 'Sparkles';

    rules.push({
      value: `goal_${i}`,
      label: labelAr,
      label_ar: labelAr,
      label_en: labelEn,
      icon: ruleIcon,
      recommendation_ar: recAr,
      recommendation_en: recEn,
      maleDose: recAr,
      maleDose_ar: recAr,
      maleDose_en: recEn,
      maleCapsules: recAr,
      maleCapsules_ar: recAr,
      maleCapsules_en: recEn,
      maleTip: recAr,
      maleTip_ar: recAr,
      maleTip_en: recEn,
      femaleDose: recAr,
      femaleDose_ar: recAr,
      femaleDose_en: recEn,
      femaleCapsules: recAr,
      femaleCapsules_ar: recAr,
      femaleCapsules_en: recEn,
      femaleTip: recAr,
      femaleTip_ar: recAr,
      femaleTip_en: recEn
    });
  }

  return JSON.stringify({
    enabled: true,
    title: titleAr || 'حاسبة الاستخدام والجرعة الذكية',
    title_ar: titleAr || 'حاسبة الاستخدام والجرعة الذكية',
    title_en: titleEn || 'Smart Dosage & Usage Calculator',
    icon: calcIcon,
    genderTarget,
    optionsLabel: choiceTitleAr || 'الهدف الأساسي:',
    optionsLabel_ar: choiceTitleAr || 'الهدف الأساسي:',
    optionsLabel_en: choiceTitleEn || 'Main Goal:',
    choiceTitle_ar: choiceTitleAr || 'الهدف الأساسي:',
    choiceTitle_en: choiceTitleEn || 'Main Goal:',
    rules
  });
}

function buildSpecifications(specs) {
  const list = [];
  if (specs.sku) list.push({ label: 'رمز المنتج (SKU)', label_en: 'SKU Code', value: specs.sku, value_en: specs.sku, bold: true });
  if (specs.servingSize) list.push({ label: 'حجم الحصة اليومية', label_en: 'Daily Serving Size', value: specs.servingSize, value_en: specs.servingSizeEn || specs.servingSize });
  if (specs.servingsPerContainer) list.push({ label: 'عدد الحصص بالعبوة', label_en: 'Servings Per Container', value: specs.servingsPerContainer, value_en: specs.servingsPerContainerEn || specs.servingsPerContainer });
  if (specs.countryOfOrigin) list.push({ label: 'بلد المنشأ والاستيراد', label_en: 'Country of Origin & Import', value: specs.countryOfOrigin, value_en: specs.countryOfOriginEn || specs.countryOfOrigin });
  if (specs.packagingExpiry) list.push({ label: 'تاريخ تعبئة الصلاحية', label_en: 'Packaging Expiry', value: specs.packagingExpiry, value_en: specs.packagingExpiry });
  if (specs.upc) list.push({ label: 'الرمز الشريطي (UPC)', label_en: 'UPC Barcode', value: specs.upc, value_en: specs.upc });
  if (specs.dimensions && !String(specs.dimensions).includes('غير محدد')) {
    list.push({ label: 'أبعاد العبوة', label_en: 'Package Dimensions', value: specs.dimensions, value_en: specs.dimensionsEn || specs.dimensions });
  }

  return list.length > 0 ? JSON.stringify(list) : null;
}

function parseProductsFromWorkbook(filePath) {
  const wb = XLSX.readFile(filePath);
  const firstSheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[firstSheetName];

  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  if (!rawRows || rawRows.length === 0) {
    throw new Error('ملف Excel فارغ.');
  }

  const headerRow = rawRows[0] || [];
  const normalizedHeaders = headerRow.map(h => normalizeHeader(h));

  const isEnriched = normalizedHeaders.some(h =>
    h.includes('arabictitle') ||
    h.includes('englishtitle') ||
    h.includes('currentprice') ||
    h.includes('arabicdescription') ||
    h.includes('frontimageurl')
  );

  const isClassicBrandSheet = !isEnriched && rawRows.some(r => {
    const val = r[0] ? String(r[0]).trim() : '';
    return /brands?$/i.test(val);
  });

  if (isEnriched) {
    return parseEnrichedSheet(rawRows, normalizedHeaders);
  }

  if (isClassicBrandSheet) {
    return parseClassicBrandSheet(rawRows);
  }

  return parseGenericSheet(rawRows, normalizedHeaders);
}

function parseEnrichedSheet(rawRows, normalizedHeaders) {
  const fieldMap = {
    no: normalizedHeaders.findIndex(h => h === 'no' || h === 'num' || h === 'id'),
    company: normalizedHeaders.findIndex(h => h === 'company' || h === 'brand' || h === 'الشركة' || h === 'الماركة' || h === 'brandname'),
    titleEn: normalizedHeaders.findIndex(h => h === 'englishtitle' || h === 'titleen' || h === 'الاسمالانجليزي' || h === 'englishproductname' || h === 'productnameen' || h === 'nameen'),
    titleAr: normalizedHeaders.findIndex(h => h === 'arabictitle' || h === 'titlear' || h === 'الاسمعربي' || h === 'اسمالمنتج' || h === 'arabicproductname' || h === 'productnamear' || h === 'namear'),
    price: normalizedHeaders.findIndex(h => h === 'currentpriceegp' || h === 'currentprice' || h === 'price' || h === 'السعر' || h === 'priceegp'),
    expiry: normalizedHeaders.findIndex(h => h === 'expirydate' || h === 'expdate' || h === 'الصلاحية' || h === 'expiry'),
    oldPrice: normalizedHeaders.findIndex(h => h === 'oldprice' || h === 'السعرالقديم' || h === 'originalprice'),
    discountPercent: normalizedHeaders.findIndex(h => h === 'discount' || h === 'نسبةالخصم' || h === 'discountpercentage'),
    discountAmount: normalizedHeaders.findIndex(h => h === 'discountamountegp' || h === 'discountamount' || h === 'قيمةالخصم'),
    descAr: normalizedHeaders.findIndex(h => h === 'arabicdescription' || h === 'الوصفبالعربي' || h === 'الوصف' || h === 'descar' || h === 'descriptionar'),
    descEn: normalizedHeaders.findIndex(h => h === 'englishdescription' || h === 'الوصفبالانجليزي' || h === 'descen' || h === 'descriptionen'),
    featuresAr: normalizedHeaders.findIndex(h => h === 'arabicfeatures' || h === 'المميزاتبالعربي' || h === 'المميزات' || h === 'featuresar'),
    featuresEn: normalizedHeaders.findIndex(h => h === 'englishfeatures' || h === 'المميزاتبالانجليزي' || h === 'featuresen'),
    useAr: normalizedHeaders.findIndex(h => h === 'arabicuse' || h === 'طريقةالاستخدامبالعربي' || h === 'طريقةالاستخدام' || h === 'usear' || h === 'usagear' || h === 'directionsar'),
    useEn: normalizedHeaders.findIndex(h => h === 'englishuse' || h === 'طريقةالاستخدامبالانجليزي' || h === 'useen' || h === 'usageen' || h === 'suggesteduse' || h === 'directionsen'),
    warningsAr: normalizedHeaders.findIndex(h => h === 'arabicwarnings' || h === 'التحذيراتبالعربي' || h === 'التحذيرات' || h === 'warningsar'),
    warningsEn: normalizedHeaders.findIndex(h => h === 'englishwarnings' || h === 'التحذيراتبالانجليزي' || h === 'warningsen' || h === 'cautionsen'),
    keyInfoAr: normalizedHeaders.findIndex(h => h === 'arabickeyinfo' || h === 'معلوماتالمكونات' || h === 'keyinfoar'),
    keyInfoEn: normalizedHeaders.findIndex(h => h === 'englishkeyinfo' || h === 'keyinfoen'),
    seoContentAr: normalizedHeaders.findIndex(h => h === 'arabicseocontent' || h === 'seocontentar'),
    seoContentEn: normalizedHeaders.findIndex(h => h === 'englishseocontent' || h === 'seocontenten'),
    keywordsAr: normalizedHeaders.findIndex(h => h === 'arabickeywords' || h === 'كلماتمفتاحية' || h === 'keywordsar' || h === 'seokeywordsar'),
    keywordsEn: normalizedHeaders.findIndex(h => h === 'englishkeywords' || h === 'keywordsen' || h === 'seokeywordsen' || h === 'metakeywordsen'),
    metaDescAr: normalizedHeaders.findIndex(h => h === 'arabicmetadescription' || h === 'وصفالميتا' || h === 'metadescar' || h === 'seodescar'),
    metaDescEn: normalizedHeaders.findIndex(h => h === 'englishmetadescription' || h === 'metadescen' || h === 'seodescen'),
    frontImg: normalizedHeaders.findIndex(h => h === 'frontimageurl' || h === 'image' || h === 'imageurl' || h === 'الصورة' || h === 'imagefront'),
    frontAltAr: normalizedHeaders.findIndex(h => h === 'frontimagealtar' || h === 'imagealt'),
    frontAltEn: normalizedHeaders.findIndex(h => h === 'frontimagealten' || h === 'imagealten'),
    backImg: normalizedHeaders.findIndex(h => h === 'backimageurl' || h === 'imageback'),
    backAltAr: normalizedHeaders.findIndex(h => h === 'backimagealtar'),
    backAltEn: normalizedHeaders.findIndex(h => h === 'backimagealten'),
    category: normalizedHeaders.findIndex(h => h === 'category' || h === 'القسم' || h === 'التصنيف' || h === 'categoryname'),

    // Extended columns
    ingredientsAr: normalizedHeaders.findIndex(h => h === 'arabicingredients' || h === 'المكوناتبالعربي' || h === 'المكونات' || h === 'ingredientsar'),
    ingredientsEn: normalizedHeaders.findIndex(h => h === 'englishingredients' || h === 'المكوناتبالانجليزي' || h === 'ingredientsen'),
    cautionsAr: normalizedHeaders.findIndex(h => h === 'arabiclegalcautions' || h === 'تنبيهاتقانونية' || h === 'disclaimerar' || h === 'اخلاءمسؤولية'),
    cautionsEn: normalizedHeaders.findIndex(h => h === 'englishlegalcautions' || h === 'disclaimeren' || h === 'legalcautionsen'),
    faqsAr: normalizedHeaders.findIndex(h => h === 'arabicfaqs' || h === 'اسئلةشائعةبالعربي' || h === 'faqsar'),
    faqsEn: normalizedHeaders.findIndex(h => h === 'englishfaqs' || h === 'faqsen'),
    sizesOptionalAr: normalizedHeaders.findIndex(h => h === 'arabicsizesoptionalprices' || h === 'sizesoptionalpricesar'),
    sizesOptionalEn: normalizedHeaders.findIndex(h => h === 'englishsizesoptionalprices' || h === 'sizesoptionalpricesen'),
    supplementFactsAr: normalizedHeaders.findIndex(h => h === 'arabicsupplementfacts' || h === 'حقائقغذائيةبالعربي' || h === 'supplementfactsar'),
    supplementFactsEn: normalizedHeaders.findIndex(h => h === 'englishsupplementfacts' || h === 'supplementfactsen'),
    dailyServing: normalizedHeaders.findIndex(h => h === 'dailyservingsize' || h === 'حجمالحصةاليومية' || h === 'servingsize'),
    servingsPerContainer: normalizedHeaders.findIndex(h => h === 'servingspercontainer' || h === 'عددالحصصبالعبوة'),
    countryOfOrigin: normalizedHeaders.findIndex(h => h === 'countryoforiginimport' || h === 'بلدالمنشأ' || h === 'countryoforigin'),
    packagingExpiry: normalizedHeaders.findIndex(h => h === 'packagingexpiry'),
    sku: normalizedHeaders.findIndex(h => h === 'sku'),
    grossWeight: normalizedHeaders.findIndex(h => h === 'grossshippingweight' || h === 'وزنالشحن' || h === 'shippingweight'),
    upc: normalizedHeaders.findIndex(h => h === 'upc' || h === 'barcode'),
    dimensions: normalizedHeaders.findIndex(h => h === 'packagedimensions' || h === 'ابعادالعبوة' || h === 'dimensions'),
    certifications: normalizedHeaders.findIndex(h => h === 'qualitycertifications' || h === 'شهاداتالجودة' || h === 'certifications'),
    calcTitleAr: normalizedHeaders.findIndex(h => h === 'calculatortitlear'),
    calcTitleEn: normalizedHeaders.findIndex(h => h === 'calculatortitleen'),
    calcGender: normalizedHeaders.findIndex(h => h === 'targetgender' || h === 'calcgender'),
    calcIcon: normalizedHeaders.findIndex(h => h === 'calculatoricon' || h === 'calcicon'),
    calcChoiceTitleAr: normalizedHeaders.findIndex(h => h === 'choicefieldtitlear'),
    calcChoiceTitleEn: normalizedHeaders.findIndex(h => h === 'choicefieldtitleen'),
    calcGoalsAr: normalizedHeaders.findIndex(h => h === 'calculatorgoalssuggestedusear'),
    calcGoalsEn: normalizedHeaders.findIndex(h => h === 'calculatorgoalssuggesteduseen'),
    productSourcePage: normalizedHeaders.findIndex(h => h === 'productsourcepage' || h === 'sourceurl'),
    liveProductImageSearchUrl: normalizedHeaders.findIndex(h => h === 'liveproductimagesearchurl')
  };

  const products = [];

  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) continue;

    const getVal = (colIdx) => (colIdx >= 0 && row[colIdx] !== undefined && row[colIdx] !== null) ? String(row[colIdx]).trim() : '';

    const titleAr = getVal(fieldMap.titleAr);
    const titleEn = getVal(fieldMap.titleEn);
    const title = titleAr || titleEn;

    if (!title) continue;

    const price = parseNumber(row[fieldMap.price]);
    const oldPrice = parseNumber(row[fieldMap.oldPrice]);
    const discountPercent = parseNumber(row[fieldMap.discountPercent]);
    const discountAmount = parseNumber(row[fieldMap.discountAmount]);
    const expiryDate = parseExpiryDate(row[fieldMap.expiry]);

    let discountType = null;
    let discountValue = null;
    if (discountPercent && discountPercent > 0) {
      discountType = 'percentage';
      discountValue = discountPercent;
    } else if (discountAmount && discountAmount > 0) {
      discountType = 'fixed';
      discountValue = discountAmount;
    }

    const calculatedOldPrice = oldPrice || (discountAmount && price ? price + discountAmount : null) || (discountPercent && price ? Math.round(price / (1 - discountPercent / 100)) : null);

    const descAr = getVal(fieldMap.descAr);
    const descEn = getVal(fieldMap.descEn);
    const featuresAr = getVal(fieldMap.featuresAr);
    const featuresEn = getVal(fieldMap.featuresEn);
    const useAr = getVal(fieldMap.useAr);
    const useEn = getVal(fieldMap.useEn);
    const warningsAr = getVal(fieldMap.warningsAr);
    const warningsEn = getVal(fieldMap.warningsEn);

    const keyInfoObj = buildKeyInfo({
      servingSize: getVal(fieldMap.dailyServing),
      servingsPerContainer: getVal(fieldMap.servingsPerContainer),
      countryOfOrigin: getVal(fieldMap.countryOfOrigin),
      packagingExpiry: getVal(fieldMap.packagingExpiry),
      expiryDate,
      rawKeyInfoAr: getVal(fieldMap.keyInfoAr),
      rawKeyInfoEn: getVal(fieldMap.keyInfoEn)
    });

    const seoKeywordsAr = getVal(fieldMap.keywordsAr);
    const seoKeywordsEn = getVal(fieldMap.keywordsEn);
    const seoDescAr = getVal(fieldMap.metaDescAr) || getVal(fieldMap.seoContentAr);
    const seoDescEn = getVal(fieldMap.metaDescEn) || getVal(fieldMap.seoContentEn);

    const rawFrontImg = getVal(fieldMap.frontImg);
    const rawBackImg = getVal(fieldMap.backImg);
    const frontImg = cleanImageUrl(rawFrontImg);
    const backImg = cleanImageUrl(rawBackImg);
    const frontAltAr = getVal(fieldMap.frontAltAr) || getVal(fieldMap.frontAltEn);

    const rawCompany = getVal(fieldMap.company);
    const brand = cleanBrandName(rawCompany);

    const explicitCat = getVal(fieldMap.category);
    const category = explicitCat || detectCategory(titleAr, titleEn, descAr);

    // Extended fields
    const ingredientsAr = getVal(fieldMap.ingredientsAr);
    const ingredientsEn = getVal(fieldMap.ingredientsEn);
    const cautionsAr = getVal(fieldMap.cautionsAr);
    const cautionsEn = getVal(fieldMap.cautionsEn);
    const certifications = getVal(fieldMap.certifications);

    const faqs = parseFaqs(getVal(fieldMap.faqsAr), getVal(fieldMap.faqsEn));
    const sizeOptions = parseSizeOptions(
      getVal(fieldMap.sizesOptionalAr),
      getVal(fieldMap.sizesOptionalEn),
      price
    );
    const supplementFacts = parseSupplementFacts(
      getVal(fieldMap.supplementFactsAr),
      getVal(fieldMap.supplementFactsEn),
      titleAr,
      titleEn
    );
    const dosageCalculator = parseDosageCalculator(
      getVal(fieldMap.calcTitleAr),
      getVal(fieldMap.calcTitleEn),
      getVal(fieldMap.calcGender),
      getVal(fieldMap.calcIcon),
      getVal(fieldMap.calcChoiceTitleAr),
      getVal(fieldMap.calcChoiceTitleEn),
      getVal(fieldMap.calcGoalsAr),
      getVal(fieldMap.calcGoalsEn)
    );

    const specifications = buildSpecifications({
      sku: getVal(fieldMap.sku),
      servingSize: getVal(fieldMap.dailyServing),
      servingsPerContainer: getVal(fieldMap.servingsPerContainer),
      countryOfOrigin: getVal(fieldMap.countryOfOrigin),
      packagingExpiry: getVal(fieldMap.packagingExpiry),
      upc: getVal(fieldMap.upc),
      weight: getVal(fieldMap.grossWeight),
      dimensions: getVal(fieldMap.dimensions),
      productSourcePage: getVal(fieldMap.productSourcePage),
      liveProductImageSearch: getVal(fieldMap.liveProductImageSearchUrl)
    });

    products.push({
      title,
      titleEn: titleEn || null,
      brand,
      category,
      price: price !== null ? price : 0,
      oldPrice: calculatedOldPrice,
      discountType,
      discountValue,
      expiryDate,
      desc: descAr || null,
      descEn: descEn || null,
      features: featuresAr || null,
      featuresEn: featuresEn || null,
      usage: useAr || null,
      usageEn: useEn || null,
      warnings: warningsAr || null,
      warningsEn: warningsEn || null,
      ingredients: ingredientsAr || null,
      ingredientsEn: ingredientsEn || null,
      disclaimer: cautionsAr || null,
      disclaimerEn: cautionsEn || null,
      supplementFacts,
      specifications,
      certifications: certifications || null,
      dosageCalculator,
      faqs,
      keyInfo: keyInfoObj,
      sizeOptions,
      seoKeywords: seoKeywordsAr || null,
      seoKeywordsEn: seoKeywordsEn || null,
      seoDesc: seoDescAr || null,
      seoDescEn: seoDescEn || null,
      image: frontImg,
      backImage: backImg,
      imageAlt: frontAltAr || null,
      sizes: extractSizes(titleEn || titleAr)
    });
  }

  return products;
}

function parseClassicBrandSheet(rawRows) {
  const products = [];
  let currentBrand = 'Other';

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) continue;

    const colA = row[0] !== undefined && row[0] !== null ? String(row[0]).trim() : '';
    const colB = row[1] !== undefined && row[1] !== null ? String(row[1]).trim() : '';
    const colF = row[5] !== undefined && row[5] !== null ? row[5] : null;
    const colG = row[6] !== undefined && row[6] !== null ? row[6] : null;

    if (colA && !colB && colF === null && colG === null) {
      if (/diff?rent\.?brands?/i.test(colA)) {
        currentBrand = 'Other';
      } else {
        currentBrand = cleanBrandName(colA);
      }
      continue;
    }

    if (colB) {
      const title = colB;
      const price = parseNumber(colG);
      const expiryDate = parseExpiryDate(colF);

      let resolvedBrand = currentBrand;
      const commaIdx = title.indexOf(',');
      if (commaIdx !== -1) {
        const potentialBrand = title.slice(0, commaIdx).trim();
        if (potentialBrand.length < 25) {
          resolvedBrand = cleanBrandName(potentialBrand);
        }
      }

      products.push({
        title,
        titleEn: null,
        brand: resolvedBrand,
        category: detectCategory(title, '', ''),
        price: price !== null ? price : 0,
        oldPrice: null,
        discountType: null,
        discountValue: null,
        expiryDate,
        desc: null,
        descEn: null,
        features: null,
        featuresEn: null,
        usage: null,
        usageEn: null,
        warnings: null,
        warningsEn: null,
        ingredients: null,
        ingredientsEn: null,
        disclaimer: null,
        disclaimerEn: null,
        supplementFacts: null,
        specifications: null,
        certifications: null,
        dosageCalculator: null,
        faqs: null,
        keyInfo: null,
        seoKeywords: null,
        seoKeywordsEn: null,
        seoDesc: null,
        seoDescEn: null,
        image: null,
        backImage: null,
        imageAlt: null,
        sizes: extractSizes(title)
      });
    }
  }

  return products;
}

function parseGenericSheet(rawRows, normalizedHeaders) {
  const titleIdx = normalizedHeaders.findIndex(h => h.includes('title') || h.includes('اسم') || h.includes('name'));
  const priceIdx = normalizedHeaders.findIndex(h => h.includes('price') || h.includes('سعر'));
  const brandIdx = normalizedHeaders.findIndex(h => h.includes('brand') || h.includes('شركة') || h.includes('ماركة'));
  const catIdx = normalizedHeaders.findIndex(h => h.includes('category') || h.includes('قسم') || h.includes('تصنيف'));
  const descIdx = normalizedHeaders.findIndex(h => h.includes('desc') || h.includes('وصف'));
  const expIdx = normalizedHeaders.findIndex(h => h.includes('exp') || h.includes('صلاحية'));
  const imgIdx = normalizedHeaders.findIndex(h => h.includes('image') || h.includes('صورة') || h.includes('img') || h.includes('photo'));

  const products = [];
  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) continue;

    const title = titleIdx >= 0 && row[titleIdx] ? String(row[titleIdx]).trim() : '';
    if (!title) continue;

    const price = priceIdx >= 0 ? parseNumber(row[priceIdx]) : 0;
    const brand = brandIdx >= 0 && row[brandIdx] ? cleanBrandName(row[brandIdx]) : 'Other';
    const desc = descIdx >= 0 && row[descIdx] ? String(row[descIdx]).trim() : null;
    const category = catIdx >= 0 && row[catIdx] ? String(row[catIdx]).trim() : detectCategory(title, '', desc || '');
    const expiryDate = expIdx >= 0 ? parseExpiryDate(row[expIdx]) : null;
    const frontImg = imgIdx >= 0 ? cleanImageUrl(row[imgIdx]) : null;

    products.push({
      title,
      titleEn: null,
      brand,
      category,
      price: price !== null ? price : 0,
      oldPrice: null,
      discountType: null,
      discountValue: null,
      expiryDate,
      desc,
      descEn: null,
      features: null,
      featuresEn: null,
      usage: null,
      usageEn: null,
      warnings: null,
      warningsEn: null,
      ingredients: null,
      ingredientsEn: null,
      disclaimer: null,
      disclaimerEn: null,
      supplementFacts: null,
      specifications: null,
      certifications: null,
      dosageCalculator: null,
      faqs: null,
      keyInfo: null,
      seoKeywords: null,
      seoKeywordsEn: null,
      seoDesc: null,
      seoDescEn: null,
      image: frontImg,
      backImage: null,
      imageAlt: null,
      sizes: extractSizes(title)
    });
  }

  return products;
}

async function importProductsFromExcel(filePath, prismaClient) {
  const prisma = prismaClient || new (require('@prisma/client').PrismaClient)();
  const parsedProducts = parseProductsFromWorkbook(filePath);
  if (parsedProducts.length === 0) {
    return {
      totalRows: 0,
      importedCount: 0,
      updatedCount: 0,
      message: 'لم يتم العثور على أية منتجات في الملف.'
    };
  }

  const categoryCache = new Map();
  const brandCache = new Map();

  const existingCategories = await prisma.category.findMany();
  for (const c of existingCategories) {
    categoryCache.set(c.name.toLowerCase(), c);
  }

  const existingBrands = await prisma.brand.findMany();
  for (const b of existingBrands) {
    brandCache.set(b.name.toLowerCase(), b);
  }

  let importedCount = 0;
  let updatedCount = 0;
  const touchedCategoryIds = new Set();

  for (const item of parsedProducts) {
    // 1. Resolve Category
    const categoryName = item.category || 'فيتامينات ومعادن';
    const catKey = categoryName.toLowerCase();
    let category = categoryCache.get(catKey);

    if (!category) {
      category = await prisma.category.upsert({
        where: { name: categoryName },
        update: {},
        create: {
          name: categoryName,
          image: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&q=80',
          count: 0
        }
      });
      categoryCache.set(catKey, category);
    }
    touchedCategoryIds.add(category.id);

    // 2. Resolve Brand
    const brandName = item.brand || 'Other';
    const brandKey = brandName.toLowerCase();
    let brand = brandCache.get(brandKey);

    if (!brand) {
      brand = await prisma.brand.upsert({
        where: { name: brandName },
        update: {},
        create: {
          name: brandName,
          nameEn: brandName
        }
      });
      brandCache.set(brandKey, brand);
    }

    // 3. Find Existing Product
    let existingProduct = await prisma.product.findFirst({
      where: {
        OR: [
          { title: item.title },
          ...(item.titleEn ? [{ titleEn: item.titleEn }] : [])
        ]
      }
    });

    const updatePayload = {
      title: item.title,
      titleEn: item.titleEn || undefined,
      categoryId: category.id,
      brandId: brand ? brand.id : undefined,
      price: item.price !== null ? item.price : undefined,
      oldPrice: item.oldPrice !== null ? item.oldPrice : undefined,
      discountType: item.discountType || undefined,
      discountValue: item.discountValue !== null ? item.discountValue : undefined,
      expiryDate: item.expiryDate || undefined,
      desc: item.desc || undefined,
      descEn: item.descEn || undefined,
      features: item.features || undefined,
      featuresEn: item.featuresEn || undefined,
      usage: item.usage || undefined,
      usageEn: item.usageEn || undefined,
      warnings: item.warnings || undefined,
      warningsEn: item.warningsEn || undefined,
      ingredients: item.ingredients || undefined,
      ingredientsEn: item.ingredientsEn || undefined,
      disclaimer: item.disclaimer || undefined,
      disclaimerEn: item.disclaimerEn || undefined,
      supplementFacts: item.supplementFacts || undefined,
      specifications: item.specifications || undefined,
      certifications: item.certifications || undefined,
      dosageCalculator: item.dosageCalculator || undefined,
      faqs: item.faqs || undefined,
      keyInfo: item.keyInfo || undefined,
      seoKeywords: item.seoKeywords || undefined,
      seoKeywordsEn: item.seoKeywordsEn || undefined,
      seoDesc: item.seoDesc || undefined,
      seoDescEn: item.seoDescEn || undefined,
      sizes: item.sizes || undefined,
      sizeOptions: item.sizeOptions || undefined
    };

    if (item.image) {
      updatePayload.image = item.image;
    }
    if (item.imageAlt) {
      updatePayload.imageAlt = item.imageAlt;
    }
    if (item.backImage) {
      updatePayload.images = JSON.stringify([item.backImage]);
    }

    if (existingProduct) {
      await prisma.product.update({
        where: { id: existingProduct.id },
        data: updatePayload
      });
      updatedCount++;
    } else {
      const fallbackImage = item.image || category.image || 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=600&q=80';
      await prisma.product.create({
        data: {
          title: item.title,
          titleEn: item.titleEn || null,
          desc: item.desc || null,
          descEn: item.descEn || null,
          features: item.features || null,
          featuresEn: item.featuresEn || null,
          usage: item.usage || null,
          usageEn: item.usageEn || null,
          warnings: item.warnings || null,
          warningsEn: item.warningsEn || null,
          ingredients: item.ingredients || null,
          ingredientsEn: item.ingredientsEn || null,
          disclaimer: item.disclaimer || null,
          disclaimerEn: item.disclaimerEn || null,
          supplementFacts: item.supplementFacts || null,
          specifications: item.specifications || null,
          certifications: item.certifications || null,
          dosageCalculator: item.dosageCalculator || null,
          faqs: item.faqs || null,
          keyInfo: item.keyInfo || null,
          sizeOptions: item.sizeOptions || null,
          seoKeywords: item.seoKeywords || null,
          seoKeywordsEn: item.seoKeywordsEn || null,
          seoDesc: item.seoDesc || null,
          seoDescEn: item.seoDescEn || null,
          price: item.price !== null ? item.price : 0,
          oldPrice: item.oldPrice !== null ? item.oldPrice : null,
          discountType: item.discountType || null,
          discountValue: item.discountValue !== null ? item.discountValue : null,
          sizes: item.sizes || null,
          expiryDate: item.expiryDate || null,
          image: fallbackImage,
          images: item.backImage ? JSON.stringify([item.backImage]) : null,
          imageAlt: item.imageAlt || null,
          categoryId: category.id,
          brandId: brand ? brand.id : null
        }
      });
      importedCount++;
    }
  }

  // Update counts for touched categories
  for (const catId of touchedCategoryIds) {
    const count = await prisma.product.count({ where: { categoryId: catId } });
    await prisma.category.update({
      where: { id: catId },
      data: { count }
    });
  }

  return {
    totalRows: parsedProducts.length,
    importedCount,
    updatedCount,
    message: `تمت معالجة ملف Excel بنجاح: إضافة ${importedCount} منتج جديد وتحديث ${updatedCount} منتج.`
  };
}

module.exports = {
  parseProductsFromWorkbook,
  importProductsFromExcel
};
