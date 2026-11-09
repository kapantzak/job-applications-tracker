import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { InfoTip, WithInfo } from '../../src/ui/components/InfoTip.js';
import { FIELD_HELP, SCREEN_INTROS } from '../../src/ui/help-text.js';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

afterEach(cleanup);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !path.endsWith('help-text.ts') ? [path] : [];
  });
}

describe('InfoTip', () => {
  it('opens its help on click, shows backticked text as code, and closes on Escape', async () => {
    const user = userEvent.setup();
    render(<InfoTip topic="Port" text="Listens on `127.0.0.1` only." />);
    await user.click(screen.getByRole('button', { name: 'About Port' }));
    const panel = await screen.findByRole('dialog', { name: 'About Port' });
    expect(panel).toHaveTextContent('Listens on 127.0.0.1 only.');
    expect(panel.querySelector('code')).toHaveTextContent('127.0.0.1');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('opens from the keyboard', async () => {
    const user = userEvent.setup();
    render(<InfoTip topic="Port" text="Help." />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'About Port' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'About Port' })).toHaveTextContent('Help.');
  });

  it('sits beside the label, so the field keeps its own name and the button does not submit a form', async () => {
    const user = userEvent.setup();
    let submitted = false;
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitted = true;
        }}
      >
        <WithInfo topic="Company" text="The employer.">
          <Label htmlFor="c">Company</Label>
        </WithInfo>
        <Input id="c" />
      </form>,
    );
    expect(screen.getByRole('textbox', { name: 'Company' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'About Company' }));
    expect(submitted).toBe(false);
  });
});

describe('help text', () => {
  it('uses every field help and screen intro somewhere in the UI', () => {
    const files = sourceFiles(join(__dirname, '../../src/ui'));
    const source = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    // Settings and the CV review sheet pick some keys through a lookup table of quoted key names; only
    // those two files count for quoted keys, since words such as 'remote' are quoted all over the UI.
    const tables = files
      .filter((f) => f.endsWith('SettingsPage.tsx') || f.endsWith('CvReviewSheet.tsx'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    const unused = [
      ...Object.keys(FIELD_HELP).filter(
        (k) => !source.includes(`FIELD_HELP.${k}`) && !new RegExp(`: '${k}'|, '${k}'\\]`).test(tables),
      ),
      ...Object.keys(SCREEN_INTROS).filter((k) => !source.includes(`SCREEN_INTROS.${k}`)),
    ];
    expect(unused).toEqual([]);
  });

  it('closes every backtick code span', () => {
    const open = Object.entries(FIELD_HELP).filter(([, text]) => text.split('`').length % 2 === 0);
    expect(open).toEqual([]);
  });
});
