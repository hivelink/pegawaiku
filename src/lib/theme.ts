/** Tema tampilan (disimpan per perangkat di localStorage). Dipakai skrip awal di <head> dan tombol tema. */
export type ThemeMode = "default" | "system" | "light" | "dark" | "custom";
export type CustomTheme = { base: "light" | "dark"; primary: string; accent: string; background: string };
export const THEME_KEY = "pk_theme";
export const CUSTOM_KEY = "pk_theme_custom";
export const DEFAULT_CUSTOM: CustomTheme = { base: "light", primary: "#1e3a8a", accent: "#0ea5e9", background: "#f8fafc" };

/**
 * Fungsi penerap tema, ditulis sebagai teks agar bisa dijalankan sebelum React (di <head>) dan dipakai ulang oleh komponen.
 * window.__pkTheme(mode?, custom?) → menerapkan & mengembalikan mode aktif.
 */
export const THEME_BOOT = `(function(){
  var HEX=/^#[0-9a-fA-F]{6}$/;
  function apply(){
    var d=document.documentElement,mode='default',c=null;
    try{mode=localStorage.getItem('${THEME_KEY}')||'default';c=JSON.parse(localStorage.getItem('${CUSTOM_KEY}')||'null');}catch(e){}
    if(['default','system','light','dark','custom'].indexOf(mode)<0)mode='default';
    var dark=false;try{dark=window.matchMedia('(prefers-color-scheme: dark)').matches;}catch(e){}
    var t=mode==='system'?(dark?'dark':'default'):mode;
    ['--primary','--primary-2','--primary-solid','--accent','--background'].forEach(function(k){d.style.removeProperty(k);});
    if(mode==='custom'){
      c=c||{};t=c.base==='dark'?'dark':'default';
      if(HEX.test(c.primary||'')){d.style.setProperty('--primary',c.primary);d.style.setProperty('--primary-solid',c.primary);d.style.setProperty('--primary-2','color-mix(in srgb, '+c.primary+' 82%, black)');}
      if(HEX.test(c.accent||''))d.style.setProperty('--accent',c.accent);
      if(HEX.test(c.background||''))d.style.setProperty('--background',c.background);
    }
    d.setAttribute('data-theme',t);d.setAttribute('data-theme-mode',mode);
    return mode;
  }
  window.__pkTheme=apply;apply();
  try{window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',apply);}catch(e){}
})();`;
