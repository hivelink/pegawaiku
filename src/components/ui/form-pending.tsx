"use client";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

/** Spinner yang muncul di dalam tombol selama form induknya sedang dikirim (server action). */
export function FormPending({ size = 14 }: { size?: number }) {
  const { pending } = useFormStatus();
  return pending ? <Loader2 data-pending size={size} className="shrink-0 animate-spin" aria-label="Memproses" /> : null;
}
