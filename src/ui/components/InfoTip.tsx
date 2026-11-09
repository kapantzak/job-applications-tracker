import type { ReactNode } from 'react';
import { InfoIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// Help text marks code with backticks; odd segments of the split are code.
export function renderHelp(text: string): ReactNode[] {
  return text.split('`').map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
        {part}
      </code>
    ) : (
      part
    ),
  );
}

interface InfoTipProps {
  topic: string;
  text: string;
}

// A click-to-open popover rather than a hover tooltip, so it works from the keyboard and holds longer text
// (SOW-0038 decision 1). Kept outside <label>/<legend> by callers so it never joins the field's accessible name.
export function InfoTip({ topic, text }: InfoTipProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-5 rounded-full text-muted-foreground hover:text-foreground"
          aria-label={`About ${topic}`}
        >
          <InfoIcon className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" aria-label={`About ${topic}`} className="text-sm leading-relaxed">
        <p>{renderHelp(text)}</p>
      </PopoverContent>
    </Popover>
  );
}

interface WithInfoProps {
  topic: string;
  text: string;
  children: ReactNode;
}

// Puts the ⓘ button beside a label (or any inline heading) without nesting it inside.
export function WithInfo({ topic, text, children }: WithInfoProps) {
  return (
    <div className="flex items-center gap-1">
      {children}
      <InfoTip topic={topic} text={text} />
    </div>
  );
}
