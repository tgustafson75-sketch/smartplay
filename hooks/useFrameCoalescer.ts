import { useEffect, useRef } from 'react';
import { createFrameCoalescer, type FrameCoalescer } from '../services/frameCoalescer';

/**
 * One frame-coalescer per mounted screen, cancelled on unmount (services/frameCoalescer explains why).
 * `apply` should read refs that writers update synchronously, so the flush commits the LATEST values.
 * The newest `apply` is used at flush time, so it may close over state setters freely.
 */
export function useFrameCoalescer<T extends object>(apply: (patch: Partial<T>) => void): FrameCoalescer<T> {
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const ref = useRef<FrameCoalescer<T> | null>(null);
  if (ref.current == null) ref.current = createFrameCoalescer<T>((p) => applyRef.current(p));
  useEffect(() => () => ref.current?.cancel(), []);
  return ref.current;
}
