import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Org = { id: string; name: string; slug: string; credit_balance: number; owner_id: string };
export type Project = {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  brand: Record<string, unknown>;
  status: string | null;
  due_date: string | null;
  tagline: string | null;
  image_url: string | null;
  website: string | null;
  category: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Konteks sesi: user, org aktif, project aktif (dipilih via cookie).
 * Dibungkus `cache()` supaya layout + page dalam satu request hanya query sekali.
 */
export const getContext = cache(async () => {
  const supabase = await createClient();
  const cookieStore = await cookies();

  // Jalankan paralel: sesi user + daftar org (RLS sudah membatasi ke anggota).
  const [{ data: { user } }, { data: orgs }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("organizations").select("id,name,slug,credit_balance,owner_id").order("created_at"),
  ]);
  if (!user) redirect("/login");

  const orgList = (orgs ?? []) as Org[];
  if (orgList.length === 0) {
    return { supabase, user, org: null, orgs: [], project: null, projects: [] as Project[] };
  }

  const orgId = cookieStore.get("pk_org")?.value;
  const org = orgList.find((o) => o.id === orgId) ?? orgList[0];

  const { data: projects } = await supabase
    .from("projects")
    .select("id,org_id,name,description,brand,status,due_date,tagline,image_url,website,category,created_by,created_at,updated_at")
    .eq("org_id", org.id)
    .order("created_at");
  const projectList = (projects ?? []) as Project[];
  const projectId = cookieStore.get("pk_project")?.value;
  const project = projectList.find((p) => p.id === projectId) ?? projectList[0] ?? null;

  return { supabase, user, org, orgs: orgList, project, projects: projectList };
});
