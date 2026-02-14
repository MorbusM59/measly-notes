import Database from 'better-sqlite3';
import * as path from 'path';
import { app } from 'electron';
import { Note } from '../shared/types';

const dbPath = path.join(app.getPath('userData'), 'notes.db');
const db = new Database(dbPath);

// Initialize database schema
export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      filePath TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);
}

export function createNote(title: string, filePath: string): Note {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO notes (title, filePath, createdAt, updatedAt)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(title, filePath, now, now);
  
  return {
    id: result.lastInsertRowid as number,
    title,
    filePath,
    createdAt: now,
    updatedAt: now,
  };
}

export function getAllNotes(): Note[] {
  const stmt = db.prepare('SELECT * FROM notes ORDER BY updatedAt DESC');
  return stmt.all() as Note[];
}

export function updateNote(id: number): void {
  const now = new Date().toISOString();
  const stmt = db.prepare('UPDATE notes SET updatedAt = ? WHERE id = ?');
  stmt.run(now, id);
}

export function updateNoteFilePath(id: number, filePath: string): void {
  const stmt = db.prepare('UPDATE notes SET filePath = ? WHERE id = ?');
  stmt.run(filePath, id);
}

export function deleteNote(id: number): void {
  const stmt = db.prepare('DELETE FROM notes WHERE id = ?');
  stmt.run(id);
}

export function getNoteById(id: number): Note | undefined {
  const stmt = db.prepare('SELECT * FROM notes WHERE id = ?');
  return stmt.get(id) as Note | undefined;
}

export function closeDatabase(): void {
  db.close();
}
