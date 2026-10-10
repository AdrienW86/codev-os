"use client";

// Panneau de résultats UNIQUE de l'assistant : <dialog> natif (focus piégé, Échap, arrière-plan inerte).
// Modale sur ordinateur, plein écran sur smartphone ; le défilement est interne au panneau et la page
// derrière ne défile pas. À la fermeture, le focus revient à l'élément qui l'a ouvert.
// Un nouveau résultat remplace le contenu : jamais de modales empilées.
import { useEffect, useId, useRef, type ReactNode } from "react";

export function ResultDialog({ open, onClose, title, subtitle, busy, children, footer, returnFocus }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string; busy?: boolean; children: ReactNode; footer: ReactNode;
  /** Élément à refocaliser à la fermeture (déclencheur mémorisé par l'appelant), à défaut l'élément actif à l'ouverture. */
  returnFocus?: () => HTMLElement | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      opener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
      element.showModal();
      document.documentElement.style.overflow = "hidden";
      heading.current?.focus();
    } else if (!open && element.open) element.close();
  }, [open]);

  useEffect(() => () => { document.documentElement.style.overflow = ""; }, []);

  function handleClose() {
    document.documentElement.style.overflow = "";
    onClose();
    // Retour du focus à l'élément d'origine s'il est toujours présent et visible.
    const target = returnFocus?.() ?? opener.current;
    if (target?.isConnected) requestAnimationFrame(() => target.focus());
  }

  return (
    <dialog ref={dialog} aria-labelledby={titleId} onClose={handleClose}
      onCancel={(event) => { event.preventDefault(); dialog.current?.close(); }}
      className="m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-background p-0 text-foreground backdrop:bg-black/70 sm:m-auto sm:h-auto sm:max-h-[90dvh] sm:w-[min(68rem,calc(100vw-2rem))] sm:rounded-2xl sm:border sm:border-border">
      <div className="flex h-dvh flex-col sm:h-auto sm:max-h-[90dvh]">
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h2 id={titleId} ref={heading} tabIndex={-1} className="font-semibold break-words outline-none">{title}</h2>
            {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
          </div>
          <button type="button" onClick={() => dialog.current?.close()} aria-label="Fermer le panneau de résultats" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-lg text-muted hover:text-foreground">
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div aria-busy={busy} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">{children}</div>
        <div className="border-t border-border bg-surface px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">{footer}</div>
      </div>
    </dialog>
  );
}
