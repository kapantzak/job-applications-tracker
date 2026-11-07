import { useId } from 'react';
import { cn } from '@/lib/utils';

// A CV page with a scan line and sparkles (SOW-0023, decision 8). Drawn with theme tokens, so it
// follows light and dark mode; `scanning` moves the line while an analysis runs.
export function CvIllustration({ scanning = false, className }: { scanning?: boolean; className?: string }) {
  const glow = useId();
  return (
    <svg viewBox="0 0 160 120" aria-hidden="true" className={cn('h-auto w-40', className)}>
      <defs>
        <linearGradient id={glow} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--primary)', stopOpacity: 0 }} />
          <stop offset="1" style={{ stopColor: 'var(--primary)', stopOpacity: 0.28 }} />
        </linearGradient>
      </defs>
      <circle cx="82" cy="62" r="54" className="fill-primary/10" />
      <rect x="40" y="26" width="60" height="78" rx="8" transform="rotate(-9 70 65)" className="fill-muted stroke-border" strokeWidth="1.5" />
      <g>
        <rect x="56" y="14" width="62" height="84" rx="8" className="fill-card stroke-border" strokeWidth="1.5" />
        <circle cx="70" cy="30" r="7" className="fill-primary/30" />
        <rect x="81" y="25" width="28" height="4" rx="2" className="fill-foreground/70" />
        <rect x="81" y="32" width="18" height="3" rx="1.5" className="fill-muted-foreground/40" />
        <rect x="64" y="47" width="46" height="3" rx="1.5" className="fill-muted-foreground/30" />
        <rect x="64" y="54" width="38" height="3" rx="1.5" className="fill-muted-foreground/30" />
        <rect x="64" y="61" width="42" height="3" rx="1.5" className="fill-muted-foreground/30" />
        <rect x="64" y="72" width="22" height="5" rx="2.5" className="fill-primary/25" />
        <rect x="89" y="72" width="17" height="5" rx="2.5" className="fill-primary/25" />
        <rect x="64" y="82" width="34" height="3" rx="1.5" className="fill-muted-foreground/30" />
      </g>
      <g className={cn(scanning && 'animate-cv-scan motion-reduce:animate-none')}>
        <rect x="52" y="44" width="70" height="16" className="opacity-100" fill={`url(#${glow})`} />
        <rect x="50" y="59" width="74" height="2" rx="1" className="fill-primary" />
      </g>
      <path d="M128 14 l2.6 6.4 6.4 2.6 -6.4 2.6 -2.6 6.4 -2.6 -6.4 -6.4 -2.6 6.4 -2.6 z" className="fill-primary" />
      <path d="M138 44 l1.4 3.6 3.6 1.4 -3.6 1.4 -1.4 3.6 -1.4 -3.6 -3.6 -1.4 3.6 -1.4 z" className="fill-primary/70" />
      <path d="M34 84 l1.8 4.2 4.2 1.8 -4.2 1.8 -1.8 4.2 -1.8 -4.2 -4.2 -1.8 4.2 -1.8 z" className="fill-primary/60" />
    </svg>
  );
}
