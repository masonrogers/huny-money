export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-2xl text-center space-y-4">
        <h1 className="text-4xl font-semibold tracking-tight">Huny Money</h1>
        <p className="text-neutral-400">
          Autonomous crypto trading bot. v2 rebuild in progress.
        </p>
        <p className="text-sm text-neutral-500">
          See <code className="text-neutral-300">STRATEGY.md</code> and{" "}
          <code className="text-neutral-300">BUILD_PLAN.md</code> for the spec
          and implementation plan.
        </p>
      </div>
    </main>
  );
}
