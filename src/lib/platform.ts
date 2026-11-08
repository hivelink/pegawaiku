import { createHash } from "crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Utilitas admin platform: rahasia (token GitHub/Supabase), GitHub Git Data API, Supabase Management API.
 * Semua rahasia dibaca dari env terlebih dulu, lalu tabel platform_secrets (RLS: hanya admin platform).
 * Nilai rahasia TIDAK pernah dikirim ke browser.
 */

export const SECRET_KEYS = {
  github_token: "GITHUB_TOKEN",
  supabase_access_token: "SUPABASE_ACCESS_TOKEN",
  github_repo: "GITHUB_REPO",
  github_branch: "GITHUB_BRANCH",
} as const;
export type SecretKey = keyof typeof SECRET_KEYS;

export type AdminCtx = { supabase: SupabaseClient; user: User; secrets: Partial<Record<SecretKey, string>>; secretSource: Partial<Record<SecretKey, "env" | "db">> };

export async function isPlatformAdmin(supabase: SupabaseClient, user: User): Promise<boolean> {
  const envList = (process.env.PLATFORM_ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (user.email && envList.includes(user.email.toLowerCase())) return true;
  const { data, error } = await supabase.rpc("is_platform_admin");
  if (error) return false;
  return data === true;
}

/** Ambil konteks admin platform atau null bila bukan admin. */
export async function getAdminCtx(): Promise<AdminCtx | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  if (!(await isPlatformAdmin(supabase, user))) return null;
  const secrets: AdminCtx["secrets"] = {};
  const secretSource: AdminCtx["secretSource"] = {};
  const { data: rows } = await supabase.from("platform_secrets").select("key,value");
  for (const r of rows ?? []) if (r.key in SECRET_KEYS) { secrets[r.key as SecretKey] = r.value; secretSource[r.key as SecretKey] = "db"; }
  for (const [k, env] of Object.entries(SECRET_KEYS)) {
    const v = process.env[env];
    if (v) { secrets[k as SecretKey] = v; secretSource[k as SecretKey] = "env"; }
  }
  return { supabase, user, secrets, secretSource };
}

export function repoOf(ctx: AdminCtx): { repo: string; branch: string } {
  const fromVercel = process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}` : "";
  const repo = ctx.secrets.github_repo || fromVercel || "hivelink/pegawaiku";
  const branch = ctx.secrets.github_branch || process.env.VERCEL_GIT_COMMIT_REF || "main";
  return { repo, branch };
}

export function supabaseRef(): string {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname.split(".")[0]; } catch { return ""; }
}

// ---------------- GitHub ----------------

export async function gh<T = unknown>(ctx: AdminCtx, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const token = ctx.secrets.github_token;
  if (!token) throw new Error("Token GitHub belum diatur (Pengaturan → Pembaruan → Token).");
  const r = await fetch(`https://api.github.com${path}`, {
    method: init?.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json", "user-agent": "pegawaiku-updater" },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const text = await r.text();
  let j: unknown = null;
  try { j = text ? JSON.parse(text) : null; } catch { j = text; }
  if (!r.ok) {
    const msg = (j as { message?: string })?.message ?? `HTTP ${r.status}`;
    if (r.status === 401) throw new Error("Token GitHub tidak valid / kedaluwarsa.");
    if (r.status === 403 || r.status === 404) throw new Error(`GitHub menolak (${r.status}): ${msg}. Pastikan token punya akses Contents: Read & write ke repo.`);
    throw new Error(`GitHub: ${msg}`);
  }
  return j as T;
}

export function gitBlobSha(buf: Buffer): string {
  return createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest("hex");
}

