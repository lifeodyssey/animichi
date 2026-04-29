"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Scroll-reveal hook. Returns a ref callback that observes elements for
 * viewport entry and adds the `seichi-visible` class once visible.
 *
 * Works with dynamically rendered content: each ref callback call
 * immediately starts observing the element via a persistent observer.
 */
export function useScrollReveal(): (el: HTMLElement | null) => void {
  const obsRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    obsRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("seichi-visible");
            obsRef.current?.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 },
    );
    return () => obsRef.current?.disconnect();
  }, []);

  return useCallback((el: HTMLElement | null) => {
    if (el && obsRef.current) obsRef.current.observe(el);
  }, []);
}
