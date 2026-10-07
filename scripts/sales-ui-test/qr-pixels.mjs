import pngjs from 'pngjs';
/** Browser canvas and Node encode PNG bytes differently; compare the actual RGBA pixels. */
export function matchesQrPixels(actualUrl, expectedUrl) {
  const decode = url => pngjs.PNG.sync.read(Buffer.from(url.split(',')[1], 'base64'));
  const actual = decode(actualUrl), expected = decode(expectedUrl);
  return actual.width === 320 && actual.height === 320 && actual.width === expected.width
    && actual.height === expected.height && actual.data.equals(expected.data);
}
