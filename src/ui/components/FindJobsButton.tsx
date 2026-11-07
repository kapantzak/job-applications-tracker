import { useState } from 'react';
import { ChevronDownIcon, RocketIcon, SearchIcon } from 'lucide-react';
import type { EffortMode } from '../../server/domain/types.js';
import { MaxSearchDialog } from './MaxSearchDialog.js';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupSeparator } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const MODES: Array<{ value: EffortMode; title: string; description: string }> = [
  { value: 'default', title: 'Default', description: 'One agent. Balances results and tokens.' },
  {
    value: 'max',
    title: 'Max effort',
    description: 'Five agents, one per source. Several times the tokens; asks before it starts.',
  },
];

// Split button in the style of GitHub's merge button: the menu only picks the mode, the main button runs it.
// Every page load starts on Default (user decision 2, SOW-0020), so the costly mode is always chosen on purpose.
export function FindJobsButton({
  profileId,
  onStart,
  disabled = false,
}: {
  profileId: string;
  onStart: (mode: EffortMode) => void;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<EffortMode>('default');
  const [confirming, setConfirming] = useState(false);
  const max = mode === 'max';

  return (
    <>
      <ButtonGroup>
        <Button type="button" disabled={disabled} onClick={() => (max ? setConfirming(true) : onStart('default'))}>
          {max ? <RocketIcon /> : <SearchIcon />}
          {max ? 'Find jobs with max effort' : 'Find jobs'}
        </Button>
        <ButtonGroupSeparator />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="icon" disabled={disabled} aria-label="Choose search mode">
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuRadioGroup value={mode} onValueChange={(v) => setMode(v as EffortMode)}>
              {MODES.map((m) => (
                <DropdownMenuRadioItem key={m.value} value={m.value} aria-label={m.title} className="items-start">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{m.title}</span>
                    <span className="text-xs text-muted-foreground">{m.description}</span>
                  </div>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
      <MaxSearchDialog
        profileId={profileId}
        open={confirming}
        onOpenChange={setConfirming}
        onStart={() => onStart('max')}
      />
    </>
  );
}
