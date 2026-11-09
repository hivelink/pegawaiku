import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const CATEGORIES: { key: string; label: string; emoji: string }[] = [
  { key: "all", label: "Semua", emoji: "🔥" },
  { key: "graphic-designer", label: "Graphic Designer", emoji: "🎨" },
  { key: "video-editor", label: "Video Editor", emoji: "🎬" },
  { key: "marketing", label: "Marketing", emoji: "🎯" },
  { key: "sales", label: "Sales", emoji: "🤝" },
  { key: "hr", label: "HR", emoji: "🧑‍💼" },
  { key: "finance", label: "Finance", emoji: "📊" },
  { key: "management", label: "Management", emoji: "🗂️" },
  { key: "builder", label: "Builder", emoji: "🛠️" },
  { key: "engineering", label: "Engineering", emoji: "⚙️" },
  { key: "event", label: "Event", emoji: "🎉" },
  { key: "religi", label: "Religi & Pendidikan", emoji: "🕌" },
];

export function categoryLabel(key: string) {
  return CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

export function formatCredit(n: number | string) {
  return Number(n).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export function formatRupiah(n: number) {
  return "Rp " + n.toLocaleString("id-ID");
}

/** Biaya kredit per token (1 kredit = 1 USD). Sesuaikan dengan harga model. */
export const PRICING = {
  model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
  inputPerMillion: 2,   // USD (Claude Sonnet 5.5)
  outputPerMillion: 10, // USD
  markup: 1.5,          // margin platform
};

export function creditCost(inputTokens: number, outputTokens: number) {
  const usd = (inputTokens / 1e6) * PRICING.inputPerMillion + (outputTokens / 1e6) * PRICING.outputPerMillion;
  return Number((usd * PRICING.markup).toFixed(6));
}
