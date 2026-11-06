import { useEffect, useRef } from 'react';

export function LogView({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLPreElement>(null);

  // Keep the newest output visible while the run streams.
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <pre
      ref={ref}
      aria-live="polite"
      className="max-h-[28rem] overflow-auto rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap"
    >
      {lines.length > 0 ? lines.join('\n') : <span className="text-muted-foreground">No output yet.</span>}
    </pre>
  );
}
