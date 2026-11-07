import { cn } from "@/lib/utils";
export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-border bg-card shadow-sm", className)} {...p} />;
}
