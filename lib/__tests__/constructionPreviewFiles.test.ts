import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendConstructionPreviewFiles } from '../constructionPreviewFiles';

afterEach(() => vi.unstubAllGlobals());
describe('construction preview capacity', () => {
  it('creates URLs only for files within the remaining capacity and preserves order', () => {
    const createObjectURL = vi.fn(file => `blob:${file.name}`);
    vi.stubGlobal('URL', { createObjectURL });
    const existing = [{ file: new File([], 'original'), previewUrl: 'blob:original' }];
    const result = appendConstructionPreviewFiles(existing, [new File([], 'first'), new File([], 'second'), new File([], 'rejected')], 3);
    expect(result.map(row => row.file.name)).toEqual(['original', 'first', 'second']);
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(result[0]).toBe(existing[0]);
    expect(existing).toHaveLength(1);
  });
  it('does not allocate unused URLs when the limit is already reached', () => {
    const createObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL });
    const existing = [{ file: new File([], 'original'), previewUrl: 'blob:original' }];
    expect(appendConstructionPreviewFiles(existing, [new File([], 'rejected')], 1)).toEqual(existing);
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
