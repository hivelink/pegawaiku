import { cn } from "@/lib/utils";
export function Input({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn("h-10 w-full rounded-xl border border-border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-accent", className)}
      {...p}
    />
  );
}
export function Textarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn("w-full rounded-xl border border-border bg-white p-3 text-sm outline-none focus:ring-2 focus:ring-accent", className)}
      {...p}
    />
  );
}
