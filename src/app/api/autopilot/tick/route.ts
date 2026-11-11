import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { logEvent, describeError } from "@/lib/log";
import { SupabaseStore } from "@/lib/autopilot/supabase-store";
import { buildEnv } from "@/lib/autopilot/context";
import { tick } from "@/lib/autopilot/engine";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Kerjakan antrean Asisten di server aplikasi ini (tanpa pekerja NAS) — untuk misi yang tidak butuh
 * jaringan rumah (riset, konten, presentasi). Dijalankan dengan hak user yang login (RLS berlaku);
 * hanya owner/admin, karena run bisa mengeksekusi aksi yang sudah disetujui.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: orgs } = await supabase.from("organizations").select("id").order("created_at");
  const wanted = (await cookies()).get("pk_org")?.value;
  const orgId = (orgs ?? []).find((o) => o.id === wanted)?.id ?? orgs?.[0]?.id;
  if (!orgId) return NextResponse.json({ error: "Organisasi tidak ditemukan" }, { status: 404 });
  const { data: me } = await supabase.from("org_members").select("role").eq("org_id", orgId).eq("user_id", user.id).maybeSingle();
  if (!me || !["owner", "admin"].includes(me.role)) return NextResponse.json({ error: "Hanya owner/admin organisasi." }, { status: 403 });

  try {
    const store = new SupabaseStore(supabase, { workerName: "web", orgId, heartbeat: false });
    const result = await tick({ store, buildEnv: (run, mission) => buildEnv(supabase, run, mission) }, { deadline: Date.now() + 230_000, maxRuns: 3 });
    return NextResponse.json(result);
  } catch (e) {
    const { message, detail } = describeError(e);
    await logEvent("error", "api:autopilot:tick", message, detail, orgId);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
