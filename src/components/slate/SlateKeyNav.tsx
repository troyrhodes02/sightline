"use client";

import { useEffect, useRef } from "react";

/**
 * Arrow-key movement across slate rows. Rows are ordinary links — Tab and
 * Enter already work — this adds ↑/↓ between them for the high-frequency
 * desktop review flow. It renders nothing and owns no state.
 */
export function SlateKeyNav({ children }: { children: React.ReactNode }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const rows = Array.from(
        element.querySelectorAll<HTMLElement>("[data-slate-row]"),
      );
      if (rows.length === 0) return;
      const index = rows.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === "ArrowDown"
          ? rows[Math.min(index + 1, rows.length - 1)]
          : rows[Math.max(index - 1, 0)];
      if (next) {
        event.preventDefault();
        next.focus();
      }
    };

    element.addEventListener("keydown", onKeyDown);
    return () => element.removeEventListener("keydown", onKeyDown);
  }, []);

  return <div ref={container}>{children}</div>;
}
