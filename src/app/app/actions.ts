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

// ---------- Project: hapus / ubah nama / pengaturan ----------
export async function deleteProject(formData: FormData) {
  const { supabase, projects } = await getContext();
  const id = String(formData.get("project_id"));
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw error;
  const c = await cookies();
  const next = projects.find((p) => p.id !== id);
  if (next) c.set("pk_project", next.id, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  else c.delete("pk_project");
  revalidatePath("/app", "layout");
  redirect("/app");
}

export async function renameProject(formData: FormData) {
  const { supabase } = await getContext();
  const id = String(formData.get("project_id"));
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await supabase.from("projects").update({ name }).eq("id", id);
  revalidatePath("/app", "layout");
}

export async function updateProjectSettings(formData: FormData) {
  const { supabase, project } = await getContext();
  if (!project) return;
  const brand = { ...(project.brand ?? {}) } as Record<string, unknown>;
  const primary = String(formData.get("primary") ?? "").trim();
  const secondary = String(formData.get("secondary") ?? "").trim();
  if (primary) brand.primary = primary;
  if (secondary) brand.secondary = secondary;
  const patch: Record<string, unknown> = { brand };
  const str = (k: string) => (formData.has(k) ? String(formData.get(k) ?? "").trim() : undefined);
  const name = str("name"); if (name) patch.name = name;
  for (const k of ["tagline", "description", "website", "category", "status"]) {
    const v = str(k); if (v !== undefined) patch[k] = v || null;
  }
  if (formData.has("due_date")) patch.due_date = str("due_date") || null;
  if (patch.status === null) delete patch.status;
  const { error } = await supabase.from("projects").update(patch).eq("id", project.id);
  if (error) throw error;
  revalidatePath("/app", "layout");
}

export async function removeBrandAsset(formData: FormData) {
  const { supabase, project } = await getContext();
  if (!project) return;
  const path = String(formData.get("path"));
  const brand = { ...(project.brand ?? {}) } as { assets?: { name: string; path: string; url: string }[] };
  brand.assets = (brand.assets ?? []).filter((a) => a.path !== path);
  await supabase.storage.from("brand").remove([path]);
  await supabase.from("projects").update({ brand }).eq("id", project.id);
  revalidatePath("/app/project/settings");
}

// ---------- Tools per project ----------
export async function toggleProjectTool(formData: FormData) {
  const { supabase, project, user } = await getContext();
  if (!project) return;
  const key = String(formData.get("tool_key"));
  const enable = String(formData.get("enable")) === "1";
  if (enable) await supabase.from("project_tools").upsert({ project_id: project.id, tool_key: key, enabled_by: user.id }, { onConflict: "project_id,tool_key" });
  else await supabase.from("project_tools").delete().eq("project_id", project.id).eq("tool_key", key);
  revalidatePath("/app/project/tools");
  revalidatePath("/app/project");
}

// ---------- Pegawai di project ----------
export async function removeAgentFromProject(formData: FormData) {
  const { supabase, project } = await getContext();
  if (!project) return;
  await supabase.from("project_agents").delete().eq("project_id", project.id).eq("agent_id", String(formData.get("agent_id")));
  revalidatePath("/app/project/agents");
  revalidatePath("/app/project");
}

// ---------- Kunci API organisasi ----------
export async function saveApiKey(formData: FormData) {
  const { supabase, org, user } = await getContext();
  if (!org) return;
  const provider = String(formData.get("provider"));
  const secret = String(formData.get("secret") ?? "").trim();
  if (!secret) return;
  const { error } = await supabase.from("org_api_keys").upsert(
    { org_id: org.id, provider, secret, label: String(formData.get("label") ?? ""), created_by: user.id },
    { onConflict: "org_id,provider" }
  );
  if (error) redirect(`/app/settings/api-keys?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/app/settings/api-keys");
  redirect("/app/settings/api-keys?ok=1");
}

export async function deleteApiKey(formData: FormData) {
  const { supabase, org } = await getContext();
  if (!org) return;
  await supabase.from("org_api_keys").delete().eq("org_id", org.id).eq("provider", String(formData.get("provider")));
  revalidatePath("/app/settings/api-keys");
}

// ---------- Skill & pengetahuan agent ----------
export async function toggleAgentSkill(formData: FormData) {
  const { supabase, org } = await getContext();
  if (!org) return;
  const agentId = String(formData.get("agent_id"));
  const key = String(formData.get("skill_key"));
  const slug = String(formData.get("slug"));
  const enable = String(formData.get("enable")) === "1";
  if (enable) await supabase.from("agent_skills").upsert({ org_id: org.id, agent_id: agentId, skill_key: key }, { onConflict: "org_id,agent_id,skill_key" });
  else await supabase.from("agent_skills").delete().eq("org_id", org.id).eq("agent_id", agentId).eq("skill_key", key);
  revalidatePath(`/app/agent/${slug}`);
}

export async function deleteKnowledge(formData: FormData) {
  const { supabase } = await getContext();
  await supabase.from("agent_knowledge").delete().eq("id", String(formData.get("id")));
  revalidatePath(`/app/agent/${String(formData.get("slug"))}`);
}

export async function addKnowledgeManual(formData: FormData) {
  const { supabase, org, user } = await getContext();
  if (!org) return;
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  if (!title || !content) return;
  await supabase.from("agent_knowledge").insert({ org_id: org.id, agent_id: String(formData.get("agent_id")), title, content, created_by: user.id });
  revalidatePath(`/app/agent/${String(formData.get("slug"))}`);
}

export async function setChatModel(formData: FormData) {
  const { supabase, org } = await getContext();
  if (!org) return;
  const { error } = await supabase.from("organizations").update({ chat_model: String(formData.get("model_id")) }).eq("id", org.id);
  if (error) redirect(`/app/settings/model?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/app", "layout");
  redirect("/app/settings/model?ok=1");
}
