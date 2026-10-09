"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * Socle commun des modales et panneaux : `<dialog>` natif (focus piégé, Escape),
 * fermeture par bouton ×, clic extérieur ou Escape. Toujours une sortie.
 */
function BaseDialog({ open, onClose, title, description, children, footer, variant, size = "md", onBack }: {
  open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode;
  variant: "modal" | "drawer"; size?: "sm" | "md" | "lg"; onBack?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const widths = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl" };
  const drawerWidths = { sm: "sm:max-w-md", md: "sm:max-w-xl", lg: "sm:max-w-3xl" };
  const placement = variant === "drawer"
    // Panneau latéral à droite ; plein écran en bas sur mobile.
    ? `mt-auto mb-0 h-[92dvh] max-h-none w-full max-w-none rounded-t-2xl sm:my-0 sm:mr-0 sm:ml-auto sm:h-dvh sm:max-h-dvh ${drawerWidths[size]} sm:rounded-none sm:rounded-l-2xl`
    : `m-auto max-h-[90dvh] w-[calc(100%-2rem)] ${widths[size]} rounded-2xl`;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // Ignore la fermeture d’une modale imbriquée (React propage l’événement au parent).
      onClose={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onClick={(event) => { if (event.target === ref.current) ref.current?.close(); }}
      className={`${placement} flex-col overflow-hidden border border-border bg-surface p-0 text-foreground backdrop:bg-black/70 open:flex`}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex min-w-0 items-start gap-2">
          {onBack && (
            <button type="button" onClick={onBack} aria-label="Retour" className="-ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-foreground">
              <span aria-hidden="true" className="text-lg">←</span>
            </button>
          )}
          <div className="min-w-0 pt-2">
            <h2 id={titleId} className="font-semibold">{title}</h2>
            {description && <div className="mt-1 text-sm text-muted">{description}</div>}
          </div>
        </div>
        <button type="button" onClick={() => ref.current?.close()} aria-label="Fermer" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-foreground">
          <span aria-hidden="true" className="text-xl leading-none">×</span>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
      {footer && <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border px-5 py-4">{footer}</div>}
    </dialog>
  );
}

type DialogProps = { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg"; onBack?: () => void };

export function Dialog(props: DialogProps) {
  return <BaseDialog {...props} variant="modal" />;
}

/** Panneau de détail : consulter sans perdre le contexte, puis « Ouvrir la fiche complète ». */
export function DetailDrawer(props: DialogProps) {
  return <BaseDialog {...props} variant="drawer" />;
}

export function ConfirmationDialog({ open, title, message, confirmLabel = "Confirmer", cancelLabel = "Annuler", tone = "primary", onConfirm, onCancel }: {
  open: boolean; title: string; message: ReactNode; confirmLabel?: string; cancelLabel?: string; tone?: "primary" | "danger";
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <BaseDialog
      open={open}
      onClose={onCancel}
      title={title}
      variant="modal"
      size="sm"
      footer={<>
        <button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-border px-4 text-sm font-medium hover:border-accent/50">{cancelLabel}</button>
        <button type="button" onClick={onConfirm} className={`min-h-11 rounded-lg px-4 text-sm font-semibold ${tone === "danger" ? "border border-red-400/40 text-red-300 hover:bg-red-400/10" : "bg-accent text-background hover:bg-accent/90"}`}>{confirmLabel}</button>
      </>}
    >
      <div className="text-sm leading-6 text-muted">{message}</div>
    </BaseDialog>
  );
}
