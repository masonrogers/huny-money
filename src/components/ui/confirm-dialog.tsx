"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Confirmation dialog for destructive controls. Three flavors:
 *
 * - Single-confirm: just a confirm/cancel button.
 * - Double-confirm: two-step (confirm first, then a second screen with
 *   another confirm). Used for close-all.
 * - Typed-phrase: triple-confirm with a typed phrase that must match
 *   exactly. Used for mode toggle and convert-to-BTC-hold.
 *
 * Tone determines the accent (warning vs danger).
 */

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  /** Phrase the operator must type verbatim. If omitted, no typed-phrase step. */
  typedPhrase?: string;
  /** Require an explicit second-screen confirmation before allowing submit. */
  doubleConfirm?: boolean;
  /** Tone of the destructive action. */
  tone?: "warning" | "danger";
  /** Label on the action button. */
  confirmLabel?: string;
  /** Called with the confirmation payload (typedPhrase + flags) when the
   * operator confirms. Should return a promise; the dialog stays mounted
   * until the promise resolves. */
  onConfirm: (payload: {
    confirmed: true;
    confirmedAgain?: true;
    typedPhrase?: string;
  }) => Promise<void> | void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  typedPhrase,
  doubleConfirm,
  tone = "warning",
  confirmLabel = "Confirm",
  onConfirm,
}: ConfirmDialogProps) {
  const [step, setStep] = React.useState<1 | 2>(1);
  const [phrase, setPhrase] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setStep(1);
      setPhrase("");
      setBusy(false);
    }
  }, [open]);

  const phraseMatches = !typedPhrase || phrase.trim().toLowerCase() === typedPhrase.toLowerCase();
  const canSubmit =
    !busy &&
    phraseMatches &&
    (!doubleConfirm || step === 2) &&
    (!typedPhrase || phrase.length > 0);

  async function handleConfirm() {
    if (doubleConfirm && step === 1) {
      setStep(2);
      return;
    }
    if (!canSubmit) return;
    setBusy(true);
    try {
      await onConfirm({
        confirmed: true,
        ...(doubleConfirm ? { confirmedAgain: true as const } : {}),
        ...(typedPhrase ? { typedPhrase: phrase } : {}),
      });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  const accent =
    tone === "danger"
      ? "var(--color-danger)"
      : "var(--color-warning)";
  const accentBg =
    tone === "danger" ? "var(--color-danger-bg)" : "var(--color-warning-bg)";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-5 max-w-md">
        <div className="flex items-start gap-3 mb-3">
          <div
            className="size-8 rounded-md grid place-items-center shrink-0"
            style={{ background: accentBg, color: accent }}
          >
            <AlertTriangle className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="mt-1">{description}</DialogDescription>
          </div>
        </div>

        {doubleConfirm && step === 2 && (
          <div
            className="rounded-md border px-3 py-2 mb-3 text-xs"
            style={{ borderColor: accent + "55", background: accentBg, color: accent }}
          >
            Confirm one more time to proceed. This action cannot be undone.
          </div>
        )}

        {typedPhrase && (
          <label className="block mb-3">
            <span className="text-xs font-medium text-[var(--color-text-secondary)]">
              Type{" "}
              <code className="text-[var(--color-text-primary)]">
                &quot;{typedPhrase}&quot;
              </code>{" "}
              to proceed
            </span>
            <input
              type="text"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              autoFocus
              className={cn(
                "mt-1.5 w-full px-3 py-2 bg-[var(--color-bg)] border rounded-md text-sm focus:outline-none placeholder:text-[var(--color-text-faint)]",
                phraseMatches && phrase.length > 0
                  ? "border-[var(--color-success)]"
                  : "border-[var(--color-border)] focus:border-[var(--color-accent)]",
              )}
              placeholder={typedPhrase}
              disabled={busy}
            />
          </label>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border)] mt-3 -mx-5 -mb-5 px-5 pb-5">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={handleConfirm}
            disabled={!canSubmit && !(doubleConfirm && step === 1 && phraseMatches)}
          >
            {busy && <Loader2 className="animate-spin" />}
            {doubleConfirm && step === 1 ? "Continue…" : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
