"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Width in px of the element the returned ref is attached to, kept current as it
 * resizes. Charts draw in real pixels at this width, so their text keeps its size
 * on a phone instead of shrinking along with a fixed-width viewBox.
 */
export function useElementWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(Math.round(el.clientWidth) || fallback);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fallback]);
  return [ref, width] as const;
}
