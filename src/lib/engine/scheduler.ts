// In-process scheduler for the three cron jobs
// Runs as part of the Next.js server process via instrumentation.ts

export function startScheduler() {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('[Scheduler] No CRON_SECRET set, skipping scheduler');
    return;
  }

  const headers = {
    'Authorization': `Bearer ${cronSecret}`,
    'Content-Type': 'application/json',
  };

  // Use internal localhost URL since we're in the same process
  const baseUrl = 'http://localhost:' + (process.env.PORT || '3000');

  async function callCron(path: string) {
    try {
      const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers });
      const data = await res.json();
      console.log(`[Scheduler] ${path}: ${res.status}`, data);
    } catch (err) {
      console.error(`[Scheduler] ${path} failed:`, err);
    }
  }

  // Timer processing: every 60 seconds
  setInterval(() => callCron('/api/cron/timers'), 60 * 1000);

  // Price checks: every 5 minutes
  setInterval(() => callCron('/api/cron/price-check'), 5 * 60 * 1000);

  // Evaluations: every 8 hours (the evaluation route itself determines if it's daily or swing)
  // Run at startup + every 8 hours. The evaluation logic internally checks if one is due.
  setInterval(() => callCron('/api/cron/evaluate'), 8 * 60 * 60 * 1000);

  // Run initial checks after a 30-second delay (let the server fully start)
  setTimeout(() => {
    callCron('/api/cron/timers');
    callCron('/api/cron/price-check');
  }, 30000);

  console.log('[Scheduler] Started - timers:60s, price-check:5m, evaluate:8h');
}
