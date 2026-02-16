import Database from 'better-sqlite3';
import * as fs from 'fs/promises';
import { Note, Tag, NoteTag, SearchResult, SnippetSegment } from '../shared/types';
import { getDataDir, getDbPath } from './paths';

let db: Database.Database;

// Initialize database schema
export async function initDatabase(): Promise<void> {
  try {
    await fs.mkdir(getDataDir(), { recursive: true });
  } catch (error) {
    throw new Error(`Failed to create data directory: ${error instanceof Error ? error.message : String(error)}`);
  }

  db = new Database(getDbPath());

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

  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        noteId UNINDEXED,
        title,
        content
      );
    `);
  } catch (err) {
    console.error('[db] Failed to create FTS table; FTS5 may be unavailable', err);
    throw err;
  }
}

/* Utilities */
function normalizeTagName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-');
}
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* Core note operations */
export function createNote(title: string, filePath: string): Note {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO notes (title, filePath, createdAt, updatedAt, lastEdited)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(title, filePath, now, now, now);

  return {
    id: result.lastInsertRowid as number,
    title,
    filePath,
    createdAt: now,
    updatedAt: now,
    lastEdited: now,
  };
}

export function getAllNotes(): Note[] {
  const stmt = db.prepare('SELECT * FROM notes ORDER BY updatedAt DESC');
  return stmt.all() as Note[];
}

export function getNoteById(id: number): Note | undefined {
  const stmt = db.prepare('SELECT * FROM notes WHERE id = ?');
  return stmt.get(id) as Note | undefined;
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
  try { removeNoteFts(id); } catch (err) { console.warn('[db] removeNoteFts failed', err); }
}

export function getLastEditedNote(): Note | undefined {
  const stmt = db.prepare('SELECT * FROM notes WHERE lastEdited IS NOT NULL ORDER BY lastEdited DESC LIMIT 1');
  return stmt.get() as Note | undefined;
}

export function closeDatabase(): void {
  db.close();
}

/* Pagination */
export function getNotesPage(page: number, perPage: number): { notes: Note[]; total: number } {
  const offset = (page - 1) * perPage;
  const notesStmt = db.prepare('SELECT * FROM notes ORDER BY updatedAt DESC LIMIT ? OFFSET ?');
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM notes');
  const notes = notesStmt.all(perPage, offset) as Note[];
  const result = countStmt.get() as { count: number };
  return { notes, total: result.count };
}

/* Tags */
export function createOrGetTag(name: string): Tag {
  const normalized = normalizeTagName(name);
  const existing = db.prepare('SELECT * FROM tags WHERE name = ?').get(normalized) as Tag | undefined;
  if (existing) return existing;
  const stmt = db.prepare('INSERT INTO tags (name) VALUES (?)');
  const result = stmt.run(normalized);
  return { id: result.lastInsertRowid as number, name: normalized };
}

export function addTagToNote(noteId: number, tagName: string, position: number): NoteTag {
  const tag = createOrGetTag(tagName);
  db.prepare('DELETE FROM note_tags WHERE noteId = ? AND tagId = ?').run(noteId, tag.id);
  db.prepare('INSERT INTO note_tags (noteId, tagId, position) VALUES (?, ?, ?)').run(noteId, tag.id, position);
  return { noteId, tagId: tag.id, position, tag };
}

export function removeTagFromNote(noteId: number, tagId: number): void {
  db.prepare('DELETE FROM note_tags WHERE noteId = ? AND tagId = ?').run(noteId, tagId);
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

/* FTS helpers */
export function upsertNoteFts(noteId: number, title: string, content: string): void {
  const idStr = String(noteId);
  db.prepare('DELETE FROM notes_fts WHERE noteId = ?').run(idStr);
  db.prepare('INSERT INTO notes_fts(noteId, title, content) VALUES (?, ?, ?)').run(idStr, title, content);
}
export function removeNoteFts(noteId: number): void {
  const idStr = String(noteId);
  db.prepare('DELETE FROM notes_fts WHERE noteId = ?').run(idStr);
}

/* Phrase permissive check */
function phraseMatchesPermissive(content: string, phrase: string): boolean {
  if (!phrase) return false;
  const tokens = phrase.split(/\s+/).map(t => t.trim()).filter(Boolean).map(t => t.replace(/[^A-Za-z0-9_-]+/g, ''));
  if (tokens.length === 0) return false;
  const allButLast = tokens.slice(0, -1).map(t => escapeRegExp(t));
  const last = escapeRegExp(tokens[tokens.length - 1]);
  const prefix = allButLast.length ? allButLast.join('\\W+') + '\\W+' : '';
  const pattern = prefix + last + '\\w*';
  const re = new RegExp(pattern, 'i');
  return re.test(content);
}

/* Build FTS match expression (tokens required -> AND semantics). */
function buildFtsMatchExpression(query: string): string {
  if (!query) return '';
  const phraseRegex = /"([^"]+)"/g;
  let m: RegExpExecArray | null;
  const phraseTokens: string[] = [];
  while ((m = phraseRegex.exec(query)) !== null) {
    const phrase = m[1].trim();
    if (phrase) {
      const toks = phrase.split(/\s+/).map(t => t.trim().replace(/[^A-Za-z0-9_-]+/g, '')).filter(Boolean);
      for (const t of toks) phraseTokens.push(`${t}*`);
    }
  }
  let stripped = query.replace(phraseRegex, ' ');
  const tokens = stripped.split(/\s+/).map(t => t.trim()).filter(Boolean);
  const tokenParts: string[] = [];
  for (const raw of tokens) {
    const cleaned = raw.replace(/[^A-Za-z0-9_-]+/g, '');
    if (!cleaned) continue;
    tokenParts.push(`${cleaned}*`);
  }
  const parts = [...phraseTokens, ...tokenParts];
  if (parts.length === 0) return '';
  return parts.join(' AND ');
}

/* Search (FTS-backed, with post-filtering and snippet segments) */
export async function searchNotes(query: string): Promise<SearchResult[]> {
  const trimmed = (query || '').trim();
  if (!trimmed) return [];

  const phraseRegex = /"([^"]+)"/g;
  let pm: RegExpExecArray | null;
  const quotedPhrases: string[] = [];
  while ((pm = phraseRegex.exec(trimmed)) !== null) {
    const phrase = pm[1].trim();
    if (phrase) quotedPhrases.push(phrase);
  }

  let stripped = trimmed.replace(phraseRegex, ' ');
  const tokens = stripped.split(/\s+/).map(t => t.trim()).filter(Boolean);
  const tokenPatterns = tokens
    .map(t => t.replace(/[^A-Za-z0-9_-]+/g, ''))
    .filter(Boolean)
    .map(t => t.toLowerCase());

  const matchExpr = buildFtsMatchExpression(trimmed);
  if (!matchExpr) return [];

  const MAX_RESULTS = 200;

  // Try parameterized MATCH first (safer); if not supported, try inlined escaped expression.
  try {
    const stmtParam = db.prepare(`SELECT noteId FROM notes_fts WHERE notes_fts MATCH ? LIMIT ?`);
    const rows = stmtParam.all(matchExpr, MAX_RESULTS) as Array<{ noteId: string }>;

    const results: SearchResult[] = [];

    for (const r of rows) {
      const id = Number(r.noteId);
      if (Number.isNaN(id)) continue;
      const note = getNoteById(id);
      if (!note) continue;

      let content = '';
      try { content = await fs.readFile(note.filePath, 'utf-8'); } catch { content = ''; }
      const contentLower = content.toLowerCase();
      const titleLower = note.title.toLowerCase();

      let ok = true;
      for (const phrase of quotedPhrases) {
        const inContent = content && phraseMatchesPermissive(content, phrase);
        const inTitle = phrase && note.title && phraseMatchesPermissive(note.title, phrase);
        if (!inContent && !inTitle) { ok = false; break; }
      }
      if (!ok) continue;

      for (const tp of tokenPatterns) {
        if (!(contentLower.includes(tp) || titleLower.includes(tp))) { ok = false; break; }
      }
      if (!ok) continue;

      // Determine snippet center and build segments
      let firstIndex = -1;
      let firstMatchText = '';
      for (const phrase of quotedPhrases) {
        if (!phrase) continue;
        const tokensP = phrase.split(/\s+/).map(t => t.replace(/[^A-Za-z0-9_-]+/g, '')).filter(Boolean);
        if (tokensP.length === 0) continue;
        const reStr = tokensP.map(t => escapeRegExp(t)).join('\\W+');
        const regex = new RegExp(reStr, 'i');
        const m2 = regex.exec(content);
        if (m2 && m2.index !== undefined) {
          if (firstIndex === -1 || m2.index < firstIndex) { firstIndex = m2.index; firstMatchText = m2[0]; }
        }
      }
      for (const t of tokenPatterns) {
        const idx = contentLower.indexOf(t);
        if (idx !== -1 && (firstIndex === -1 || idx < firstIndex)) { firstIndex = idx; firstMatchText = content.substr(idx, t.length); }
      }

      if (firstIndex === -1) {
        for (const phrase of quotedPhrases) {
          const re = new RegExp(escapeRegExp(phrase), 'i');
          const mt = re.exec(note.title);
          if (mt && mt.index !== undefined) { firstIndex = 0; firstMatchText = mt[0]; break; }
        }
        if (firstIndex === -1) {
          for (const t of tokenPatterns) {
            const idx = titleLower.indexOf(t);
            if (idx !== -1) { firstIndex = 0; firstMatchText = note.title.substr(idx, t.length); break; }
          }
        }
      }

      const radius = 50;
      let snippetRaw = '';
      if (!content) snippetRaw = note.title;
      else {
        const centerPos = firstIndex >= 0 ? firstIndex : 0;
        const start = Math.max(0, centerPos - radius);
        const end = Math.min(content.length, centerPos + (firstMatchText ? firstMatchText.length : 0) + radius);
        snippetRaw = content.substring(start, end);
        if (start > 0) snippetRaw = '...' + snippetRaw;
        if (end < content.length) snippetRaw = snippetRaw + '...';
      }

      const highlightItems: string[] = [];
      for (const p of quotedPhrases) if (p) highlightItems.push(p);
      for (const t of tokenPatterns) if (t) highlightItems.push(t);
      const uniqueHighlights = Array.from(new Set(highlightItems)).filter(Boolean).sort((a, b) => b.length - a.length);

      const segments: SnippetSegment[] = [];
      if (!snippetRaw) segments.push({ text: '' });
      else if (uniqueHighlights.length === 0) segments.push({ text: snippetRaw });
      else {
        const alt = uniqueHighlights.map(h => escapeRegExp(h)).join('|');
        const re = new RegExp(alt, 'ig');
        let lastIndex = 0;
        let m3: RegExpExecArray | null;
        while ((m3 = re.exec(snippetRaw)) !== null) {
          const s = m3.index;
          const e = re.lastIndex;
          if (s > lastIndex) segments.push({ text: snippetRaw.substring(lastIndex, s) });
          segments.push({ text: snippetRaw.substring(s, e), highlight: true });
          lastIndex = e;
        }
        if (lastIndex < snippetRaw.length) segments.push({ text: snippetRaw.substring(lastIndex) });
      }

      const joinedQuery = (quotedPhrases.join(' ') + ' ' + tokenPatterns.join(' ')).trim().toLowerCase();
      const matchInTitle = note.title.toLowerCase().includes(joinedQuery);

      results.push({ note, matchType: matchInTitle ? 'title' : 'content', snippet: segments });
      if (results.length >= MAX_RESULTS) break;
    }

    return results;
  } catch (paramErr) {
    // Fallback: attempt safe inline match, then final manual scan if necessary
    try {
      const safeMatch = matchExpr.replace(/'/g, "''").slice(0, 2000);
      const sql = `SELECT noteId FROM notes_fts WHERE notes_fts MATCH '${safeMatch}' LIMIT ${MAX_RESULTS}`;
      const stmt = db.prepare(sql);
      const rows = stmt.all() as Array<{ noteId: string }>;
      // reuse processing logic (kept concise here by delegating to above behavior)
      const results: SearchResult[] = [];
      for (const r of rows) {
        const id = Number(r.noteId);
        if (Number.isNaN(id)) continue;
        const note = getNoteById(id);
        if (!note) continue;
        let content = '';
        try { content = await fs.readFile(note.filePath, 'utf-8'); } catch { content = ''; }
        const contentLower = content.toLowerCase();
        const titleLower = note.title.toLowerCase();
        let ok = true;
        for (const phrase of quotedPhrases) {
          const inContent = content && phraseMatchesPermissive(content, phrase);
          const inTitle = phrase && note.title && phraseMatchesPermissive(note.title, phrase);
          if (!inContent && !inTitle) { ok = false; break; }
        }
        if (!ok) continue;
        for (const tp of tokenPatterns) {
          if (!(contentLower.includes(tp) || titleLower.includes(tp))) { ok = false; break; }
        }
        if (!ok) continue;

        // Build snippet (same as above)...
        let firstIndex = -1;
        let firstMatchText = '';
        for (const phrase of quotedPhrases) {
          if (!phrase) continue;
          const tokensP = phrase.split(/\s+/).map(t => t.replace(/[^A-Za-z0-9_-]+/g, '')).filter(Boolean);
          if (tokensP.length === 0) continue;
          const reStr = tokensP.map(t => escapeRegExp(t)).join('\\W+');
          const regex = new RegExp(reStr, 'i');
          const m2 = regex.exec(content);
          if (m2 && m2.index !== undefined) {
            if (firstIndex === -1 || m2.index < firstIndex) { firstIndex = m2.index; firstMatchText = m2[0]; }
          }
        }
        for (const t of tokenPatterns) {
          const idx = contentLower.indexOf(t);
          if (idx !== -1 && (firstIndex === -1 || idx < firstIndex)) { firstIndex = idx; firstMatchText = content.substr(idx, t.length); }
        }

        if (firstIndex === -1) {
          for (const phrase of quotedPhrases) {
            const re = new RegExp(escapeRegExp(phrase), 'i');
            const mt = re.exec(note.title);
            if (mt && mt.index !== undefined) { firstIndex = 0; firstMatchText = mt[0]; break; }
          }
          if (firstIndex === -1) {
            for (const t of tokenPatterns) {
              const idx = titleLower.indexOf(t);
              if (idx !== -1) { firstIndex = 0; firstMatchText = note.title.substr(idx, t.length); break; }
            }
          }
        }

        const radius = 50;
        let snippetRaw = '';
        if (!content) snippetRaw = note.title;
        else {
          const centerPos = firstIndex >= 0 ? firstIndex : 0;
          const start = Math.max(0, centerPos - radius);
          const end = Math.min(content.length, centerPos + (firstMatchText ? firstMatchText.length : 0) + radius);
          snippetRaw = content.substring(start, end);
          if (start > 0) snippetRaw = '...' + snippetRaw;
          if (end < content.length) snippetRaw = snippetRaw + '...';
        }

        const highlightItems: string[] = [];
        for (const p of quotedPhrases) if (p) highlightItems.push(p);
        for (const t of tokenPatterns) if (t) highlightItems.push(t);
        const uniqueHighlights = Array.from(new Set(highlightItems)).filter(Boolean).sort((a, b) => b.length - a.length);

        const segments: SnippetSegment[] = [];
        if (!snippetRaw) segments.push({ text: '' });
        else if (uniqueHighlights.length === 0) segments.push({ text: snippetRaw });
        else {
          const alt = uniqueHighlights.map(h => escapeRegExp(h)).join('|');
          const re = new RegExp(alt, 'ig');
          let lastIndex = 0;
          let m3: RegExpExecArray | null;
          while ((m3 = re.exec(snippetRaw)) !== null) {
            const s = m3.index;
            const e = re.lastIndex;
            if (s > lastIndex) segments.push({ text: snippetRaw.substring(lastIndex, s) });
            segments.push({ text: snippetRaw.substring(s, e), highlight: true });
            lastIndex = e;
          }
          if (lastIndex < snippetRaw.length) segments.push({ text: snippetRaw.substring(lastIndex) });
        }

        const joinedQuery = (quotedPhrases.join(' ') + ' ' + tokenPatterns.join(' ')).trim().toLowerCase();
        const matchInTitle = note.title.toLowerCase().includes(joinedQuery);

        results.push({ note, matchType: matchInTitle ? 'title' : 'content', snippet: segments });
        if (results.length >= MAX_RESULTS) break;
      }

      return results;
    } catch (inlineErr) {
      console.error('[db] FTS inline match failed', inlineErr);
      // Final fallback: manual scan across all notes
      const phrasesFallback: string[] = [];
      const phraseRegexFallback = /"([^"]+)"/g;
      let pm2: RegExpExecArray | null;
      while ((pm2 = phraseRegexFallback.exec(trimmed)) !== null) {
        const phrase = pm2[1].trim();
        if (phrase) phrasesFallback.push(phrase);
      }
      let stripped2 = trimmed.replace(phraseRegexFallback, ' ');
      const tokensFallback = stripped2.split(/\s+/).map(t => t.trim()).filter(Boolean)
        .map(t => t.replace(/[^A-Za-z0-9_-]+/g, '').toLowerCase())
        .filter(Boolean);

      const allNotes = getAllNotes();
      const results: SearchResult[] = [];
      for (const note of allNotes) {
        const content = await (async () => {
          try { return await fs.readFile(note.filePath, 'utf-8'); } catch { return ''; }
        })();
        const contentLower = content.toLowerCase();
        const titleLower = note.title.toLowerCase();

        let ok = true;
        for (const p of phrasesFallback) {
          if (!(phraseMatchesPermissive(content, p) || phraseMatchesPermissive(note.title, p))) { ok = false; break; }
        }
        if (!ok) continue;
        for (const t of tokensFallback) {
          if (!(contentLower.includes(t) || titleLower.includes(t))) { ok = false; break; }
        }
        if (!ok) continue;

        // snippet building
        const firstIndexCandidates: number[] = [];
        for (const p of phrasesFallback) {
          const idx = contentLower.indexOf(p.toLowerCase());
          if (idx !== -1) firstIndexCandidates.push(idx);
        }
        for (const t of tokensFallback) {
          const idx = contentLower.indexOf(t);
          if (idx !== -1) firstIndexCandidates.push(idx);
        }
        const firstIndex = firstIndexCandidates.length ? Math.min(...firstIndexCandidates) : -1;
        const radius = 50;
        let snippetRaw = '';
        if (!content) snippetRaw = note.title;
        else {
          const centerPos = firstIndex >= 0 ? firstIndex : 0;
          const start = Math.max(0, centerPos - radius);
          const end = Math.min(content.length, centerPos + radius);
          snippetRaw = content.substring(start, end);
          if (start > 0) snippetRaw = '...' + snippetRaw;
          if (end < content.length) snippetRaw = snippetRaw + '...';
        }

        const highlights = [...phrasesFallback, ...tokensFallback].filter(Boolean).sort((a, b) => b.length - a.length);
        const segments: SnippetSegment[] = [];
        if (!snippetRaw) segments.push({ text: '' });
        else {
          const alt = highlights.map(h => escapeRegExp(h)).join('|');
          const re = new RegExp(alt, 'ig');
          let lastIndex = 0;
          let m3: RegExpExecArray | null;
          while ((m3 = re.exec(snippetRaw)) !== null) {
            const s = m3.index;
            const e = re.lastIndex;
            if (s > lastIndex) segments.push({ text: snippetRaw.substring(lastIndex, s) });
            segments.push({ text: snippetRaw.substring(s, e), highlight: true });
            lastIndex = e;
          }
          if (lastIndex < snippetRaw.length) segments.push({ text: snippetRaw.substring(lastIndex) });
        }

        const joinedQuery = (phrasesFallback.join(' ') + ' ' + tokensFallback.join(' ')).trim().toLowerCase();
        const matchInTitle = note.title.toLowerCase().includes(joinedQuery);

        results.push({ note, matchType: matchInTitle ? 'title' : 'content', snippet: segments });
        if (results.length >= MAX_RESULTS) break;
      }
      return results;
    }
  }
}

/* DB-only searches (tags / primary grouping) */
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
  return notes.map(note => ({ note, matchType: 'tag' as const }));
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
    if (!result[tagName]) result[tagName] = [];
    result[tagName].push(note);
  });
  return result;
}

export function getCategoryHierarchy(): { hierarchy: any; uncategorizedNotes: Note[] } {
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
    id: number; title: string; filePath: string; createdAt: string; updatedAt: string; lastEdited: string | null;
    primaryTag: string | null; secondaryTag: string | null; tertiaryTag: string | null;
  }>;

  const hierarchy: any = {};
  const uncategorizedNotes: Note[] = [];

  rows.forEach(row => {
    const note: Note = {
      id: row.id, title: row.title, filePath: row.filePath, createdAt: row.createdAt, updatedAt: row.updatedAt,
      lastEdited: row.lastEdited ?? null
    };
    const primary = row.primaryTag, secondary = row.secondaryTag, tertiary = row.tertiaryTag;
    if (!primary) { uncategorizedNotes.push(note); return; }

    if (!hierarchy[primary]) hierarchy[primary] = { notes: [], secondary: {} };
    if (!secondary) { hierarchy[primary].notes.push(note); return; }

    if (!hierarchy[primary].secondary[secondary]) hierarchy[primary].secondary[secondary] = { notes: [], tertiary: {} };
    if (!tertiary) { hierarchy[primary].secondary[secondary].notes.push(note); return; }

    if (!hierarchy[primary].secondary[secondary].tertiary[tertiary]) hierarchy[primary].secondary[secondary].tertiary[tertiary] = [];
    hierarchy[primary].secondary[secondary].tertiary[tertiary].push(note);
  });

  uncategorizedNotes.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return { hierarchy, uncategorizedNotes };
}
