import { describe, expect, it } from 'vitest';
import {
  CV_PROMPT_MAX_CHARS,
  CvFileError,
  detectCvType,
  extractCvText,
  promptCvText,
} from '../../../src/server/cv/extract.js';
import { CV_LINES, CV_TEXT, makeDoc, makeDocx, makeOdt, makePdf, makePng } from '../../fixtures/cv-files.js';

function refusal(fn: () => unknown): CvFileError {
  try {
    fn();
  } catch (err) {
    if (err instanceof CvFileError) return err;
    throw err;
  }
  throw new Error('expected a CvFileError');
}

async function asyncRefusal(promise: Promise<unknown>): Promise<CvFileError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof CvFileError) return err;
    throw err;
  }
  throw new Error('expected a CvFileError');
}

describe('detectCvType', () => {
  it('detects PDF and Word files from their content, whatever their name', () => {
    expect(detectCvType(makePdf(), 'cv.txt')).toBe('pdf');
    expect(detectCvType(makeDocx(), 'cv')).toBe('docx');
  });

  it('tells Markdown from plain text by the name only', () => {
    const text = Buffer.from(CV_TEXT);
    expect(detectCvType(text, 'cv.md')).toBe('md');
    expect(detectCvType(text, 'CV.Markdown')).toBe('md');
    expect(detectCvType(text, 'cv.txt')).toBe('txt');
    expect(detectCvType(text, 'cv')).toBe('txt');
  });

  it('refuses an old .doc or password-protected Office file with advice to save it as .docx or PDF', () => {
    const err = refusal(() => detectCvType(makeDoc(), 'cv.doc'));
    expect(err.status).toBe(415);
    expect(err.message).toBe(
      'Older Word files (.doc) and password-protected Office files are not supported. Save it as .docx or PDF without a password and try again.',
    );
  });

  it.each([
    ['an OpenDocument file', makeOdt(), 'cv.odt'],
    ['an image', makePng(), 'cv.png'],
    ['an RTF file', Buffer.from('{\\rtf1\\ansi Alex Example}'), 'cv.rtf'],
    ['bytes that are not UTF-8 text', Buffer.from([0x41, 0xff, 0xfe, 0x42]), 'cv.txt'],
  ])('refuses %s', (_label, bytes, name) => {
    const err = refusal(() => detectCvType(bytes, name));
    expect(err.status).toBe(415);
    expect(err.message).toBe('This file type is not supported. Use a PDF, a Word (.docx), a .txt or a .md file.');
  });
});

describe('extractCvText', () => {
  it('reads the text of a PDF', async () => {
    expect(await extractCvText(makePdf(), 'pdf')).toBe(CV_TEXT);
  });

  it('reads the text of a Word file', async () => {
    expect(await extractCvText(makeDocx(), 'docx')).toBe(CV_LINES.join('\n\n'));
  });

  it('reads plain text without a byte order mark and with normalised line ends', async () => {
    const bytes = Buffer.from(`﻿${CV_LINES.join('  \r\n')}\r\n\r\n\r\n\r\n`);
    expect(await extractCvText(bytes, 'txt')).toBe(CV_TEXT);
  });

  it('refuses a PDF without a text layer, as a scanned CV is', async () => {
    const err = await asyncRefusal(extractCvText(makePdf([]), 'pdf'));
    expect(err.status).toBe(422);
    expect(err.message).toBe(
      'No readable text was found in this file. A scanned PDF has no text layer; fill in the form by hand instead.',
    );
  });

  it('refuses a text file with fewer than 100 readable characters', async () => {
    const err = await asyncRefusal(extractCvText(Buffer.from('Alex Example\n'), 'txt'));
    expect(err.status).toBe(422);
  });

  it('refuses a damaged PDF', async () => {
    const err = await asyncRefusal(extractCvText(Buffer.from('%PDF-1.4\nnot really a pdf'), 'pdf'));
    expect(err.status).toBe(422);
    expect(err.message).toBe('This PDF could not be read. It may be damaged or password protected.');
  });

  it('refuses a damaged Word file', async () => {
    const err = await asyncRefusal(extractCvText(makeOdt(), 'docx'));
    expect(err.status).toBe(422);
    expect(err.message).toBe('This Word file could not be read. It may be damaged.');
  });
});

describe('promptCvText', () => {
  it('keeps a normal CV whole', () => {
    expect(promptCvText(CV_TEXT)).toBe(CV_TEXT);
  });

  it('cuts a long text at the character limit without splitting a character', () => {
    const long = '😀'.repeat(CV_PROMPT_MAX_CHARS + 10);
    const cut = promptCvText(long);
    expect(Array.from(cut)).toHaveLength(CV_PROMPT_MAX_CHARS);
    expect(cut.endsWith('😀')).toBe(true);
  });
});
