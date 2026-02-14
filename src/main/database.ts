import Database from 'better-sqlite3';
import * as fs from 'fs';
import { Note, Tag, NoteTag, SearchResult } from '../shared/types';
import { getDataDir, getDbPath } from './paths';

let db: Database.Database;

// Initialize database schema
export function initDatabase(): void {
  // Ensure data directory exists
  fs.mkdirSync(getDataDir(), { recursive: true });
  
  // Initialize database
  db = new Database(getDbPath());
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      filePath TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS note_tags (
      noteId INTEGER NOT NULL,
      tagId INTEGER NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (noteId, tagId),
      FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE,
      FOREIGN KEY (tagId) REFERENCES tags(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_note_tags_note ON note_tags(noteId);
    CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tagId);
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

export function updateNoteTitle(id: number, title: string): void {
  const now = new Date().toISOString();
  const stmt = db.prepare('UPDATE notes SET title = ?, updatedAt = ? WHERE id = ?');
  stmt.run(title, now, id);
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

// Pagination
export function getNotesPage(page: number, perPage: number): { notes: Note[]; total: number } {
  const offset = (page - 1) * perPage;
  const notesStmt = db.prepare('SELECT * FROM notes ORDER BY updatedAt DESC LIMIT ? OFFSET ?');
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM notes');
  
  const notes = notesStmt.all(perPage, offset) as Note[];
  const result = countStmt.get() as { count: number };
  
  return { notes, total: result.count };
}

// Tag operations
export function createOrGetTag(name: string): Tag {
  const existing = db.prepare('SELECT * FROM tags WHERE name = ?').get(name) as Tag | undefined;
  if (existing) {
    return existing;
  }
  
  const stmt = db.prepare('INSERT INTO tags (name) VALUES (?)');
  const result = stmt.run(name);
  return { id: result.lastInsertRowid as number, name };
}

export function addTagToNote(noteId: number, tagName: string, position: number): NoteTag {
  const tag = createOrGetTag(tagName);
  
  // Remove if already exists (to update position)
  db.prepare('DELETE FROM note_tags WHERE noteId = ? AND tagId = ?').run(noteId, tag.id);
  
  // Insert with new position
  db.prepare('INSERT INTO note_tags (noteId, tagId, position) VALUES (?, ?, ?)').run(noteId, tag.id, position);
  
  return { noteId, tagId: tag.id, position, tag };
}

export function removeTagFromNote(noteId: number, tagId: number): void {
  db.prepare('DELETE FROM note_tags WHERE noteId = ? AND tagId = ?').run(noteId, tagId);
  
  // Re-index remaining tags
  const tags = db.prepare('SELECT * FROM note_tags WHERE noteId = ? ORDER BY position').all(noteId) as NoteTag[];
  tags.forEach((tag, index) => {
    db.prepare('UPDATE note_tags SET position = ? WHERE noteId = ? AND tagId = ?').run(index, noteId, tag.tagId);
  });
}

export function reorderNoteTags(noteId: number, tagIds: number[]): void {
  tagIds.forEach((tagId, index) => {
    db.prepare('UPDATE note_tags SET position = ? WHERE noteId = ? AND tagId = ?').run(index, noteId, tagId);
  });
}

export function getNoteTags(noteId: number): NoteTag[] {
  const stmt = db.prepare(`
    SELECT nt.noteId, nt.tagId, nt.position, t.id, t.name
    FROM note_tags nt
    JOIN tags t ON nt.tagId = t.id
    WHERE nt.noteId = ?
    ORDER BY nt.position
  `);
  
  const rows = stmt.all(noteId) as Array<{ noteId: number; tagId: number; position: number; id: number; name: string }>;
  return rows.map(row => ({
    noteId: row.noteId,
    tagId: row.tagId,
    position: row.position,
    tag: { id: row.id, name: row.name }
  }));
}

export function getAllTags(): Tag[] {
  const stmt = db.prepare('SELECT * FROM tags ORDER BY name');
  return stmt.all() as Tag[];
}

export function getTopTags(limit: number): Tag[] {
  const stmt = db.prepare(`
    SELECT t.id, t.name, COUNT(nt.noteId) as usage_count
    FROM tags t
    LEFT JOIN note_tags nt ON t.id = nt.tagId
    GROUP BY t.id
    ORDER BY usage_count DESC, t.name
    LIMIT ?
  `);
  return stmt.all(limit) as Tag[];
}

// Search operations
// Note: Text search with content is handled in the IPC handler (index.ts)
// This function only searches titles
export function searchNotes(query: string): SearchResult[] {
  const searchTerm = `%${query}%`;
  const stmt = db.prepare(`
    SELECT * FROM notes 
    WHERE title LIKE ?
    ORDER BY updatedAt DESC
  `);
  
  const notes = stmt.all(searchTerm) as Note[];
  return notes.map(note => ({
    note,
    matchType: 'title' as const
  }));
}

export function searchNotesByTag(tagName: string): SearchResult[] {
  const stmt = db.prepare(`
    SELECT n.*, nt.position
    FROM notes n
    JOIN note_tags nt ON n.id = nt.noteId
    JOIN tags t ON nt.tagId = t.id
    WHERE t.name LIKE ?
    ORDER BY nt.position, n.updatedAt DESC
  `);
  
  const notes = stmt.all(`%${tagName}%`) as Note[];
  return notes.map(note => ({
    note,
    matchType: 'tag' as const
  }));
}

export function getNotesByPrimaryTag(): { [tagName: string]: Note[] } {
  const stmt = db.prepare(`
    SELECT n.*, t.name as tagName
    FROM notes n
    JOIN note_tags nt ON n.id = nt.noteId
    JOIN tags t ON nt.tagId = t.id
    WHERE nt.position = 0
    ORDER BY t.name, n.updatedAt DESC
  `);
  
  const rows = stmt.all() as Array<Note & { tagName: string }>;
  const result: { [tagName: string]: Note[] } = {};
  
  rows.forEach(row => {
    const tagName = row.tagName;
    const note: Note = {
      id: row.id,
      title: row.title,
      filePath: row.filePath,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
    
    if (!result[tagName]) {
      result[tagName] = [];
    }
    result[tagName].push(note);
  });
  
  return result;
}
