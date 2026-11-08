import { useEffect, useMemo, useRef } from 'react';
import {
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  GlobeIcon,
  InfoIcon,
  MailIcon,
  MessageSquareTextIcon,
  PlayIcon,
  SearchIcon,
  TerminalIcon,
  TriangleAlertIcon,
  WrenchIcon,
  type LucideIcon,
} from 'lucide-react';
import { formatLog, type LogEntry, type LogEntryKind } from '../log-format.js';
import { cn } from '@/lib/utils';

const ICONS: Record<LogEntryKind, LucideIcon> = {
  app: InfoIcon,
  stderr: TerminalIcon,
  text: ChevronRightIcon,
  start: PlayIcon,
  finish: CircleCheckIcon,
  message: MessageSquareTextIcon,
  search: SearchIcon,
  web: GlobeIcon,
  mail: MailIcon,
  command: TerminalIcon,
  tool: WrenchIcon,
  warning: TriangleAlertIcon,
  error: CircleAlertIcon,
};

const TONES: Record<NonNullable<LogEntry['tone']>, string> = {
  muted: 'text-muted-foreground',
  warning: 'text-warning-text',
  error: 'text-destructive',
};

const BOX = 'max-h-[28rem] overflow-auto rounded-lg border bg-muted/40 p-4 text-xs leading-relaxed';

// `raw` shows the log exactly as stored; otherwise agent events are turned into readable rows.
export function LogView({ lines, raw = false }: { lines: string[]; raw?: boolean }) {
  const ref = useRef<HTMLElement | null>(null);
  // One callback ref serves both the raw <pre> and the readable <div>.
  const setRef = (el: HTMLElement | null) => {
    ref.current = el;
  };
  const entries = useMemo(() => (raw ? [] : formatLog(lines)), [lines, raw]);

  // Keep the newest output visible while the run streams.
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, raw]);

  if (raw || lines.length === 0) {
    return (
      <pre ref={setRef} aria-live="polite" className={cn(BOX, 'font-mono whitespace-pre-wrap')}>
        {lines.length > 0 ? lines.join('\n') : <span className="text-muted-foreground">No output yet.</span>}
      </pre>
    );
  }

  return (
    <div ref={setRef} aria-live="polite" className={BOX}>
      {entries.length === 0 ? (
        <p className="text-muted-foreground">Nothing readable to show. Turn on raw output to see everything.</p>
      ) : (
        <ol aria-label="Run log" className="flex flex-col gap-1.5">
          {entries.map((entry, i) => {
            const Icon = ICONS[entry.kind];
            return (
              // Rows are append-only, so the index is a stable key.
              <li key={i} className={cn('flex items-start gap-2', entry.tone && TONES[entry.tone])}>
                <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0 break-words">{entry.text}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
