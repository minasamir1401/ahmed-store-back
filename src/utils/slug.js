function slugify(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s\u0600-\u06FF-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getProductSlug(product) {
  const source = product.titleEn || product.title || '';
  return slugify(source);
}

function getProductUrlParam(product) {
  const slug = getProductSlug(product);
  return slug ? `${slug}-${product.id}` : product.id;
}

module.exports = {
  slugify,
  getProductSlug,
  getProductUrlParam,
};
