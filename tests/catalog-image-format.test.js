const assert = require('node:assert/strict');
const { test } = require('node:test');
const sharp = require('sharp');
const { normalizeCatalogImage } = require('../src/utils/catalogImageFormat');

test('small, portrait, landscape and transparent sources become opaque square sRGB JPEGs without cropping', async () => {
  for (const [width, height] of [[400, 400], [391, 760], [773, 441], [1500, 1800]]) {
    const source = await sharp({ create: { width, height, channels: 4, background: { r: 200, g: 10, b: 20, alpha: 0.5 } } }).png().toBuffer();
    const output = await normalizeCatalogImage(source);
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.width, 1024);
    assert.equal(metadata.height, 1024);
    assert.equal(metadata.format, 'jpeg');
    assert.equal(metadata.space, 'srgb');
    assert.equal(metadata.channels, 3);
    assert.equal(metadata.hasAlpha, false);
    assert.ok(output.length < 8 * 1024 * 1024);
    // Non-square sources must have a white margin, rather than having their ends cropped.
    const { data } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    if (width !== height) assert.ok([...data.subarray(0, 3)].every(value => value >= 250));
    const center = (512 * 1024 + 512) * 3;
    assert.ok(data[center] > data[center + 1] + 50);
  }
});

test('invalid bytes fail processing instead of being encoded as a successful image', async () => {
  await assert.rejects(normalizeCatalogImage(Buffer.from('<html>upstream error</html>')));
});
