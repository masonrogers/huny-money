/**
 * Display formatters used across dashboard views. Keep these consistent so
 * numbers line up in tables and don't jitter on tick updates.
 */

const usdShortFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const usdSubcentFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 6,
});

const pctFmt = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numFmt = new Intl.NumberFormat("en-US");

const compactFmt = new Intl.NumberFormat("en-US", { notation: "compact" });

export function formatUsd(n: number | null | undefined): string {
  if (n == null) return "—";
  if (Math.abs(n) < 1) return usdSubcentFmt.format(n);
  return usdShortFmt.format(n);
}

export function formatPct(n: number | null | undefined, signed = false): string {
  if (n == null) return "—";
  const formatted = pctFmt.format(n / 100);
  return signed && n > 0 ? `+${formatted}` : formatted;
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  return numFmt.format(n);
}

export function formatCompact(n: number | null | undefined): string {
  if (n == null) return "—";
  return compactFmt.format(n);
}

export function formatRelativeTime(date: Date | string | null | undefined, now: Date = new Date()): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = now.getTime() - d.getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

export function formatTimestamp(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mr = m % 60;
  return mr > 0 ? `${h}h ${mr}m` : `${h}h`;
}
