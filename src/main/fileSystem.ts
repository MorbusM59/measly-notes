import * as fs from 'fs/promises';
import * as path from 'path';
import { getNotesDir } from './paths';

export async function initFileSystem(): Promise<void> {
  const notesDir = getNotesDir();
  try {
    await fs.access(notesDir);
  } catch {
    await fs.mkdir(notesDir, { recursive: true });
  }
}

export async function saveNoteContent(noteId: number, content: string, destFileName?: string): Promise<string> {
  const notesDir = getNotesDir();
  const filePath = destFileName ? path.join(notesDir, destFileName) : path.join(notesDir, `${noteId}.md`);
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

export async function copyFileToNotes(srcPath: string, destFileName: string): Promise<string> {
  const notesDir = getNotesDir();
  const dest = path.join(notesDir, destFileName);
  await fs.copyFile(srcPath, dest);
  return dest;
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
