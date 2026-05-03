'use client';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-[50vh] flex items-center justify-center p-8">
      <div className="max-w-xl w-full bg-red-900/30 border border-red-700 rounded-xl p-6 space-y-4">
        <h2 className="text-xl font-bold text-red-300">Something went wrong</h2>
        <pre className="text-sm text-red-200 whitespace-pre-wrap break-words bg-red-950/50 rounded p-4 overflow-auto max-h-64">
          {error.message}
        </pre>
        {error.digest && (
          <p className="text-xs text-red-400">Digest: {error.digest}</p>
        )}
        <button
          onClick={reset}
          className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