export async function headInfo(ctx: AdminCtx) {
  const { repo, branch } = repoOf(ctx);
  const ref = await gh<{ object: { sha: string } }>(ctx, `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  const commit = await gh<{ sha: string; tree: { sha: string }; message: string; author: { date: string } }>(ctx, `/repos/${repo}/git/commits/${ref.object.sha}`);
  return { repo, branch, sha: commit.sha, treeSha: commit.tree.sha, message: commit.message, date: commit.author?.date };
}

export async function treeMap(ctx: AdminCtx, repo: string, treeSha: string): Promise<Map<string, string>> {
  const t = await gh<{ tree: { path: string; type: string; sha: string }[]; truncated: boolean }>(ctx, `/repos/${repo}/git/trees/${treeSha}?recursive=1`);
  const m = new Map<string, string>();
  for (const e of t.tree) if (e.type === "blob") m.set(e.path, e.sha);
  return m;
}

// ---------------- Paket pembaruan (zip) ----------------

const SKIP = [/^\.env/, /(^|\/)node_modules\//, /(^|\/)\.next\//, /(^|\/)\.git\//, /(^|\/)\.vercel\//, /(^|\/)\.DS_Store$/, /^__MACOSX\//];

export type UpdateFile = { path: string; buf: Buffer; sha: string };

export async function readUpdateZip(bytes: ArrayBuffer): Promise<{ files: UpdateFile[]; skipped: string[] }> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const raw: { path: string; entry: import("jszip").JSZipObject }[] = [];
  zip.forEach((p, entry) => { if (!entry.dir) raw.push({ path: p.replace(/\\/g, "/"), entry }); });
  // buang folder pembungkus tunggal (mis. "pegawaiku/src/..."), kecuali itu folder proyek biasa
  const firsts = new Set(raw.map((r) => r.path.split("/")[0]));
  const KNOWN = new Set(["src", "public", "supabase", "skills", "scripts", "package.json"]);
  let strip = "";
  if (firsts.size === 1) { const f = [...firsts][0]; if (!KNOWN.has(f) && raw.every((r) => r.path.includes("/"))) strip = f + "/"; }
  const files: UpdateFile[] = [];
  const skipped: string[] = [];
  for (const r of raw) {
    const p = strip && r.path.startsWith(strip) ? r.path.slice(strip.length) : r.path;
    if (!p || p.startsWith("/") || p.split("/").some((s) => s === ".." || s === "") || /^[a-zA-Z]:/.test(p)) { skipped.push(r.path); continue; }
    if (SKIP.some((re) => re.test(p))) { skipped.push(p); continue; }
    const buf = Buffer.from(await r.entry.async("uint8array"));
    files.push({ path: p, buf, sha: gitBlobSha(buf) });
  }
  return { files, skipped };
}

// ---------------- Supabase Management API ----------------

export async function runSql(ctx: AdminCtx, sql: string): Promise<unknown> {
  const token = ctx.secrets.supabase_access_token;
  if (!token) throw new Error("Supabase access token belum diatur.");
  const ref = supabaseRef();
  if (!ref) throw new Error("Project ref Supabase tidak diketahui (atur SUPABASE_PROJECT_REF).");
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ query: sql }), cache: "no-store",
  });
  const t = await r.text();
  if (!r.ok) {
    let msg = t;
    try { msg = JSON.parse(t).message ?? t; } catch { /* teks */ }
    throw new Error(`Supabase: ${msg.slice(0, 500)}`);
  }
  try { return JSON.parse(t); } catch { return t; }
}

/** Daftar migrasi di repo (supabase/migrations/*.sql) beserta status sudah/belum dijalankan. */
export async function migrationStatus(ctx: AdminCtx) {
  const { repo, branch } = repoOf(ctx);
  const list = await gh<{ name: string; path: string; sha: string }[]>(ctx, `/repos/${repo}/contents/supabase/migrations?ref=${encodeURIComponent(branch)}`);
  const names = list.filter((f) => f.name.endsWith(".sql")).map((f) => f.name).sort();
  const { data, error } = await ctx.supabase.from("schema_migrations").select("name");
  const applied = new Set<string>(error ? names.filter((n) => n < "0009") : (data ?? []).map((d) => d.name));
  return { names, applied, tableMissing: !!error, repo, branch };
}

export async function fetchRepoFile(ctx: AdminCtx, path: string): Promise<string> {
  const { repo, branch } = repoOf(ctx);
  const f = await gh<{ content: string; encoding: string }>(ctx, `/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`);
  return Buffer.from(f.content, (f.encoding as BufferEncoding) || "base64").toString("utf8");
}
