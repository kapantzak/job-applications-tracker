import { win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveCommand, type ResolveDeps } from '../../../src/server/agents/resolve-command.js';

const EXEC_PATH = 'C:\\Program Files\\nodejs\\node.exe';

// Shape of the shim npm's cmd-shim writes; the first %dp0% reference is node.exe, not the entry.
function npmShim(entry: string): string {
  return [
    '@ECHO off',
    'GOTO start',
    ':find_dp0',
    'SET dp0=%~dp0',
    'EXIT /b',
    ':start',
    'SETLOCAL',
    'CALL :find_dp0',
    '',
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ') ELSE (',
    '  SET "_prog=node"',
    '  SET PATHEXT=%PATHEXT:;.JS;=;%',
    ')',
    '',
    `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${entry}" %*`,
    '',
  ].join('\r\n');
}

// Windows file systems are case-insensitive, so the fake looks files up the same way.
function winDeps(files: Record<string, string>, overrides: Partial<ResolveDeps> = {}): ResolveDeps & { probed: string[] } {
  const probed: string[] = [];
  const byKey = new Map(Object.entries(files).map(([p, text]) => [p.toLowerCase(), text]));
  return {
    platform: 'win32',
    env: { PATH: 'C:\\Windows\\System32;;C:\\tools', PATHEXT: '.COM;.EXE;.BAT;.CMD' },
    exists: (p) => {
      probed.push(p);
      return byKey.has(p.toLowerCase());
    },
    readFile: (p) => {
      const text = byKey.get(p.toLowerCase());
      if (text === undefined) throw new Error(`ENOENT: ${p}`);
      return text;
    },
    execPath: EXEC_PATH,
    probed,
    ...overrides,
  };
}

describe('resolveCommand', () => {
  it('passes the command through unchanged on POSIX', () => {
    const deps = winDeps({}, { platform: 'darwin', exists: () => { throw new Error('must not probe'); } });
    expect(resolveCommand('claude', deps)).toEqual({ file: 'claude', prefixArgs: [] });
  });

  it('searches PATH entries in order and PATHEXT extensions as written, skipping empty entries', () => {
    const shim = win32.join('C:\\tools', 'claude.CMD');
    const deps = winDeps({ [shim]: npmShim('node_modules\\@acme\\agent\\cli.js') });
    resolveCommand('claude', deps);
    expect(deps.probed).toEqual([
      'C:\\Windows\\System32\\claude.COM',
      'C:\\Windows\\System32\\claude.EXE',
      'C:\\Windows\\System32\\claude.BAT',
      'C:\\Windows\\System32\\claude.CMD',
      'C:\\tools\\claude.COM',
      'C:\\tools\\claude.EXE',
      'C:\\tools\\claude.BAT',
      'C:\\tools\\claude.CMD',
    ]);
  });

  it('finds claude.cmd through an upper-case PATHEXT and resolves its %dp0% cli.js reference to node', () => {
    const shim = win32.join('C:\\tools', 'claude.cmd');
    const deps = winDeps({ [shim]: npmShim('node_modules\\@acme\\agent\\cli.js') });
    expect(resolveCommand('claude', deps)).toEqual({
      file: EXEC_PATH,
      prefixArgs: [win32.join('C:\\tools', 'node_modules\\@acme\\agent\\cli.js')],
    });
    expect(resolveCommand('claude', deps).prefixArgs[0]).toBe('C:\\tools\\node_modules\\@acme\\agent\\cli.js');
  });

  it('resolves a %~dp0 reference to an .mjs entry', () => {
    const shim = win32.join('C:\\tools', 'codex.cmd');
    const deps = winDeps(
      { [shim]: '@echo off\r\nnode "%~dp0\\node_modules\\@acme\\codex\\bin\\codex.mjs" %*\r\n' },
      { env: { PATH: 'C:\\tools', PATHEXT: '.exe;.cmd' } },
    );
    expect(resolveCommand('codex', deps)).toEqual({
      file: EXEC_PATH,
      prefixArgs: [win32.join('C:\\tools', 'node_modules\\@acme\\codex\\bin\\codex.mjs')],
    });
  });

  it('uses the default PATHEXT when the environment has none', () => {
    const shim = win32.join('C:\\tools', 'claude.CMD');
    const deps = winDeps({ [shim]: npmShim('node_modules\\@acme\\agent\\cli.js') }, { env: { PATH: 'C:\\tools' } });
    expect(resolveCommand('claude', deps).file).toBe(EXEC_PATH);
    expect(deps.probed).toEqual(['C:\\tools\\claude.COM', 'C:\\tools\\claude.EXE', 'C:\\tools\\claude.BAT', 'C:\\tools\\claude.CMD']);
  });

  it('falls back to the command when the shim has no script reference', () => {
    const shim = win32.join('C:\\tools', 'claude.cmd');
    const deps = winDeps({ [shim]: '@echo off\r\n"%dp0%\\claude.exe" %*\r\n' });
    expect(resolveCommand('claude', deps)).toEqual({ file: 'claude', prefixArgs: [] });
  });

  it('does not take a .json reference for a script', () => {
    const shim = win32.join('C:\\tools', 'claude.cmd');
    const deps = winDeps({ [shim]: '@echo off\r\nnode "%dp0%\\package.json" %*\r\n' });
    expect(resolveCommand('claude', deps)).toEqual({ file: 'claude', prefixArgs: [] });
  });

  it('falls back to the command when the shim cannot be read', () => {
    const shim = win32.join('C:\\tools', 'claude.cmd');
    const deps = winDeps({ [shim]: '' }, { readFile: () => { throw new Error('EACCES'); } });
    expect(resolveCommand('claude', deps)).toEqual({ file: 'claude', prefixArgs: [] });
  });

  it('falls back to the command when nothing is found on PATH', () => {
    expect(resolveCommand('claude', winDeps({}))).toEqual({ file: 'claude', prefixArgs: [] });
  });

  it('returns an .exe found on PATH as the file itself', () => {
    const exe = win32.join('C:\\tools', 'claude.EXE');
    expect(resolveCommand('claude', winDeps({ [exe]: '' }))).toEqual({ file: exe, prefixArgs: [] });
  });

  it('does not search PATH when the command has a directory or an extension', () => {
    const shim = 'D:\\agents\\agent.cmd';
    const deps = winDeps({ [shim]: npmShim('node_modules\\agent\\cli.cjs') });
    expect(resolveCommand(shim, deps)).toEqual({
      file: EXEC_PATH,
      prefixArgs: [win32.join('D:\\agents', 'node_modules\\agent\\cli.cjs')],
    });
    expect(deps.probed).toEqual([shim]);

    const named = winDeps({});
    expect(resolveCommand('agent.exe', named)).toEqual({ file: 'agent.exe', prefixArgs: [] });
    expect(named.probed).toEqual(['agent.exe']);
  });

  it('joins the script reference with the injected join', () => {
    const shim = win32.join('C:\\tools', 'claude.cmd');
    const deps = winDeps(
      { [shim]: npmShim('cli.js') },
      { join: (...parts) => parts.join('|') },
    );
    expect(resolveCommand('claude', deps).prefixArgs).toEqual(['C:\\tools|cli.js']);
  });
});
