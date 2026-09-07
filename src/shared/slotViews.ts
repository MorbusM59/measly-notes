// Which non-note thing an editor slot is currently given over to, and what
// it owes the reader when it stops.
//
// A slot normally shows a note. Three things can take it over instead: the
// User Guide, the adventure, and an undocked note. Each remembers what the
// slot was showing so it can hand it back, and each is a TOGGLE with a lit
// control -- which is precisely why the arithmetic below has to live in one
// tested place rather than in each opener.
//
// It did not, and the bug that produced was this: opening the adventure
// while the guide was up recorded "what the slot is showing" literally --
// the guide's own note. Leaving the adventure then restored the User Guide
// as an ordinary note in the slot, with its toggle dark, which is a state
// the app otherwise has no way to be in. Two openers agreeing about a rule
// this fiddly by copying each other is not a design; the rule is:
//
//   1. Views are MUTUALLY EXCLUSIVE. Opening one closes the others, always
//      -- not by dropping their state on the floor, but by taking over what
//      they were holding.
//   2. A view opening over another view in the SAME slot INHERITS its
//      memory. What the reader wants back is the note they were on before
//      any of this started, never the previous view's own artefact.
//   3. A view being displaced from a DIFFERENT slot hands that slot back
//      its own remembered note, since nothing is taking over there.
//
// Pure and shape-only: no React, no persistence, no note loading. The
// caller applies the plan (App.tsx).

export interface SlotView {
  sectionId: string
  previousNoteId: string | null
}

export interface UndockedNoteView extends SlotView {
  noteId: string
}

/** The three view fields, exactly as App.tsx and PersistedMenuState carry them. */
export interface SlotViewsSnapshot {
  guideView: SlotView | null
  adventureView: SlotView | null
  undockedNote: UndockedNoteView | null
}

export type SlotViewKind = 'guide' | 'adventure'

export interface SlotHandback {
  sectionId: string
  /** The note that slot must go back to; null means it must go back to empty. */
  noteId: string | null
}

export interface SlotViewOpenPlan {
  /** The complete next state of all three fields -- persist this, whole. */
  next: SlotViewsSnapshot
  /**
   * What the newly opened view must remember, per rule 2 above. NOT simply
   * the slot's current note.
   */
  previousNoteId: string | null
  /**
   * Slots OTHER than the one being opened into that were holding a view and
   * now are not, with the note each owes back (rule 3). Empty in the common
   * case; a caller that only ever opens into the active slot still has to
   * apply these, since a view can be lit in a slot the reader has since
   * navigated away from.
   */
  handbacks: SlotHandback[]
}

/**
 * The state after opening `kind` in `sectionId`, given what the slot is
 * showing right now (`currentNoteId`) and which views are up.
 *
 * Re-opening the same kind in the same slot is idempotent: the view keeps
 * the memory it already had rather than re-recording its own contents as
 * the thing to restore.
 */
export function planSlotViewOpen(
  kind: SlotViewKind,
  sectionId: string,
  currentNoteId: string | null,
  current: SlotViewsSnapshot,
): SlotViewOpenPlan {
  const viewsHere = [current.guideView, current.adventureView, current.undockedNote].filter(
    (view): view is SlotView => view?.sectionId === sectionId,
  )

  // Rule 2: inherit, do not re-record. Whichever view is holding this slot
  // already knows the answer; only an unheld slot answers with its own note.
  const previousNoteId = viewsHere.length > 0 ? viewsHere[0].previousNoteId : currentNoteId

  // Rule 3: a view lit somewhere else is closed properly, not forgotten.
  const handbacks: SlotHandback[] = []
  for (const view of [current.guideView, current.adventureView, current.undockedNote]) {
    if (!view || view.sectionId === sectionId) continue
    handbacks.push({ sectionId: view.sectionId, noteId: view.previousNoteId })
  }

  const opened: SlotView = { sectionId, previousNoteId }
  return {
    next: {
      guideView: kind === 'guide' ? opened : null,
      adventureView: kind === 'adventure' ? opened : null,
      undockedNote: null,
    },
    previousNoteId,
    handbacks,
  }
}
