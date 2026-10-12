import { useLayoutEffect, useRef } from 'react';

export interface ConstructionPreviewFile { previewUrl?: string }
interface PreviewScope {
  actorKey: string;
  urls: Set<string>;
  mounted: boolean;
  disposed: boolean;
  ignoredFiles?: readonly ConstructionPreviewFile[];
}

function disposePreviews(scope: PreviewScope) {
  if (scope.disposed) return;
  scope.disposed = true;
  for (const url of scope.urls) {
    try { URL.revokeObjectURL(url); } catch {}
  }
  scope.urls.clear();
}

/** Own preview URLs for an actor lifetime; ordinary navigation/file edits keep them valid. */
export function useConstructionPreviewLifetime(
  files: readonly ConstructionPreviewFile[],
  actorScopeKey: string,
  clearFiles: () => void,
): void {
  const lifetime = useRef<PreviewScope | null>(null);
  const clearCurrentFiles = useRef(clearFiles);
  const committedFiles = useRef(files);
  useLayoutEffect(() => { clearCurrentFiles.current = clearFiles; }, [clearFiles]);
  useLayoutEffect(() => { committedFiles.current = files; }, [files]);

  useLayoutEffect(() => {
    const previous = lifetime.current;
    if (previous && previous.actorKey !== actorScopeKey) {
      disposePreviews(previous);
      lifetime.current = { actorKey: actorScopeKey, urls: new Set(), mounted: true, disposed: false, ignoredFiles: committedFiles.current };
      clearCurrentFiles.current();
    } else if (!previous) {
      lifetime.current = { actorKey: actorScopeKey, urls: new Set(), mounted: true, disposed: false };
    } else {
      previous.mounted = true;
    }
    const scope = lifetime.current!;
    return () => {
      scope.mounted = false;
      // StrictMode immediately replays setup on the same scope; only actual unmount
      // leaves mounted false when this microtask runs. Never clear React state here.
      queueMicrotask(() => { if (!scope.mounted) disposePreviews(scope); });
    };
  }, [actorScopeKey]);

  useLayoutEffect(() => {
    const scope = lifetime.current;
    if (!scope || !scope.mounted || scope.actorKey !== actorScopeKey || files === scope.ignoredFiles) return;
    scope.ignoredFiles = undefined;
    for (const file of files) {
      if (file.previewUrl?.startsWith('blob:')) scope.urls.add(file.previewUrl);
    }
  }, [files, actorScopeKey]);
}
