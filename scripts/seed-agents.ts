/**
 * Seed 28 agent dari folder skills/ ke tabel public.agents.
 * Jalankan: npm run seed:agents
 * Butuh SUPABASE_SERVICE_ROLE_KEY di .env.local (hanya untuk seeding, jangan dipakai di client).
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY dulu.");
  process.exit(1);
}
const supabase = createClient(url, key);
const root = path.join(process.cwd(), "skills");

async function main() {
  const dirs = fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, "SKILL.md")));
  const rows = dirs.map((slug) => {
    const raw = fs.readFileSync(path.join(root, slug, "SKILL.md"), "utf8");
    const { data, content } = matter(raw);
    const handle = String(data.display_name || slug).toLowerCase().replace(/[^a-z0-9]/g, "") + "-" + slug.split("-").slice(1).join("");
    return {
      slug,
      display_name: data.display_name,
      handle: handle.slice(0, 40),
      title: data.title,
      category: data.category,
      description: data.description,
      system_prompt: content.trim(),
      requires_tools: data.requires_tools ?? [],
      model_hint: data.model_hint ?? null,
      avatar_url: `/agents/${slug}.svg`,
      cover_url: null,
      version: data.version ?? "1.0.0",
      stats: { projects: Math.floor(Math.random() * 200) + 20, tasks: Math.floor(Math.random() * 40) + 5 },
    };
  });
  const { error } = await supabase.from("agents").upsert(rows, { onConflict: "slug" });
  if (error) throw error;
  console.log(`OK: ${rows.length} agent di-seed.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
