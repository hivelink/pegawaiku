"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getContext } from "@/lib/context";

export async function switchProject(formData: FormData) {
  const id = String(formData.get("project_id"));
  const c = await cookies();
  c.set("pk_project", id, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/app", "layout");
  redirect("/app/project");
}

export async function updateProjectMeta(formData: FormData) {
  const { supabase, project } = await getContext();
  if (!project) return;
  const due = String(formData.get("due_date") ?? "").trim();
  const { error } = await supabase
    .from("projects")
    .update({
      status: String(formData.get("status") ?? project.status ?? "active"),
      due_date: due || null,
      description: String(formData.get("description") ?? project.description ?? ""),
    })
    .eq("id", project.id);
  if (error) throw error;
  revalidatePath("/app/project");
}

export async function switchOrg(formData: FormData) {
  const id = String(formData.get("org_id"));
  const c = await cookies();
  c.set("pk_org", id, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  c.delete("pk_project");
  revalidatePath("/app");
}

export async function createProject(formData: FormData) {
  const { supabase, org, user } = await getContext();
  if (!org) throw new Error("Organisasi tidak ditemukan");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const { data, error } = await supabase
    .from("projects")
    .insert({ org_id: org.id, name, description: String(formData.get("description") ?? ""), created_by: user.id })
    .select("id")
    .single();
  if (error) throw error;
  const c = await cookies();
  c.set("pk_project", data.id, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/app", "layout");
  redirect("/app/project");
}

export async function hireAgent(formData: FormData) {
  const { supabase, project, user } = await getContext();
  if (!project) redirect("/app?error=project");
  const agentId = String(formData.get("agent_id"));
  const slug = String(formData.get("slug"));
  const { error } = await supabase
    .from("project_agents")
    .upsert({ project_id: project.id, agent_id: agentId, hired_by: user.id }, { onConflict: "project_id,agent_id" });
  if (error) throw error;
  revalidatePath(`/app/agent/${slug}`);
  redirect(`/app/agent/${slug}?hired=1`);
}

export async function toggleBookmark(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const agentId = String(formData.get("agent_id"));
  const slug = String(formData.get("slug"));
  const { data: existing } = await supabase.from("agent_bookmarks").select("agent_id").eq("user_id", user.id).eq("agent_id", agentId).maybeSingle();
  if (existing) await supabase.from("agent_bookmarks").delete().eq("user_id", user.id).eq("agent_id", agentId);
  else await supabase.from("agent_bookmarks").insert({ user_id: user.id, agent_id: agentId });
  revalidatePath(`/app/agent/${slug}`);
}

export async function startConversation(formData: FormData) {
  const { supabase, project, user } = await getContext();
  if (!project) redirect("/app?error=project");
  const agentId = String(formData.get("agent_id"));
  const { data, error } = await supabase
    .from("conversations")
    .insert({ project_id: project.id, agent_id: agentId, user_id: user.id, title: "Percakapan baru" })
    .select("id")
    .single();
  if (error) throw error;
  redirect(`/app/chat/${data.id}`);
}

export async function redeemVoucher(formData: FormData) {
  const { supabase, org } = await getContext();
  if (!org) return;
  const code = String(formData.get("code") ?? "").trim();
  const { error } = await supabase.rpc("redeem_voucher", { p_org: org.id, p_code: code });
  revalidatePath("/app/billing");
  if (error) redirect(`/app/billing?error=${encodeURIComponent(error.message)}`);
  redirect("/app/billing?ok=1");
}

export async function createTask(formData: FormData) {
  const { supabase, project, user } = await getContext();
  if (!project) return;
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  await supabase.from("tasks").insert({ project_id: project.id, title, created_by: user.id, agent_id: formData.get("agent_id") || null });
  revalidatePath("/app/tasks");
}

export async function moveTask(formData: FormData) {
  const { supabase } = await getContext();
  await supabase.from("tasks").update({ status: String(formData.get("status")), updated_at: new Date().toISOString() }).eq("id", String(formData.get("id")));
  revalidatePath("/app/tasks");
}

export async function deleteFile(formData: FormData) {
  const { supabase } = await getContext();
  const id = String(formData.get("id"));
  const { data: f } = await supabase.from("files").select("storage_path").eq("id", id).single();
  if (f) {
    await supabase.storage.from("drive").remove([f.storage_path]);
    await supabase.from("files").delete().eq("id", id);
  }
  revalidatePath("/app/drive");
}
