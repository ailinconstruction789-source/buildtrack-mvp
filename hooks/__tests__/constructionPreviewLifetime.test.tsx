import React from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConstructionPreviewLifetime, type ConstructionPreviewFile } from '../useConstructionPreviewLifetime';

const revoke = vi.fn();
let previousRevoke: PropertyDescriptor | undefined;
beforeEach(() => {
  previousRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
  revoke.mockReset();
});
afterEach(async () => {
  cleanup(); await Promise.resolve();
  if (previousRevoke) Object.defineProperty(URL, 'revokeObjectURL', previousRevoke);
  else Reflect.deleteProperty(URL, 'revokeObjectURL');
});
const fileA = { previewUrl: 'blob:synthetic-task-A' };
const fileB = { previewUrl: 'blob:synthetic-task-B' };

describe('construction preview actor lifetime', () => {
  it('keeps previews on ordinary file/view/callback rerenders and disposes accumulated URLs once on unmount', async () => {
    const clear = vi.fn();
    const { rerender, unmount } = renderHook(({ files, clearFiles }: {
      files: readonly ConstructionPreviewFile[]; clearFiles: () => void;
    }) => useConstructionPreviewLifetime(files, 'actor-A', clearFiles), { initialProps: { files: [fileA], clearFiles: clear } });
    rerender({ files: [fileA, fileB], clearFiles: vi.fn() });
    rerender({ files: [fileB], clearFiles: vi.fn() });
    rerender({ files: [], clearFiles: vi.fn() });
    expect(revoke).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    unmount();
    await act(async () => { await Promise.resolve(); });
    expect(revoke.mock.calls.map(([url]) => url)).toEqual([fileA.previewUrl, fileB.previewUrl]);
    expect(clear).not.toHaveBeenCalled();
  });

  it('revokes old actor previews and clears drafts only when actor identity changes', async () => {
    const clearA = vi.fn(); const clearB = vi.fn();
    const oldFiles = [fileA];
    const { rerender, unmount } = renderHook(({ files, key, clear }: {
      files: readonly ConstructionPreviewFile[]; key: string; clear: () => void;
    }) => useConstructionPreviewLifetime(files, key, clear), { initialProps: { files: oldFiles, key: 'actor-A', clear: clearA } });
    rerender({ files: oldFiles, key: 'actor-B', clear: clearB });
    expect(revoke).toHaveBeenCalledExactlyOnceWith(fileA.previewUrl);
    expect(clearA).not.toHaveBeenCalled();
    expect(clearB).toHaveBeenCalledOnce();
    rerender({ files: [], key: 'actor-B', clear: clearB });
    rerender({ files: [fileB], key: 'actor-B', clear: clearB });
    expect(revoke).toHaveBeenCalledOnce();
    unmount();
    await act(async () => { await Promise.resolve(); });
    expect(revoke.mock.calls.map(([url]) => url)).toEqual([fileA.previewUrl, fileB.previewUrl]);
    expect(clearB).toHaveBeenCalledOnce();
  });

  it('releases existing mounted previews after actual unmount without revoking them during StrictMode replay', async () => {
    const clear = vi.fn();
    const wrapper = ({ children }: { children: React.ReactNode }) => <React.StrictMode>{children}</React.StrictMode>;
    const { rerender, unmount } = renderHook(({ files }) => useConstructionPreviewLifetime(files, 'actor-A', clear), {
      initialProps: { files: [fileA] }, wrapper,
    });
    await act(async () => { await Promise.resolve(); });
    expect(revoke).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    rerender({ files: [fileA, fileB] });
    unmount();
    await act(async () => { await Promise.resolve(); });
    expect(revoke.mock.calls.map(([url]) => url)).toEqual([fileA.previewUrl, fileB.previewUrl]);
    expect(clear).not.toHaveBeenCalled();
  });

  it('isolates independent task and defect preview lifetimes', async () => {
    const clearTask = vi.fn(); const clearDefect = vi.fn();
    const { rerender, unmount } = renderHook(({ actor }) => {
      useConstructionPreviewLifetime([fileA], actor, clearTask);
      useConstructionPreviewLifetime([fileB], actor, clearDefect);
    }, { initialProps: { actor: 'actor-A' } });
    rerender({ actor: 'signed-out' });
    expect(revoke.mock.calls.map(([url]) => url)).toEqual([fileA.previewUrl, fileB.previewUrl]);
    expect(clearTask).toHaveBeenCalledOnce(); expect(clearDefect).toHaveBeenCalledOnce();
    unmount();
    await act(async () => { await Promise.resolve(); });
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(clearTask).toHaveBeenCalledOnce(); expect(clearDefect).toHaveBeenCalledOnce();
  });

  it('does not revoke remote or missing preview URLs and tolerates duplicate files', async () => {
    const clear = vi.fn();
    const { unmount } = renderHook(() => useConstructionPreviewLifetime([
      fileA, fileA, {}, { previewUrl: 'https://example.invalid/fixture.jpg' }, { previewUrl: '' },
    ], 'actor-A', clear));
    unmount();
    await act(async () => { await Promise.resolve(); });
    expect(revoke).toHaveBeenCalledExactlyOnceWith(fileA.previewUrl);
    expect(clear).not.toHaveBeenCalled();
  });

  it('continues cleanup when one URL revoke throws and never clears state after unmount', async () => {
    const clear = vi.fn();
    revoke.mockImplementationOnce(() => { throw new Error('Synthetic URL API error'); });
    const { unmount } = renderHook(() => useConstructionPreviewLifetime([fileA, fileB], 'actor-A', clear));
    unmount();
    await act(async () => { await Promise.resolve(); });
    expect(revoke.mock.calls.map(([url]) => url)).toEqual([fileA.previewUrl, fileB.previewUrl]);
    expect(clear).not.toHaveBeenCalled();
  });
});
