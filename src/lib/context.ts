import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Org = { id: string; name: string; slug: string; credit_balance: number; owner_id: string };
export type Project = { id: string; org_id: string; name: string; description: string | null; brand: Record<string, unknown> };

/** Konteks sesi: user, org aktif, project aktif (dipilih via cookie). */
export async function getContext() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: orgs } = await supabase
    .from("organizations")
    .select("id,name,slug,credit_balance,owner_id")
    .order("created_at");
  const orgList = (orgs ?? []) as Org[];
  if (orgList.length === 0) {
    // trigger belum jalan (mis. migrasi belum dipasang)
    return { supabase, user, org: null, orgs: [], project: null, projects: [] as Project[] };
  }

  const cookieStore = await cookies();
  const orgId = cookieStore.get("pk_org")?.value;
  const org = orgList.find((o) => o.id === orgId) ?? orgList[0];

  const { data: projects } = await supabase
    .from("projects")
    .select("id,org_id,name,description,brand")
    .eq("org_id", org.id)
    .order("created_at");
  const projectList = (projects ?? []) as Project[];
  const projectId = cookieStore.get("pk_project")?.value;
  const project = projectList.find((p) => p.id === projectId) ?? projectList[0] ?? null;

  return { supabase, user, org, orgs: orgList, project, projects: projectList };
}
