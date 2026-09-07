import { describe, expect, it } from 'vitest'
import { planSlotViewOpen, type SlotViewsSnapshot } from './slotViews'

const EMPTY: SlotViewsSnapshot = { guideView: null, adventureView: null, undockedNote: null }

describe('planSlotViewOpen', () => {
  it('remembers the slot\'s own note when nothing is holding it', () => {
    const plan = planSlotViewOpen('adventure', 'left', 'note-a', EMPTY)
    expect(plan.previousNoteId).toBe('note-a')
    expect(plan.next.adventureView).toEqual({ sectionId: 'left', previousNoteId: 'note-a' })
    expect(plan.next.guideView).toBeNull()
    expect(plan.handbacks).toEqual([])
  })

  it('remembers an empty slot as empty rather than as "no memory"', () => {
    expect(planSlotViewOpen('adventure', 'left', null, EMPTY).previousNoteId).toBeNull()
  })

  it('inherits the displaced view\'s memory instead of recording its artefact', () => {
    // The bug this module exists for: opening the adventure over the guide
    // used to record the GUIDE'S OWN NOTE as the thing to restore, so
    // leaving the adventure left the User Guide sitting in the slot as an
    // ordinary note with its toggle dark.
    const withGuide: SlotViewsSnapshot = {
      ...EMPTY,
      guideView: { sectionId: 'left', previousNoteId: 'note-a' },
    }
    const plan = planSlotViewOpen('adventure', 'left', 'HELPGUIDE', withGuide)
    expect(plan.previousNoteId).toBe('note-a')
    expect(plan.next.guideView).toBeNull()
    expect(plan.next.adventureView).toEqual({ sectionId: 'left', previousNoteId: 'note-a' })
  })

  it('is symmetric: the guide opening over the adventure inherits too', () => {
    const withAdventure: SlotViewsSnapshot = {
      ...EMPTY,
      adventureView: { sectionId: 'left', previousNoteId: 'note-a' },
    }
    const plan = planSlotViewOpen('guide', 'left', null, withAdventure)
    expect(plan.previousNoteId).toBe('note-a')
    expect(plan.next.adventureView).toBeNull()
    expect(plan.next.guideView).toEqual({ sectionId: 'left', previousNoteId: 'note-a' })
  })

  it('leaves exactly one view lit, whichever was open before', () => {
    for (const kind of ['guide', 'adventure'] as const) {
      const plan = planSlotViewOpen(kind, 'left', 'note-a', {
        guideView: { sectionId: 'left', previousNoteId: 'note-a' },
        adventureView: null,
        undockedNote: { sectionId: 'right', previousNoteId: 'note-b', noteId: 'note-c' },
      })
      const lit = [plan.next.guideView, plan.next.adventureView, plan.next.undockedNote].filter(Boolean)
      expect(lit).toHaveLength(1)
    }
  })

  it('re-opening the same view in the same slot is idempotent', () => {
    const withAdventure: SlotViewsSnapshot = {
      ...EMPTY,
      adventureView: { sectionId: 'left', previousNoteId: 'note-a' },
    }
    const plan = planSlotViewOpen('adventure', 'left', null, withAdventure)
    expect(plan.previousNoteId).toBe('note-a')
    expect(plan.next.adventureView).toEqual(withAdventure.adventureView)
  })

  it('hands a displaced view\'s OTHER slot back its own note', () => {
    const plan = planSlotViewOpen('adventure', 'right', 'note-b', {
      ...EMPTY,
      guideView: { sectionId: 'left', previousNoteId: 'note-a' },
    })
    expect(plan.handbacks).toEqual([{ sectionId: 'left', noteId: 'note-a' }])
    expect(plan.previousNoteId).toBe('note-b')
  })

  it('hands back an empty slot as empty', () => {
    const plan = planSlotViewOpen('guide', 'right', null, {
      ...EMPTY,
      adventureView: { sectionId: 'left', previousNoteId: null },
    })
    expect(plan.handbacks).toEqual([{ sectionId: 'left', noteId: null }])
  })
})
