"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// Initial state is server-rendered before page content. Subsequent probes
// track a server restart or runtime target change without requiring a reload.
export function BruteForceWarning({ initiallyDisabled }: { initiallyDisabled: boolean }) {
  const [disabled, setDisabled] = useState(initiallyDisabled);
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === null) return;
    let alive = true;
    let sequence = 0;
    async function refresh() {
      const request = ++sequence;
      let active = false;
      try {
        const response = await fetch("/api/status", {
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });
        if (response.ok) {
          const status = await response.json();
          active = status?.idp?.brute_force_protection_disabled === true;
        }
      } catch {
        // No reported active state, so there is no warning to display.
      }
      if (alive && request === sequence) setDisabled(active);
    }
    void refresh();
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [pathname]);

  if (!disabled) return null;
  return (
    <div
      role="alert"
      className="sticky top-0 z-[2147483647] border-b-4 border-red-950 bg-red-700 px-4 py-3 text-center text-base font-bold text-white"
    >
      Brute-force protections are disabled. This instance is not safe for real accounts.
    </div>
  );
}
