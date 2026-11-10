import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { FormPending } from "./form-pending";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-[color,background-color,transform,opacity] duration-100 active:scale-[0.97] has-[[data-pending]]:pointer-events-none has-[[data-pending]]:opacity-70 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
  {
    variants: {
      variant: {
        default: "bg-primary text-white hover:bg-primary-2",
        accent: "bg-accent text-white hover:bg-sky-600",
        outline: "border border-border bg-card hover:bg-slate-50",
        ghost: "hover:bg-slate-100",
        danger: "bg-red-600 text-white hover:bg-red-700",
      },
      size: { sm: "h-8 px-3 text-xs", md: "h-10 px-4", lg: "h-12 px-6 text-base" },
    },
    defaultVariants: { variant: "default", size: "md" },
  }
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

/** Tombol: efek tekan saat diklik + spinner otomatis selama form (server action) diproses. */
export function Button({ className, variant, size, children, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props}><FormPending />{children}</button>;
}
export { buttonVariants };
