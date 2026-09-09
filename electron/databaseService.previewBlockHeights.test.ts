import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseService } from './databaseService'

/**
 * The persisted block-height survey (shared/noteLifecycle.ts's
 * PersistedPreviewBlockHeights) is what lets a re-opened note skip measuring
 * itself, so the render view can show a final layout on its first frame
 * instead of settling into one.
 *
 * It travels the same UI-state write the preview-block cache already uses,
 * and that write is hand-maintained on both ends: a `CASE WHEN ?` arm in the
 * UPDATE and a column in the SELECT. A field missing from either is dropped
 * in silence -- the note simply re-surveys, which looks like nothing at all
 * going wrong. Hence a real on-disk database, read back through a SECOND
 * DatabaseService instance so nothing is served from the first one's cache:
 * the same "simulate a real restart" shape stateService.test.ts uses for the
 * menu-state half of this class of bug.
 *
 * Deliberately NOT covered by the browser mock (src/dev/
 * installBrowserMockBridges.ts), which clones state verbatim and would pass
 * whether or not the SQL knew about the column.
 */
describe('DatabaseService preview block heights', () => {
  let dataRoot: string
  let db: DatabaseService

  const heightsBlob = JSON.stringify({
    v: 1,
    textHash: 'abc123',
    signature: '812x19',
    heights: [43, 76.5, 120, 43],
  })

  /** A minimal real note row -- this test only needs something with an id that the UI-state write can update. */
  const createNote = (): string => {
    const id = `note-${Math.random().toString(36).slice(2)}`
    const now = Date.now()
    db.upsertNoteContent({
      id,
      title: 'Untitled',
      filePath: `${id}.md`,
      text: 'hello',
      createdAtMs: now,
      updatedAtMs: now,
    })
    return id
  }

  beforeEach(async () => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-preview-heights-test-'))
    db = new DatabaseService(dataRoot)
    await db.initialize()
  })

  afterEach(() => {
    db.close()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('round-trips a survey through a real restart', async () => {
    const noteId = createNote()
    db.saveNoteUiState(noteId, { anchorBlockIndex: 2, previewBlockHeights: heightsBlob })
    db.close()

    const reopened = new DatabaseService(dataRoot)
    await reopened.initialize()
    try {
      const uiState = reopened.getNoteUiState(noteId)
      expect(uiState.previewBlockHeights).toBe(heightsBlob)
      // The field it shares its write with must not have been trampled.
      expect(uiState.anchorBlockIndex).toBe(2)
    } finally {
      reopened.close()
      db = reopened
    }
  })

  it('leaves a stored survey alone when a write does not mention it', async () => {
    // The heights are written when a note is LEFT, while other UI-state
    // writes (a cursor move, an anchor update) happen far more often and
    // carry no heights at all. Those must not erase the survey -- which is
    // exactly what a plain `SET previewBlockHeights = ?` would do, and is why
    // this column uses the same CASE WHEN arm as the block cache.
    const noteId = createNote()
    db.saveNoteUiState(noteId, { previewBlockHeights: heightsBlob })
    db.saveNoteUiState(noteId, { anchorBlockIndex: 7 })

    const uiState = db.getNoteUiState(noteId)
    expect(uiState.previewBlockHeights).toBe(heightsBlob)
    expect(uiState.anchorBlockIndex).toBe(7)
  })

  it('reports no survey for a note that has never been measured', async () => {
    const noteId = createNote()
    expect(db.getNoteUiState(noteId).previewBlockHeights).toBeNull()
  })
})
