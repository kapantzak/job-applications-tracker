import { useId } from 'react';
import { MailIcon } from 'lucide-react';
import type { AdapterStatus } from '../api/client.js';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface AdapterChooserProps {
  adapters: AdapterStatus[];
  adapterId: AdapterStatus['id'];
  customCommand: string;
  onAdapterChange: (id: AdapterStatus['id']) => void;
  onCustomCommandChange: (value: string) => void;
}

function describe(a: AdapterStatus): string {
  const parts = [a.installed ? `installed ${a.version ?? ''}`.trim() : 'not installed'];
  if (a.authenticated === true) parts.push('signed in');
  if (a.authenticated === false) parts.push(`not signed in${a.authMessage ? ` (${a.authMessage})` : ''}`);
  const text = parts.join(' - ');
  return a.message ? `${text} (${a.message})` : text;
}

// Shared by Setup and Settings so the two screens cannot drift apart.
export function AdapterChooser({
  adapters,
  adapterId,
  customCommand,
  onAdapterChange,
  onCustomCommandChange,
}: AdapterChooserProps) {
  const prefix = useId();
  const selected = adapters.find((a) => a.id === adapterId);
  const commandId = `${prefix}-custom-command`;

  return (
    <div className="flex flex-col gap-6">
      <FieldSet>
        <FieldLegend variant="label">Agent adapter</FieldLegend>
        <RadioGroup
          name="adapter"
          value={adapterId}
          onValueChange={(v) => onAdapterChange(v as AdapterStatus['id'])}
        >
          {adapters.map((a) => {
            const id = `${prefix}-${a.id}`;
            return (
              // The radio sits inside its label so the whole card is the click target and its accessible name.
              <FieldLabel key={a.id} htmlFor={id}>
                <Field orientation="horizontal">
                  <RadioGroupItem id={id} value={a.id} />
                  <FieldContent>
                    <FieldTitle>
                      {a.id}
                      {a.installed ? (
                        <Badge variant="success">Installed</Badge>
                      ) : (
                        <Badge variant="outline">Not installed</Badge>
                      )}
                    </FieldTitle>
                    <FieldDescription>{describe(a)}</FieldDescription>
                  </FieldContent>
                </Field>
              </FieldLabel>
            );
          })}
        </RadioGroup>
      </FieldSet>
      {adapterId === 'custom' && (
        <Field>
          <FieldLabel htmlFor={commandId}>Custom command</FieldLabel>
          <Input
            id={commandId}
            className="font-mono"
            value={customCommand}
            onChange={(e) => onCustomCommandChange(e.target.value)}
          />
        </Field>
      )}
      {selected?.gmail_guide && (
        <Alert>
          <MailIcon />
          <AlertTitle>Gmail access</AlertTitle>
          <AlertDescription>
            <p>
              This agent needs a Gmail MCP server configured to read your mailbox.{' '}
              <a
                className="font-medium text-foreground underline underline-offset-4"
                href="https://www.npmjs.com/package/job-applications-tracker#gmail-access-for-other-agents"
                target="_blank"
                rel="noopener noreferrer"
              >
                Gmail setup guide
              </a>
            </p>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
