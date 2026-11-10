import { useState } from 'react';
import { ChevronDownIcon, ImportIcon, MessageSquareTextIcon, RocketIcon, SearchIcon } from 'lucide-react';
import type { EffortMode, Run } from '../../server/domain/types.js';
import { FIELD_HELP } from '../help-text.js';
import { EFFORT_MODE_OPTIONS } from '../labels.js';
import { CustomSearchDialog } from './CustomSearchDialog.js';
import { ImportJobsDialog } from './ImportJobsDialog.js';
import { InfoTip } from './InfoTip.js';
import { MaxSearchDialog } from './MaxSearchDialog.js';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupSeparator } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Split button in the style of GitHub's merge button: the menu only picks the mode, the main button runs it.
// Every page load starts on Default (user decision 2, SOW-0020), so the costly mode is always chosen on purpose.
// "Custom search…" adds the user's own instructions to one search (SOW-0042); a plain search sends none.
// "Import from another agent…" saves jobs another agent client found (SOW-0043).
export function FindJobsButton({
  profileId,
  onStart,
  onImported,
  disabled = false,
}: {
  profileId: string;
  onStart: (mode: EffortMode, customPrompt?: string) => void;
  onImported: (run: Run) => void;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<EffortMode>('default');
  const [confirming, setConfirming] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [customText, setCustomText] = useState('');
  const [customMode, setCustomMode] = useState<EffortMode>('default');
  // Set while the Max warning stands between a custom search and its start.
  const [pendingCustom, setPendingCustom] = useState<string | null>(null);
  const max = mode === 'max';

  // A new custom search starts on the menu's mode; one with its text still typed resumes with its own mode.
  const openCustom = () => {
    if (!customText.trim()) setCustomMode(mode);
    setCustomOpen(true);
  };

  const startCustom = (chosen: EffortMode, text: string) => {
    setCustomOpen(false);
    if (chosen === 'default') {
      onStart('default', text);
      return;
    }
    setPendingCustom(text);
    setConfirming(true);
  };

  const confirmMax = () => (pendingCustom === null ? onStart('max') : onStart('max', pendingCustom));

  const onConfirmChange = (open: boolean) => {
    setConfirming(open);
    if (!open) setPendingCustom(null);
  };

  return (
    <>
      <div className="flex items-center gap-1">
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
                {EFFORT_MODE_OPTIONS.map((m) => (
                  <DropdownMenuRadioItem key={m.value} value={m.value} aria-label={m.title} className="items-start">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{m.title}</span>
                      <span className="text-xs text-muted-foreground">{m.description}</span>
                    </div>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={openCustom} aria-label="Custom search…" className="items-start">
                <MessageSquareTextIcon className="mt-0.5" />
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">Custom search…</span>
                  <span className="text-xs text-muted-foreground">Add your own instructions to one search.</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => setImportOpen(true)}
                aria-label="Import from another agent…"
                className="items-start"
              >
                <ImportIcon className="mt-0.5" />
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">Import from another agent…</span>
                  <span className="text-xs text-muted-foreground">
                    Run the search prompt anywhere and paste the answer.
                  </span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ButtonGroup>
        <InfoTip topic="Find jobs" text={FIELD_HELP.findJobs} />
      </div>
      <CustomSearchDialog
        open={customOpen}
        onOpenChange={setCustomOpen}
        text={customText}
        onTextChange={setCustomText}
        mode={customMode}
        onModeChange={setCustomMode}
        onSubmit={startCustom}
      />
      <MaxSearchDialog profileId={profileId} open={confirming} onOpenChange={onConfirmChange} onStart={confirmMax} />
      <ImportJobsDialog
        profileId={profileId}
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={(run) => {
          setImportOpen(false);
          onImported(run);
        }}
      />
    </>
  );
}
