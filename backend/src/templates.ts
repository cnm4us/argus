import fs from 'fs/promises';
import path from 'path';
import { DOCUMENT_TYPES, DocumentType } from './documentTypes';

const templatesRoot = path.join(__dirname, '..', 'openai', 'templates');

export function isKnownDocumentType(value: string): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value);
}

export async function loadTemplateForDocumentType(
  documentType: DocumentType,
): Promise<string> {
  const universalPath = path.join(templatesRoot, 'universal.md');
  const doctypePath = path.join(
    templatesRoot,
    'doctypes',
    `${documentType}.md`,
  );

  const [universal, doctype] = await Promise.all([
    fs.readFile(universalPath, 'utf8'),
    fs.readFile(doctypePath, 'utf8'),
  ]);

  return `${universal}\n\n---\n\n${doctype}`;
}

export async function loadClassificationTemplate(): Promise<string> {
  const classifyPath = path.join(templatesRoot, 'classify.md');
  return fs.readFile(classifyPath, 'utf8');
}
