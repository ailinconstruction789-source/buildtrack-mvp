// @vitest-environment node
import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
describe('local QR encoder smoke test', () => {
  it('encodes a synthetic fragment URL as a real QR PNG without network access', async () => {
    const url = `https://synthetic.invalid/customer-voices#token=${'ab'.repeat(32)}`;
    const matrix = QRCode.create(url, { errorCorrectionLevel: 'M' });
    expect(matrix.modules.size).toBeGreaterThan(21);
    expect(matrix.modules.data.length).toBe(matrix.modules.size ** 2);
    const data = await QRCode.toDataURL(url, { width: 320, margin: 4, errorCorrectionLevel: 'M' });
    expect(data).toMatch(/^data:image\/png;base64,/);
    const png = Buffer.from(data.split(',')[1], 'base64'); expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(320); expect(png.readUInt32BE(20)).toBe(320);
  });
});
