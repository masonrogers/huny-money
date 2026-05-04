"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bitcoin, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get("redirect") ?? "/";
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.push(redirect);
        router.refresh();
        return;
      }
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Login failed");
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-svh w-full flex items-center justify-center px-4 bg-[var(--color-bg)]">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="size-10 rounded-lg bg-[var(--color-accent-bg)] grid place-items-center">
            <Bitcoin className="size-5 text-[var(--color-accent)]" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight">Huny Money</h1>
            <p className="text-xs text-[var(--color-text-muted)]">v3.0 dashboard</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="surface-1 rounded-lg p-6 space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">
              Operator password
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              required
              className="mt-2 w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm focus:border-[var(--color-accent)] focus:outline-none placeholder:text-[var(--color-text-faint)]"
              placeholder="••••••••"
              disabled={busy}
            />
          </label>

          {error && (
            <div className="text-xs text-[var(--color-danger)] bg-[var(--color-danger-bg)] border border-[var(--color-danger)]/30 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            size="md"
            className="w-full"
            disabled={busy || !password}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <p className="text-[0.65rem] text-[var(--color-text-faint)] text-center mt-5">
          Restricted access · single operator · v3.0
        </p>
      </div>
    </div>
  );
}
