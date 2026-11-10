"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** Bar progres tipis di atas layar: muncul begitu link internal diklik, hilang saat halaman baru tampil. */
export function NavProgress() {
  const path = usePathname();
  const search = useSearchParams().toString();
  const [active, setActive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || !href.startsWith("/") || href.startsWith("//")) return;
      const url = new URL(href, location.href);
      if (url.pathname === location.pathname && url.search === location.search) return;
      setActive(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setActive(false), 15_000); // pengaman bila navigasi batal
    };
    document.addEventListener("click", onClick, true); // fase capture: next/link memanggil preventDefault lebih dulu
    return () => { document.removeEventListener("click", onClick, true); if (timer.current) clearTimeout(timer.current); };
  }, []);

  // halaman baru sudah tampil → sembunyikan
  const key = path + "?" + search;
  const [seen, setSeen] = useState(key);
  if (seen !== key) { setSeen(key); if (active) setActive(false); }

  if (!active) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-1 overflow-hidden bg-sky-100" role="progressbar" aria-label="Memuat halaman">
      <div className="nav-progress-bar h-full w-1/3 rounded-full bg-gradient-to-r from-primary to-accent" />
    </div>
  );
}
