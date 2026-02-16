import Database from 'better-sqlite3';
import * as fs from 'fs/promises';
import { Note, Tag, NoteTag, SearchResult } from '../shared/types';
import { getDataDir, getDbPath } from './paths';

let db: Database.Database;

// Initialize database schema
export async function initDatabase(): Promise<void> {
  // Ensure data directory exists
  try {
    await fs.mkdir(getDataDir(), { recursive: true });
  } catch (error) {
    throw new Error(`Failed to create data directory: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Open DB (creates file if missing)
  db = new Database(getDbPath());

  // Create main schema (explicit; includes lastEdited from the start)
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      filePath TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      lastEdited TEXT
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

  // Create FTS5 virtual table to index title and content for fast search.
  // noteId is stored as text/unindexed column so we can join back to notes.
  // FTS5 must be available in the SQLite build used by Electron (most distributions include it).
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        noteId UNINDEXED,
        title,
        content
      );
    `);
  } catch (err) {
    // If FTS5 is not available, surface an error so it's obvious during development.
    console.error('[db] Failed to create FTS table; FTS5 may be unavailable', err);
    throw err;
  }
}

/**
 * Normalize tag names for canonical storage:
 * - trim whitespace
 * - lowercase
 * - collapse one-or-more whitespace into single dash '-'
 */
function normalizeTagName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-');
}

export function createNote(title: string, filePath: string): Note {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO notes (title, filePath, createdAt, updatedAt, lastEdited)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(title, filePath, now, now, now);

  const note: Note = {
    id: result.lastInsertRowid as number,
    title,
    filePath,
    createdAt: now,
    updatedAt: now,
    lastEdited: now,
  };

  return note;
}

export function getAllNotes(): Note[] {
  const stmt = db.prepare('SELECT * FROM notes ORDER BY updatedAt DESC');
  return stmt.all() as Note[];
}

export function updateNote(id: number): void {
  const now = new Date().toISOString();
  const stmt = db.prepare('UPDATE notes SET updatedAt = ?, lastEdited = ? WHERE id = ?');
  stmt.run(now, now, id);
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

  // Also remove any FTS entry
  try {
    removeNoteFts(id);
  } catch (err) {
    console.warn('[db] Failed to remove FTS entry for note', id, err);
  }
}

export function getNoteById(id: number): Note | undefined {
  const stmt = db.prepare('SELECT * FROM notes WHERE id = ?');
  return stmt.get(id) as Note | undefined;
}

export function getLastEditedNote(): Note | undefined {
  const stmt = db.prepare('SELECT * FROM notes WHERE lastEdited IS NOT NULL ORDER BY lastEdited DESC LIMIT 1');
  return stmt.get() as Note | undefined;
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
  const normalized = normalizeTagName(name);
  const existing = db.prepare('SELECT * FROM tags WHERE name = ?').get(normalized) as Tag | undefined;
  if (existing) {
    return existing;
  }

  const stmt = db.prepare('INSERT INTO tags (name) VALUES (?)');
  const result = stmt.run(normalized);
  return { id: result.lastInsertRowid as number, name: normalized };
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

/**
 * Returns the top tags used by notes created or edited within the last 90 days.
 * Only tags that are used by at least one recent note will be returned.
 * Ordering: usage_count DESC, name ASC. Caller may re-order alphabetically for display.
 */
export function getTopTags(limit: number): Tag[] {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const stmt = db.prepare(`
    SELECT t.id, t.name, COUNT(nt.noteId) as usage_count
    FROM tags t
    JOIN note_tags nt ON t.id = nt.tagId
    JOIN notes n ON nt.noteId = n.id
    WHERE (n.updatedAt >= ? OR n.createdAt >= ? OR (n.lastEdited IS NOT NULL AND n.lastEdited >= ?))
    GROUP BY t.id
    HAVING usage_count > 0
    ORDER BY usage_count DESC, t.name
    LIMIT ?
  `);

  return stmt.all(cutoff, cutoff, cutoff, limit) as Tag[];
}

/**
 * FTS helpers
 */

// Upsert the FTS entry for a note
export function upsertNoteFts(noteId: number, title: string, content: string): void {
  // Use text version of noteId for storage in FTS table
  const idStr = String(noteId);
  const del = db.prepare('DELETE FROM notes_fts WHERE noteId = ?');
  del.run(idStr);

  const ins = db.prepare('INSERT INTO notes_fts(noteId, title, content) VALUES (?, ?, ?)');
  ins.run(idStr, title, content);
}

// Remove FTS entry
export function removeNoteFts(noteId: number): void {
  const idStr = String(noteId);
  db.prepare('DELETE FROM notes_fts WHERE noteId = ?').run(idStr);
}

/**
 * Search using FTS index.
 * - Uses MATCH to narrow candidates.
 * - Reads content only for matched notes to create a snippet (preserves existing UX).
 */
export async function searchNotes(query: string): Promise<SearchResult[]> {
  // Guard empty query
  const trimmed = (query || '').trim();
  if (!trimmed) return [];

  // For FTS MATCH usage: keep it simple and let FTS tokenize as configured
  // Using parameter binding for safety.
  const matchExpr = trimmed; // you can transform to handle phrase search or prefix queries

  // Get matching noteIds (limit results to protect memory)
  const stmt = db.prepare(`SELECT noteId FROM notes_fts WHERE notes_fts MATCH ? LIMIT 200`);
  const rows = stmt.all(matchExpr) as Array<{ noteId: string }>;

  const results: SearchResult[] = [];

  for (const r of rows) {
    const id = Number(r.noteId);
    if (Number.isNaN(id)) continue;
    const note = getNoteById(id);
    if (!note) continue;

    // Load content for snippet generation only (IO limited to matched notes)
    let content = '';
    try {
      content = await fs.readFile(note.filePath, 'utf-8');
    } catch {
      content = '';
    }

    const lowerContent = content.toLowerCase();
    const lowerQuery = trimmed.toLowerCase();
    const matchInTitle = note.title.toLowerCase().includes(lowerQuery);
    const matchInContent = content && lowerContent.includes(lowerQuery);

    const snippet = matchInContent ? extractSnippet(content, trimmed) : undefined;

    results.push({
      note,
      matchType: matchInTitle ? 'title' : 'content',
      snippet
    });
  }

  return results;
}

function extractSnippet(content: string, query: string, radius = 50): string {
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerContent.indexOf(lowerQuery);

  if (index === -1) return '';

  const start = Math.max(0, index - radius);
  const end = Math.min(content.length, index + query.length + radius);

  let snippet = content.substring(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet = snippet + '...';

  return snippet;
}

// Search operations that rely on DB-only lookups (titles/tags)
// kept where useful for non-content queries

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
      updatedAt: row.updatedAt,
      lastEdited: (row as any).lastEdited ?? null
    };

    if (!result[tagName]) {
      result[tagName] = [];
    }
    result[tagName].push(note);
  });

  return result;
}

