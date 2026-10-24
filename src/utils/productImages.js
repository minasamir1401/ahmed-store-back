function parseProductImages(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim());
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parseProductImages(parsed);
  } catch {}
  return String(raw).split(',').map(item => item.trim()).filter(Boolean);
}

module.exports = { parseProductImages };
