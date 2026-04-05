"use client";

import { useEffect } from "react";

export function useClickOutside<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  onOutside: () => void,
) {
  useEffect(() => {
    function handlePointerDown(event: MouseEvent | TouchEvent | PointerEvent) {
      const node = ref.current;
      if (!node) return;
      const path = typeof (event as Event).composedPath === "function"
        ? (event as Event).composedPath()
        : [];
      if (path.includes(node) || node.contains(event.target as Node)) return;
      onOutside();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [ref, onOutside]);
}