export function getCategoryHierarchy() {
  // Get all notes with their tags at positions 0, 1, and 2
  const stmt = db.prepare(`
    SELECT 
      n.id, n.title, n.filePath, n.createdAt, n.updatedAt, n.lastEdited,
      t0.name as primaryTag,
      t1.name as secondaryTag,
      t2.name as tertiaryTag
    FROM notes n
    LEFT JOIN note_tags nt0 ON n.id = nt0.noteId AND nt0.position = 0
    LEFT JOIN tags t0 ON nt0.tagId = t0.id
    LEFT JOIN note_tags nt1 ON n.id = nt1.noteId AND nt1.position = 1
    LEFT JOIN tags t1 ON nt1.tagId = t1.id
    LEFT JOIN note_tags nt2 ON n.id = nt2.noteId AND nt2.position = 2
    LEFT JOIN tags t2 ON nt2.tagId = t2.id
    ORDER BY t0.name, t1.name, t2.name, n.updatedAt DESC
  `);

  const rows = stmt.all() as Array<{
    id: number;
    title: string;
    filePath: string;
    createdAt: string;
    updatedAt: string;
    lastEdited: string | null;
    primaryTag: string | null;
    secondaryTag: string | null;
    tertiaryTag: string | null;
  }>;

  const hierarchy: any = {};
  const uncategorizedNotes: Note[] = [];

  rows.forEach(row => {
    const note: Note = {
      id: row.id,
      title: row.title,
      filePath: row.filePath,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastEdited: row.lastEdited ?? null
    };

    const primary = row.primaryTag;
    const secondary = row.secondaryTag;
    const tertiary = row.tertiaryTag;

    // Note has no tags - add to uncategorized
    if (!primary) {
      uncategorizedNotes.push(note);
      return;
    }

    // Initialize primary tag if needed
    if (!hierarchy[primary]) {
      hierarchy[primary] = {
        notes: [],
        secondary: {}
      };
    }

    // Note has only primary tag
    if (!secondary) {
      hierarchy[primary].notes.push(note);
      return;
    }

    // Initialize secondary tag if needed
    if (!hierarchy[primary].secondary[secondary]) {
      hierarchy[primary].secondary[secondary] = {
        notes: [],
        tertiary: {}
      };
    }

    // Note has primary + secondary but no tertiary
    if (!tertiary) {
      hierarchy[primary].secondary[secondary].notes.push(note);
      return;
    }

    // Initialize tertiary tag if needed
    if (!hierarchy[primary].secondary[secondary].tertiary[tertiary]) {
      hierarchy[primary].secondary[secondary].tertiary[tertiary] = [];
    }

    // Note has all three tags
    hierarchy[primary].secondary[secondary].tertiary[tertiary].push(note);
  });

  // Sort uncategorized notes by date descending (most recent first)
  uncategorizedNotes.sort((a, b) => {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  return { hierarchy, uncategorizedNotes };
}
