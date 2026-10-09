import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

// Boutons et liens d’action partagés : mêmes hauteurs, rayons, focus et états sur toute l’application.
export type ActionVariant = "primary" | "secondary" | "ghost" | "danger";

const base = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const variants: Record<ActionVariant, string> = {
  primary: "bg-accent font-semibold text-background hover:bg-accent/90",
  secondary: "border border-border text-foreground hover:border-accent/50 hover:bg-white/[0.03]",
  ghost: "text-muted hover:bg-white/5 hover:text-foreground",
  danger: "border border-red-400/40 text-red-300 hover:bg-red-400/10",
};

export function actionClass(variant: ActionVariant = "secondary", className = "") {
  return `${base} ${variants[variant]} ${className}`;
}

type CommonProps = { children: ReactNode; variant?: ActionVariant; className?: string };
type LinkProps = CommonProps & { href: string; "aria-label"?: string };
type ButtonProps = CommonProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">;

/** Lien ou bouton d’action ; un `href` produit toujours un vrai lien. */
export function Action(props: LinkProps | ButtonProps) {
  const { children, variant = "secondary", className = "", ...rest } = props;
  if ("href" in rest && typeof rest.href === "string") {
    return <Link href={rest.href} aria-label={rest["aria-label"]} className={actionClass(variant, className)}>{children}</Link>;
  }
  return <button type="button" {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)} className={actionClass(variant, className)}>{children}</button>;
}

export function PrimaryAction(props: Omit<LinkProps, "variant"> | Omit<ButtonProps, "variant">) {
  return <Action {...props} variant="primary" />;
}

export function SecondaryAction(props: Omit<LinkProps, "variant"> | Omit<ButtonProps, "variant">) {
  return <Action {...props} variant="secondary" />;
}
