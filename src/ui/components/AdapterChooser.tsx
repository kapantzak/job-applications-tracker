import type { AdapterStatus } from '../api/client.js';

interface AdapterChooserProps {
  adapters: AdapterStatus[];
  adapterId: AdapterStatus['id'];
  customCommand: string;
  onAdapterChange: (id: AdapterStatus['id']) => void;
  onCustomCommandChange: (value: string) => void;
}

// Shared by Setup and Settings so the two screens cannot drift apart.
export function AdapterChooser({
  adapters,
  adapterId,
  customCommand,
  onAdapterChange,
  onCustomCommandChange,
}: AdapterChooserProps) {
  const selected = adapters.find((a) => a.id === adapterId);
  return (
    <>
      <fieldset>
        <legend>Agent adapter</legend>
        {adapters.map((a) => (
          <label key={a.id}>
            <input
              type="radio"
              name="adapter"
              value={a.id}
              checked={adapterId === a.id}
              onChange={() => onAdapterChange(a.id)}
            />
            {a.id} - {a.installed ? `installed ${a.version ?? ''}`.trim() : 'not installed'}
            {a.message ? ` (${a.message})` : ''}
          </label>
        ))}
      </fieldset>
      {adapterId === 'custom' && (
        <label>
          Custom command
          <input value={customCommand} onChange={(e) => onCustomCommandChange(e.target.value)} />
        </label>
      )}
      {selected?.gmail_guide && (
        <section>
          <h2>Gmail access</h2>
          <p>
            This agent needs a Gmail MCP server configured to read your mailbox.{' '}
            <a
              href="https://www.npmjs.com/package/job-applications-tracker#gmail-access-for-other-agents"
              target="_blank"
              rel="noopener noreferrer"
            >
              Gmail setup guide
            </a>
          </p>
        </section>
      )}
    </>
  );
}
