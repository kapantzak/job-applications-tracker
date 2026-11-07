import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import type { CvFileType } from '../domain/types.js';

// Limits from SOW-0023 (decision 9 and A4).
export const CV_MAX_BYTES = 10 * 1024 * 1024;
export const CV_PROMPT_MAX_CHARS = 50_000;
const CV_MIN_TEXT_CHARS = 100;

const UNSUPPORTED = 'This file type is not supported. Use a PDF, a Word (.docx), a .txt or a .md file.';

// Carries the HTTP status the API answers with; the message is shown to the user as is.
export class CvFileError extends Error {
  constructor(
    readonly status: 413 | 415 | 422,
    message: string,
  ) {
    super(message);
    this.name = 'CvFileError';
  }
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((b, i) => bytes[i] === b);
}

// Zip entry names are stored as plain text in each local file header.
function zipHasEntry(bytes: Uint8Array, name: string): boolean {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(name, 0, 'latin1');
}

function decodeUtf8(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

// The type comes from the content (issue #12); the name only tells Markdown from plain text.
export function detectCvType(bytes: Uint8Array, fileName: string): CvFileType {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf'; // %PDF-
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) {
    // Old .doc files and password-protected Office files share this container.
    throw new CvFileError(
      415,
      'Older Word files (.doc) and password-protected Office files are not supported. Save it as .docx or PDF without a password and try again.',
    );
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    if (zipHasEntry(bytes, 'word/document.xml')) return 'docx';
    throw new CvFileError(415, UNSUPPORTED);
  }
  // RTF is plain text on the wire, but the agent would get markup instead of the CV.
  if (startsWith(bytes, [0x7b, 0x5c, 0x72, 0x74, 0x66])) throw new CvFileError(415, UNSUPPORTED); // {\rtf
  if (decodeUtf8(bytes) === null) throw new CvFileError(415, UNSUPPORTED);
  return /\.(md|markdown)$/i.test(fileName) ? 'md' : 'txt';
}

async function rawText(bytes: Uint8Array, type: CvFileType): Promise<string> {
  switch (type) {
    case 'pdf': {
      let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
      try {
        // pdf.js takes ownership of the buffer it is given, so it gets a copy; verbosity 0 keeps font
        // warnings out of the server log.
        pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
        const { text } = await extractText(pdf, { mergePages: true });
        return text;
      } catch {
        throw new CvFileError(422, 'This PDF could not be read. It may be damaged or password protected.');
      } finally {
        // Frees the document's memory (pdf.js documents are released through their loading task);
        // a failure here must not hide the result.
        await pdf?.loadingTask.destroy().catch(() => {});
      }
    }
    case 'docx': {
      try {
        const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
        return result.value;
      } catch {
        throw new CvFileError(422, 'This Word file could not be read. It may be damaged.');
      }
    }
    case 'txt':
    case 'md':
      return (decodeUtf8(bytes) ?? '').replace(/^﻿/, '');
  }
}

export async function extractCvText(bytes: Uint8Array, type: CvFileType): Promise<string> {
  const text = (await rawText(bytes, type))
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // A scanned PDF has pages but no text layer.
  if (text.replace(/\s/g, '').length < CV_MIN_TEXT_CHARS) {
    throw new CvFileError(
      422,
      'No readable text was found in this file. A scanned PDF has no text layer; fill in the form by hand instead.',
    );
  }
  return text;
}

// Cut by characters, not UTF-16 units, so a cut never splits one.
export function promptCvText(text: string): string {
  const chars = Array.from(text);
  return chars.length <= CV_PROMPT_MAX_CHARS ? text : chars.slice(0, CV_PROMPT_MAX_CHARS).join('');
}
