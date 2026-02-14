import * as fs from 'fs/promises';
import * as path from 'path';
import { getNotesDir } from './paths';

const notesDir = getNotesDir();

export async function initFileSystem(): Promise<void> {
  try {
    await fs.access(notesDir);
  } catch {
    await fs.mkdir(notesDir, { recursive: true });
  }
}

export async function saveNoteContent(noteId: number, content: string): Promise<string> {
  const filePath = path.join(notesDir, `${noteId}.md`);
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

export async function loadNoteContent(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

export async function deleteNoteFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    console.error('Error deleting note file:', error);
  }
}
