"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getContext } from "@/lib/context";
import { logEvent, describeError, isNextSignal } from "@/lib/log";

/**
 * Pembungkus aksi server: setiap error dicatat ke app_logs (sumber = nama aksi) lalu
 * diteruskan ke error boundary halaman — tidak ada lagi "hang" tanpa pesan.
 * Sinyal internal Next (redirect/notFound) diteruskan apa adanya.
 */
function guarded<T extends (fd: FormData) => Promise<void>>(name: string, fn: T): T {
  return (async (fd: FormData): Promise<void> => {
    const t0 = Date.now();
    try {
      await fn(fd);
    } catch (e) {
      if (isNextSignal(e)) throw e;
      const { message, detail } = describeError(e);
      const input: Record<string, string> = {};
      fd.forEach((v, k) => { if (typeof v === "string" && !/secret|password|key/i.test(k)) input[k] = v.slice(0, 200); });
      await logEvent("error", `action:${name}`, message, { ...detail, input, ms: Date.now() - t0 });
      throw new Error(`${name} gagal: ${message}`);
    }
  }) as T;
}

async function _switchProject(formData: FormData) {
  const id = String(formData.get("project_id"));
  const c = await cookies();
  c.set("pk_project", id, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/app", "layout");
  redirect("/app/project");
}

async function _openProjectSettings(formData: FormData) {
  const id = String(formData.get("project_id"));
  const c = await cookies();
  c.set("pk_project", id, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/app", "layout");
  redirect("/app/project/settings");
}

async function _updateProjectMeta(formData: FormData) {
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

async function _switchOrg(formData: FormData) {
  const id = String(formData.get("org_id"));
  const c = await cookies();
  c.set("pk_org", id, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  c.delete("pk_project");
  revalidatePath("/app");
}

async function _createProject(formData: FormData) {
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

async function _hireAgent(formData: FormData) {
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

async function _toggleBookmark(formData: FormData) {
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

async function _startConversation(formData: FormData) {
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

async function _redeemVoucher(formData: FormData) {
  const { supabase, org } = await getContext();
  if (!org) return;
  const code = String(formData.get("code") ?? "").trim();
  const { error } = await supabase.rpc("redeem_voucher", { p_org: org.id, p_code: code });
  revalidatePath("/app/billing");
  if (error) redirect(`/app/billing?error=${encodeURIComponent(error.message)}`);
  redirect("/app/billing?ok=1");
}

const normTitle = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();

async function _createTask(formData: FormData) {
  const { supabase, project, user } = await getContext();
  if (!project) return;
  const title = String(formData.get("title") ?? "").trim().replace(/\s+/g, " ");
  if (!title) return;
  const agentId = String(formData.get("agent_id") ?? "") || null;
  // deteksi input ganda: judul sama (tanpa beda huruf besar/spasi) yang belum selesai
  if (String(formData.get("force")) !== "1") {
    const { data: same } = await supabase.from("tasks").select("id,title,status").eq("project_id", project.id).ilike("title", title.replace(/[%_]/g, "\\$&")).neq("status", "done").limit(1);
    if (same?.length) {
      const q = new URLSearchParams({ dup: title, ...(agentId ? { agent: agentId } : {}) });
      redirect(`/app/tasks?${q.toString()}`);
    }
  }
  const { error } = await supabase.from("tasks").insert({ project_id: project.id, title, created_by: user.id, agent_id: agentId });
  if (error) throw error;
  revalidatePath("/app/tasks");
  redirect("/app/tasks");
}

async function _deleteTask(formData: FormData) {
  const { supabase, project } = await getContext();
  if (!project) return;
  const { error } = await supabase.from("tasks").delete().eq("id", String(formData.get("id"))).eq("project_id", project.id);
  if (error) throw error;
  revalidatePath("/app/tasks");
  revalidatePath("/app/project");
}

/** Hapus tugas ganda: untuk judul yang sama, simpan yang paling lama dibuat, hapus sisanya. */
async function _dedupeTasks() {
  const { supabase, project } = await getContext();
  if (!project) return;
  const { data } = await supabase.from("tasks").select("id,title,created_at").eq("project_id", project.id).order("created_at");
  const seen = new Set<string>();
  const drop: string[] = [];
  for (const t of data ?? []) { const k = normTitle(t.title); if (seen.has(k)) drop.push(t.id); else seen.add(k); }
  if (drop.length) {
    const { error } = await supabase.from("tasks").delete().in("id", drop).eq("project_id", project.id);
    if (error) throw error;
  }
  revalidatePath("/app/tasks");
  revalidatePath("/app/project");
}

async function _moveTask(formData: FormData) {
  const { supabase } = await getContext();
  const { error } = await supabase.from("tasks").update({ status: String(formData.get("status")), updated_at: new Date().toISOString() }).eq("id", String(formData.get("id")));
  if (error) throw error;
  revalidatePath("/app/tasks");
}

async function _deleteFile(formData: FormData) {
  const { supabase } = await getContext();
  const id = String(formData.get("id"));
  const { data: f } = await supabase.from("files").select("storage_path").eq("id", id).single();
  if (f) {
    await supabase.storage.from("drive").remove([f.storage_path]);
    await supabase.from("files").delete().eq("id", id);
  }
  revalidatePath("/app/drive");
  revalidatePath("/app/project/drive");
}

// ---------- Project: hapus / ubah nama / pengaturan ----------
async function _deleteProject(formData: FormData) {
  const { supabase, projects, org } = await getContext();
  const id = String(formData.get("project_id"));
  // bersihkan file storage milik project (DB akan cascade sendiri)
  const { data: files } = await supabase.from("files").select("storage_path").eq("project_id", id);
  if (files?.length) await supabase.storage.from("drive").remove(files.map((f) => f.storage_path));
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw error;
  await logEvent("info", "action:deleteProject", `Project ${id} dihapus`, { files: files?.length ?? 0 }, org?.id);
  const c = await cookies();
  const next = projects.find((p) => p.id !== id);
  if (next) c.set("pk_project", next.id, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  else c.delete("pk_project");
  revalidatePath("/app", "layout");
  redirect("/app");
}

async function _renameProject(formData: FormData) {
  const { supabase } = await getContext();
  const id = String(formData.get("project_id"));
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await supabase.from("projects").update({ name }).eq("id", id);
  revalidatePath("/app", "layout");
}

async function _updateProjectSettings(formData: FormData) {
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

async function _removeBrandAsset(formData: FormData) {
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
async function _toggleProjectTool(formData: FormData) {
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
async function _removeAgentFromProject(formData: FormData) {
  const { supabase, project } = await getContext();
  if (!project) return;
  await supabase.from("project_agents").delete().eq("project_id", project.id).eq("agent_id", String(formData.get("agent_id")));
  revalidatePath("/app/project/agents");
  revalidatePath("/app/project");
}

// ---------- Kunci API organisasi ----------
async function _saveApiKey(formData: FormData) {
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

async function _deleteApiKey(formData: FormData) {
  const { supabase, org } = await getContext();
  if (!org) return;
  await supabase.from("org_api_keys").delete().eq("org_id", org.id).eq("provider", String(formData.get("provider")));
  revalidatePath("/app/settings/api-keys");
}

// ---------- Skill & pengetahuan agent ----------
async function _toggleAgentSkill(formData: FormData) {
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

async function _deleteKnowledge(formData: FormData) {
  const { supabase } = await getContext();
  await supabase.from("agent_knowledge").delete().eq("id", String(formData.get("id")));
  revalidatePath(`/app/agent/${String(formData.get("slug"))}`);
}

async function _addKnowledgeManual(formData: FormData) {
  const { supabase, org, user } = await getContext();
  if (!org) return;
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  if (!title || !content) return;
  await supabase.from("agent_knowledge").insert({ org_id: org.id, agent_id: String(formData.get("agent_id")), title, content, created_by: user.id });
  revalidatePath(`/app/agent/${String(formData.get("slug"))}`);
}

async function _setChatModel(formData: FormData) {
  const { supabase, org } = await getContext();
  if (!org) return;
  const { error } = await supabase.from("organizations").update({ chat_model: String(formData.get("model_id")) }).eq("id", org.id);
  if (error) redirect(`/app/settings/model?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/app", "layout");
  redirect("/app/settings/model?ok=1");
}

async function _setFallbackModel(formData: FormData) {
  const { supabase, org } = await getContext();
  if (!org) return;
  const id = String(formData.get("fallback_id") ?? "");
  const { error } = await supabase.from("organizations").update({ fallback_model: id || null }).eq("id", org.id);
  if (error) redirect(`/app/settings/model?error=${encodeURIComponent(/fallback_model/.test(error.message) ? "Jalankan migrasi 0013 dulu di Pengaturan → Pembaruan." : error.message)}`);
  revalidatePath("/app", "layout");
  redirect("/app/settings/model?ok=1");
}

// ---------- Ekspor terbungkus (dengan logging) ----------
export const switchProject = guarded("switchProject", _switchProject);
export const updateProjectMeta = guarded("updateProjectMeta", _updateProjectMeta);
export const switchOrg = guarded("switchOrg", _switchOrg);
export const createProject = guarded("createProject", _createProject);
export const hireAgent = guarded("hireAgent", _hireAgent);
export const toggleBookmark = guarded("toggleBookmark", _toggleBookmark);
export const startConversation = guarded("startConversation", _startConversation);
export const redeemVoucher = guarded("redeemVoucher", _redeemVoucher);
export const createTask = guarded("createTask", _createTask);
export const moveTask = guarded("moveTask", _moveTask);
export const deleteTask = guarded("deleteTask", _deleteTask);
export const dedupeTasks = guarded("dedupeTasks", _dedupeTasks as (fd: FormData) => Promise<void>);
export const deleteFile = guarded("deleteFile", _deleteFile);
export const deleteProject = guarded("deleteProject", _deleteProject);
export const renameProject = guarded("renameProject", _renameProject);
export const updateProjectSettings = guarded("updateProjectSettings", _updateProjectSettings);
export const removeBrandAsset = guarded("removeBrandAsset", _removeBrandAsset);
export const toggleProjectTool = guarded("toggleProjectTool", _toggleProjectTool);
export const removeAgentFromProject = guarded("removeAgentFromProject", _removeAgentFromProject);
export const saveApiKey = guarded("saveApiKey", _saveApiKey);
export const deleteApiKey = guarded("deleteApiKey", _deleteApiKey);
export const toggleAgentSkill = guarded("toggleAgentSkill", _toggleAgentSkill);
export const deleteKnowledge = guarded("deleteKnowledge", _deleteKnowledge);
export const addKnowledgeManual = guarded("addKnowledgeManual", _addKnowledgeManual);
export const setChatModel = guarded("setChatModel", _setChatModel);
export const setFallbackModel = guarded("setFallbackModel", _setFallbackModel);
export const openProjectSettings = guarded("openProjectSettings", _openProjectSettings);

async function _clearLogs() {
  const { supabase, org } = await getContext();
  if (!org) return;
  await supabase.from("app_logs").delete().eq("org_id", org.id);
  revalidatePath("/app/settings/logs");
}
export const clearLogs = guarded("clearLogs", _clearLogs as (fd: FormData) => Promise<void>);

// ---------- Kemampuan agent (disetujui admin organisasi) ----------
async function requireOrgAdmin() {
  const ctx = await getContext();
  if (!ctx.org) throw new Error("Organisasi tidak ditemukan");
  const { data: m } = await ctx.supabase.from("org_members").select("role").eq("org_id", ctx.org.id).eq("user_id", ctx.user.id).maybeSingle();
  if (!m || !["owner", "admin"].includes(m.role)) throw new Error("Hanya owner/admin organisasi yang bisa menyetujui kemampuan");
  return ctx as typeof ctx & { org: NonNullable<typeof ctx.org> };
}

async function _reviewCapabilityRequest(formData: FormData) {
  const { supabase, org, user } = await requireOrgAdmin();
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision")); // approve | reject | done
  const note = String(formData.get("note") ?? "").trim() || null;
  const { data: req, error: rErr } = await supabase.from("capability_requests").select("*").eq("id", id).eq("org_id", org.id).single();
  if (rErr || !req) throw new Error(rErr?.message ?? "Permintaan tidak ditemukan");
  let status = decision === "reject" ? "rejected" : decision === "done" ? "done" : "approved";
  if (decision === "approve") {
    if (req.kind === "builtin" && req.capability_key) {
      const { error } = await supabase.from("org_capabilities").upsert({ org_id: org.id, capability_key: req.capability_key, approved_by: user.id }, { onConflict: "org_id,capability_key" });
      if (error) throw new Error(error.message);
    } else if (req.kind === "http" && req.spec) {
      const { validateHttpSpec } = await import("@/lib/capabilities");
      const err = validateHttpSpec(req.spec);
      if (err) throw new Error(`Spesifikasi HTTP tidak aman: ${err}`);
      const slug = String(req.title).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "aksi";
      const key = `http_${slug}_${id.slice(0, 6)}`;
      const { error } = await supabase.from("capabilities").upsert({ key, name: req.title, description: req.reason, kind: "http", risk: "medium", org_id: org.id, spec: req.spec }, { onConflict: "key" });
      if (error) throw new Error(error.message);
      const { error: e2 } = await supabase.from("org_capabilities").upsert({ org_id: org.id, capability_key: key, approved_by: user.id }, { onConflict: "org_id,capability_key" });
      if (e2) throw new Error(e2.message);
    } else {
      status = "needs_dev";
    }
  }
  const { error } = await supabase.from("capability_requests").update({ status, review_note: note, reviewed_by: user.id, reviewed_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
  if (req.conversation_id && (status === "approved" || status === "rejected")) {
    await supabase.from("messages").insert({ conversation_id: req.conversation_id, role: "assistant", content: status === "approved" ? `✅ Admin menyetujui kemampuan **${req.title}**. Silakan ulangi permintaanmu — sekarang saya bisa mengerjakannya.` : `❌ Admin menolak kemampuan **${req.title}**${note ? `: ${note}` : "."}` });
  }
  revalidatePath("/app/settings/capabilities");
  revalidatePath("/app", "layout");
}

async function _toggleCapability(formData: FormData) {
  const { supabase, org, user } = await requireOrgAdmin();
  const key = String(formData.get("key"));
  if (String(formData.get("enable")) === "1") {
    const { error } = await supabase.from("org_capabilities").upsert({ org_id: org.id, capability_key: key, approved_by: user.id }, { onConflict: "org_id,capability_key" });
    if (error) throw new Error(error.message);
  } else {
    await supabase.from("org_capabilities").delete().eq("org_id", org.id).eq("capability_key", key);
  }
  revalidatePath("/app/settings/capabilities");
}

async function _deleteHttpCapability(formData: FormData) {
  const { supabase, org } = await requireOrgAdmin();
  await supabase.from("capabilities").delete().eq("org_id", org.id).eq("key", String(formData.get("key")));
  revalidatePath("/app/settings/capabilities");
}

export const reviewCapabilityRequest = guarded("reviewCapabilityRequest", _reviewCapabilityRequest);
export const toggleCapability = guarded("toggleCapability", _toggleCapability);
export const deleteHttpCapability = guarded("deleteHttpCapability", _deleteHttpCapability);

// ---------- Peserta chat kolaborasi ----------
async function _addConversationAgent(formData: FormData) {
  const { supabase, user } = await getContext();
  const conv = String(formData.get("conversation_id"));
  const { data: c } = await supabase.from("conversations").select("project_id").eq("id", conv).single();
  const project = c ? { id: c.project_id as string } : null;
  const agentId = String(formData.get("agent_id"));
  const { error } = await supabase.from("conversation_agents").upsert({ conversation_id: conv, agent_id: agentId, added_by: user.id }, { onConflict: "conversation_id,agent_id" });
  if (error) throw new Error(/conversation_agents/.test(error.message) ? "Fitur chat kolaborasi belum aktif — jalankan migrasi 0011 di Pengaturan → Pembaruan." : error.message);
  if (project) await supabase.from("project_agents").upsert({ project_id: project.id, agent_id: agentId, hired_by: user.id }, { onConflict: "project_id,agent_id" });
  revalidatePath(`/app/chat/${conv}`);
}

async function _removeConversationAgent(formData: FormData) {
  const { supabase } = await getContext();
  const conv = String(formData.get("conversation_id"));
  const agentId = String(formData.get("agent_id"));
  const { data: c } = await supabase.from("conversations").select("agent_id").eq("id", conv).single();
  if (c?.agent_id === agentId) throw new Error("Agent pemilik percakapan tidak bisa dikeluarkan.");
  await supabase.from("conversation_agents").delete().eq("conversation_id", conv).eq("agent_id", agentId);
  revalidatePath(`/app/chat/${conv}`);
}

export const addConversationAgent = guarded("addConversationAgent", _addConversationAgent);
export const removeConversationAgent = guarded("removeConversationAgent", _removeConversationAgent);

// ---------- Chat diskusi project ----------
async function _startGroupChat(formData: FormData) {
  const { supabase, project, user } = await getContext();
  if (!project) redirect("/app/projects");
  const ids = formData.getAll("agent_id").map(String).filter(Boolean);
  if (!ids.length) redirect("/app/project/chat?err=agent");
  const topic = String(formData.get("title") ?? "").trim();
  const { data, error } = await supabase
    .from("conversations")
    .insert({ project_id: project.id, agent_id: ids[0], user_id: user.id, title: topic || "Percakapan baru" })
    .select("id")
    .single();
  if (error) throw error;
  await supabase.from("conversation_agents").upsert(ids.map((agent_id) => ({ conversation_id: data.id, agent_id, added_by: user.id })), { onConflict: "conversation_id,agent_id" });
  revalidatePath("/app/project/chat");
  redirect(`/app/chat/${data.id}`);
}

async function _deleteConversation(formData: FormData) {
  const { supabase, project } = await getContext();
  if (!project) return;
  const { error } = await supabase.from("conversations").delete().eq("id", String(formData.get("id"))).eq("project_id", project.id);
  if (error) throw error;
  revalidatePath("/app/project/chat");
  revalidatePath("/app/project");
}

export const startGroupChat = guarded("startGroupChat", _startGroupChat);
export const deleteConversation = guarded("deleteConversation", _deleteConversation);
