import { useEffect, useRef } from 'react';

export function LogView({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLPreElement>(null);

  // Keep the newest output visible while the run streams.
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <pre ref={ref} className="log-view" aria-live="polite">
      {lines.join('\n')}
    </pre>
  );
}
