"use client";
import { useEffect, useRef, useState } from "react";
import { Palette, Check, Monitor, Sun, Moon, Sparkles, SlidersHorizontal } from "lucide-react";
import { THEME_KEY, CUSTOM_KEY, DEFAULT_CUSTOM, type ThemeMode, type CustomTheme } from "@/lib/theme";

const OPTIONS: { mode: ThemeMode; label: string; hint: string; icon: typeof Sun }[] = [
  { mode: "default", label: "Default", hint: "Tampilan bawaan PegawaiKu", icon: Sparkles },
  { mode: "system", label: "System", hint: "Mengikuti pengaturan perangkat", icon: Monitor },
  { mode: "light", label: "Light", hint: "Terang, latar putih", icon: Sun },
  { mode: "dark", label: "Dark", hint: "Gelap, nyaman di malam hari", icon: Moon },
  { mode: "custom", label: "Custom", hint: "Pilih warna sendiri", icon: SlidersHorizontal },
];

function readMode(): ThemeMode {
  try { const m = localStorage.getItem(THEME_KEY) as ThemeMode | null; return m && OPTIONS.some((o) => o.mode === m) ? m : "default"; } catch { return "default"; }
}
function readCustom(): CustomTheme {
  try { return { ...DEFAULT_CUSTOM, ...(JSON.parse(localStorage.getItem(CUSTOM_KEY) || "{}") as Partial<CustomTheme>) }; } catch { return DEFAULT_CUSTOM; }
}
const reapply = () => (window as unknown as { __pkTheme?: () => void }).__pkTheme?.();

/** Ikon palet di dekat lonceng → pop-up pilihan tampilan: Default, System, Light, Dark, Custom. */
export function ThemeSwitcher() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ThemeMode>("default");
  const [custom, setCustom] = useState<CustomTheme>(DEFAULT_CUSTOM);
  const box = useRef<HTMLDivElement>(null);

  // nilai tersimpan hanya ada di browser → dibaca saat pop-up dibuka
  const toggle = () => { if (!open) { setMode(readMode()); setCustom(readCustom()); } setOpen((o) => !o); };

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const choose = (m: ThemeMode) => {
    setMode(m);
    try { localStorage.setItem(THEME_KEY, m); if (m === "custom") localStorage.setItem(CUSTOM_KEY, JSON.stringify(custom)); } catch { /* penyimpanan diblokir: tema tetap berlaku sampai halaman dimuat ulang */ }
    reapply();
  };
  const tune = (patch: Partial<CustomTheme>) => {
    const next = { ...custom, ...patch };
    setCustom(next);
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(next)); } catch { /* abaikan */ }
    reapply();
  };

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={toggle} aria-label="Tampilan" aria-haspopup="dialog" aria-expanded={open} title="Tampilan" className={`rounded-lg p-2 text-slate-500 hover:bg-slate-100 ${open ? "bg-slate-100" : ""}`}>
        <Palette size={18} />
      </button>
      {open && (
        <div role="dialog" aria-label="Pengaturan tampilan" className="absolute right-0 top-full z-30 mt-2 w-72 rounded-2xl border border-border bg-card p-2 shadow-xl">
          <div className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Tampilan</div>
          {OPTIONS.map(({ mode: m, label, hint, icon: Icon }) => (
            <button key={m} type="button" onClick={() => choose(m)} aria-pressed={mode === m}
              className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm ${mode === m ? "bg-sky-50 text-primary" : "hover:bg-slate-100"}`}>
              <Icon size={16} className="shrink-0" />
              <span className="min-w-0 flex-1"><span className="block font-semibold">{label}</span><span className="block truncate text-xs text-muted">{hint}</span></span>
              {mode === m && <Check size={15} className="shrink-0" />}
            </button>
          ))}
          {mode === "custom" && (
            <div className="mt-2 space-y-2 border-t border-border px-2 pb-1 pt-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span>Dasar</span>
                <span className="flex overflow-hidden rounded-lg border border-border">
                  {(["light", "dark"] as const).map((b) => (
                    <button key={b} type="button" onClick={() => tune({ base: b, background: b === "dark" ? "#0b1220" : "#f8fafc" })} className={`px-3 py-1 ${custom.base === b ? "bg-primary text-white" : "hover:bg-slate-100"}`}>{b === "light" ? "Terang" : "Gelap"}</button>
                  ))}
                </span>
              </div>
              {([["primary", "Warna utama"], ["accent", "Warna aksen"], ["background", "Warna latar"]] as const).map(([k, label]) => (
                <label key={k} className="flex items-center justify-between gap-2">
                  <span>{label}</span>
                  <input type="color" value={custom[k]} onChange={(e) => tune({ [k]: e.target.value })} className="h-7 w-12 cursor-pointer rounded border border-border bg-transparent" aria-label={label} />
                </label>
              ))}
              <button type="button" onClick={() => tune(DEFAULT_CUSTOM)} className="text-xs font-semibold text-primary hover:underline">Kembalikan warna bawaan</button>
            </div>
          )}
          <div className="px-2 pb-1 pt-2 text-[11px] text-muted">Tersimpan di perangkat ini.</div>
        </div>
      )}
    </div>
  );
}
