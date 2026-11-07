"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

export function UploadForm({ projectId }: { projectId: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file); fd.append("project_id", projectId);
    const res = await fetch("/api/drive/upload", { method: "POST", body: fd });
    setBusy(false);
    if (!res.ok) alert((await res.json()).error ?? "Gagal unggah");
    router.refresh();
    if (ref.current) ref.current.value = "";
  }
  return (
    <>
      <input ref={ref} type="file" className="hidden" onChange={onChange} />
      <Button onClick={() => ref.current?.click()} disabled={busy}><Upload size={16} /> {busy ? "Mengunggah…" : "Unggah file"}</Button>
    </>
  );
}
