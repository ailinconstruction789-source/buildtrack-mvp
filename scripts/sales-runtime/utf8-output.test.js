// @vitest-environment node
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('native runtime UTF-8 pipe decoding', () => {
    it('decodes stdout and stderr before concatenating chunks', () => {
        const runner = readFileSync('scripts/sales-runtime/run.mjs', 'utf8');
        for (const channel of ['stdout', 'stderr']) {
            expect(runner.indexOf(`child.${channel}.setEncoding('utf8')`)).toBeGreaterThan(-1);
            expect(runner.indexOf(`child.${channel}.setEncoding('utf8')`)).toBeLessThan(runner.indexOf(`child.${channel}.on('data'`));
        }
    });
    it('preserves exact large Thai JSON when every multibyte character is split', async () => {
        const source = JSON.stringify({ items: Array.from({ length: 5000 }, (_, index) => ({ index, label: 'ตรวจความสะอาดบ้านก่อนพาชม' })) });
        const bytes = Buffer.from(source, 'utf8');
        const chunks = Array.from({ length: bytes.length }, (_, index) => bytes.subarray(index, index + 1));
        const stream = Readable.from(chunks).setEncoding('utf8');
        let result = '';
        for await (const chunk of stream) result += chunk;
        expect(result).toBe(source);
        expect(JSON.parse(result)).toEqual(JSON.parse(source));
        expect(result).not.toContain('\uFFFD');
    });
});
