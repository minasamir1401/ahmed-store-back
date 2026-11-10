const IMAGE_HOSTS = new Set([
  'cloudinary.images-iherb.com', 's3.images-iherb.com', 'cdn.shopify.com',
  'www.vitacost.com', 'm.media-amazon.com', 'australianvit.com', 'wovital.com',
  'mfsupps.com', 'www.naturebellusa.com', 'image-cdn.ubuy.com', 'www.nutraday.cz',
  'i.ebayimg.com', 'i5.walmartimages.com', 'hilifevitamins.com', 'www.swansonvitamins.com',
]);

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

class FrameSourceError extends Error {}

async function readRemoteProductImage(source, request = fetch) {
  let url = new URL(source);
  const signal = AbortSignal.timeout(8000);
  try {
    for (let redirects = 0; redirects <= 2; redirects++) {
      if (url.protocol !== 'https:' || url.port || url.username || url.password || !IMAGE_HOSTS.has(url.hostname)) {
        throw new FrameSourceError('مصدر الرابط خارج مواقع الصور المدعومة. ارفع الصورة الأصلية للمنتج.');
      }
      const response = await request(url, {
        redirect: 'manual',
        headers: { Accept: 'image/*' },
        signal,
      });
      const location = response.headers.get('location');
      if ([301, 302, 303, 307, 308].includes(response.status) && location) {
        await response.body?.cancel();
        url = new URL(location, url);
        continue;
      }
      if (!response.ok || !response.body || !/^(?:image\/|application\/octet-stream\b)/i.test(response.headers.get('content-type') || '')) {
        await response.body?.cancel();
        throw new FrameSourceError('رابط الصورة المحفوظ لا يفتح ملف صورة. راجع الرابط أو ارفع الأصل.');
      }
      const sizeError = 'ملف الصورة أكبر من ٢٠ ميجابايت.';
      if (Number(response.headers.get('content-length')) > MAX_SOURCE_BYTES) {
        await response.body.cancel();
        throw new FrameSourceError(sizeError);
      }
      let size = 0;
      const chunks = [];
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > MAX_SOURCE_BYTES) throw new FrameSourceError(sizeError);
        chunks.push(chunk);
      }
      return Buffer.concat(chunks, size);
    }
  } catch (error) {
    if (error instanceof FrameSourceError) throw error;
  }
  throw new FrameSourceError('تعذر تحميل الصورة من رابطها المحفوظ. راجع الرابط أو حاول تاني.');
}

module.exports = { FrameSourceError, MAX_SOURCE_BYTES, readRemoteProductImage };
