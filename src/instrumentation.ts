export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runBootSequence } = await import('@/lib/engine/boot');
    try {
      console.log('[Huny Money] Running boot sequence...');
      const result = await runBootSequence();
      console.log('[Huny Money] Boot sequence complete:', JSON.stringify(result));
    } catch (error) {
      console.error('[Huny Money] Boot sequence failed:', error);
    }

    const { startScheduler } = await import('@/lib/engine/scheduler');
    startScheduler();
  }
}
