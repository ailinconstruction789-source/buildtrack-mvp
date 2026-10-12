import { useCallback, useLayoutEffect, useRef } from 'react';

/** Capture a committed selection, invalidating it even when the user leaves and returns. */
export function useCommittedRequestScope(selectionKey: string) {
  const scope = useRef({ generation: 0, active: false });
  useLayoutEffect(() => {
    scope.current.generation += 1;
    scope.current.active = true;
    return () => {
      scope.current.generation += 1;
      scope.current.active = false;
    };
  }, [selectionKey]);

  return useCallback(() => {
    const generation = scope.current.generation;
    return () => scope.current.active && scope.current.generation === generation;
  }, []);
}
