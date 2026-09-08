import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { StateService } from './stateService'
import { createSession } from '../src/adventure/engine'
import { THE_LONG_MARGIN } from '../src/adventure/content/theLongMargin'

// Regression coverage for the exact bug class this file is prone to:
// sanitizeMenu (private, routed through by both saveAppState and
// loadAppState) is a hand-maintained allowlist of PersistedMenuState's
// fields -- a field can exist on the type, be written correctly by the
// renderer, and still never actually persist in the real app if
// sanitizeMenu simply never learned about it. isDoubleSizeMode shipped this
// way for a full release: the renderer-side fix (App.tsx's
// persistedMenuStateRef) was real and necessary but insufficient on its
// own, and went undetected because it was only verified against the
// browser-mode mock (installBrowserMockBridges.ts), which clones state
// verbatim and never exercises sanitizeMenu at all. Only a test against the
// real StateService (actual file I/O, actual sanitization) can catch this.
describe('StateService app-state field round-trip', () => {
  let dataRoot: string

  beforeEach(() => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-state-test-'))
  })

  afterEach(() => {
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('persists isDoubleSizeMode across a save -> fresh-instance load, simulating an app restart', async () => {
    const writer = new StateService(dataRoot)
    await writer.saveAppState({
      selectedNoteId: null,
      menu: { sidebarMode: 'date', selectedMonths: [], selectedYears: [], searchQuery: '', isDoubleSizeMode: true },
    })

    // A fresh instance (no in-memory cache carried over) reading from disk
    // is what a real app restart does -- not reusing the same StateService
    // object, which would trivially pass via its own cachedAppState.
    const reader = new StateService(dataRoot)
    const loaded = await reader.loadAppState()
    expect(loaded.menu?.isDoubleSizeMode).toBe(true)
  })

  it('persists isDoubleSizeMode: false explicitly (not just "field present")', async () => {
    const writer = new StateService(dataRoot)
    await writer.saveAppState({
      selectedNoteId: null,
      menu: { sidebarMode: 'date', selectedMonths: [], selectedYears: [], searchQuery: '', isDoubleSizeMode: false },
    })

    const reader = new StateService(dataRoot)
    const loaded = await reader.loadAppState()
    expect(loaded.menu?.isDoubleSizeMode).toBe(false)
  })

  it('persists the wheel-spin and wheel-step sliders, including the 0 that means "off"', async () => {
    // sanitizeMenu is an allowlist, and a numeric field it never learned
    // about is dropped silently -- so a slider can be wired perfectly on the
    // renderer side and still come back at its default on every restart.
    // Zero is tested explicitly because it is a meaningful VALUE here (the
    // feature switched off), not an absent field, and the two are easy to
    // conflate in a sanitizer.
    const writer = new StateService(dataRoot)
    await writer.saveAppState({
      selectedNoteId: null,
      menu: {
        sidebarMode: 'date',
        selectedMonths: [],
        selectedYears: [],
        searchQuery: '',
        wheelSpinThresholdMs: 0,
        wheelSpinDampenDivisor: 0,
        wheelSpinCutoffMs: 350,
        wheelStepRows: 4,
        wheelStepLines: 2.7,
      },
    })

    const reader = new StateService(dataRoot)
    const loaded = await reader.loadAppState()
    expect(loaded.menu?.wheelSpinThresholdMs).toBe(0)
    expect(loaded.menu?.wheelSpinDampenDivisor).toBe(0)
    expect(loaded.menu?.wheelSpinCutoffMs).toBe(350)
    // The two step sliders travel the same allowlist, and the render view's
    // is fractional -- a sanitizer that rounded or truncated would look
    // correct on the edit view's and quietly move the other one.
    expect(loaded.menu?.wheelStepRows).toBe(4)
    expect(loaded.menu?.wheelStepLines).toBe(2.7)
  })

  it('flushAppStateOnClose (the before-quit safety net) also preserves isDoubleSizeMode', async () => {
    const writer = new StateService(dataRoot)
    await writer.saveAppState({
      selectedNoteId: null,
      menu: { sidebarMode: 'date', selectedMonths: [], selectedYears: [], searchQuery: '', isDoubleSizeMode: true },
    })
    await writer.flushAppStateOnClose()

    const reader = new StateService(dataRoot)
    const loaded = await reader.loadAppState()
    expect(loaded.menu?.isDoubleSizeMode).toBe(true)
  })

  it('round-trips every other boolean menu toggle touched by the same persistMenuStateNow consolidation (App.tsx/CLAUDE.md)', async () => {
    const writer = new StateService(dataRoot)
    await writer.saveAppState({
      selectedNoteId: null,
      menu: {
        sidebarMode: 'date',
        selectedMonths: [],
        selectedYears: [],
        searchQuery: '',
        isSidebarVisible: false,
        reviewGutterVisibleBySection: { sectionA: true },
        reviewFlagsVisibleBySection: { sectionA: false },
      },
    })

    const reader = new StateService(dataRoot)
    const loaded = await reader.loadAppState()
    expect(loaded.menu?.isSidebarVisible).toBe(false)
    expect(loaded.menu?.reviewGutterVisibleBySection).toEqual({ sectionA: true })
    expect(loaded.menu?.reviewFlagsVisibleBySection).toEqual({ sectionA: false })
  })

  it('persists the guide overlay and undocked note overlay across a save -> fresh-instance load', async () => {
    const writer = new StateService(dataRoot)
    await writer.saveAppState({
      selectedNoteId: null,
      menu: {
        sidebarMode: 'date',
        selectedMonths: [],
        selectedYears: [],
        searchQuery: '',
        guideView: { sectionId: 'section-1', previousNoteId: 'note-2' },
        undockedNote: { noteId: 'note-3', sectionId: 'section-1', previousNoteId: 'note-2' },
      },
    })

    const reader = new StateService(dataRoot)
    const loaded = await reader.loadAppState()
    expect(loaded.menu?.guideView).toEqual({ sectionId: 'section-1', previousNoteId: 'note-2' })
    expect(loaded.menu?.undockedNote).toEqual({ noteId: 'note-3', sectionId: 'section-1', previousNoteId: 'note-2' })
  })

  it('persists a saved adventure run across a save -> fresh-instance load, and drops a corrupt one', async () => {
    // Same allowlist hazard as every test above, with one extra edge: this
    // field is an object, so "present but structurally wrong" is a real
    // possibility a boolean never had. A corrupt run must come back as
    // absent -- the renderer already handles "no saved adventure" and
    // would otherwise be handed a half-run to play.
    const run = createSession(THE_LONG_MARGIN, { seed: 4242, nowMs: 1_700_000_000_000 })
    const writer = new StateService(dataRoot)
    await writer.saveAppState({
      selectedNoteId: null,
      menu: { sidebarMode: 'date', selectedMonths: [], selectedYears: [], searchQuery: '', adventure: run },
    })

    const reader = new StateService(dataRoot)
    expect((await reader.loadAppState()).menu?.adventure).toEqual(run)

    const corruptWriter = new StateService(dataRoot)
    await corruptWriter.saveAppState({
      selectedNoteId: null,
      menu: {
        sidebarMode: 'date',
        selectedMonths: [],
        selectedYears: [],
        searchQuery: '',
        adventure: { ...run, sceneId: 42 } as unknown as typeof run,
      },
    })

    const corruptReader = new StateService(dataRoot)
    expect((await corruptReader.loadAppState()).menu?.adventure).toBeNull()

    // The view is a separate field from the run and is dropped just as
    // silently if sanitizeMenu never learns about it -- which would restart
    // the app with the run intact but the game nowhere on screen.
    const viewWriter = new StateService(dataRoot)
    await viewWriter.saveAppState({
      selectedNoteId: null,
      menu: {
        sidebarMode: 'date',
        selectedMonths: [],
        selectedYears: [],
        searchQuery: '',
        adventure: run,
        adventureView: { sectionId: 'default', previousNoteId: 'note-1' },
      },
    })
    const viewReader = new StateService(dataRoot)
    expect((await viewReader.loadAppState()).menu?.adventureView).toEqual({ sectionId: 'default', previousNoteId: 'note-1' })
  })

  it('persists the unified global spellcheck toggle across a save -> fresh-instance load', async () => {
    const writer = new StateService(dataRoot)
    await writer.saveAppState({
      selectedNoteId: null,
      menu: {
        sidebarMode: 'date',
        selectedMonths: [],
        selectedYears: [],
        searchQuery: '',
        spellCheckEnabled: true,
      },
    })

    const reader = new StateService(dataRoot)
    const loaded = await reader.loadAppState()
    expect(loaded.menu?.spellCheckEnabled).toBe(true)
  })

  // The music player's sound-options row replaced the sidebar's volume/reverb
  // sliders, and its mute/bypass switches are FLAGS over retained levels
  // rather than zeroed levels -- which only works if the flags themselves
  // survive a restart. A flag missing from sanitizeMenu would be dropped
  // silently and the app would come back audible with the level intact,
  // exactly the failure mode this file exists for.
  it('persists the music sound-option flags across a save -> fresh-instance load', async () => {
    const writer = new StateService(dataRoot)
    await writer.saveAppState({
      selectedNoteId: null,
      menu: {
        sidebarMode: 'date',
        selectedMonths: [],
        selectedYears: [],
        searchQuery: '',
        musicVolume: 0.42,
        musicReverbAmount: 0.6,
        musicReverbRoom: 0.75,
        musicMuted: true,
        musicReverbBypassed: true,
        musicSoundOptionsOpen: true,
      },
    })

    const reader = new StateService(dataRoot)
    const loaded = await reader.loadAppState()
    expect(loaded.menu?.musicMuted).toBe(true)
    expect(loaded.menu?.musicReverbBypassed).toBe(true)
    expect(loaded.menu?.musicSoundOptionsOpen).toBe(true)
    // The levels are retained, not destroyed, by the flags being on.
    expect(loaded.menu?.musicVolume).toBe(0.42)
    expect(loaded.menu?.musicReverbAmount).toBe(0.6)
    expect(loaded.menu?.musicReverbRoom).toBe(0.75)
  })

  // The sixth ("Lounge") bucket needs the persisted-slot allowlist to know
  // about it; sanitizeMusicActiveSlots hard-coded 1-5 before it existed.
  it('persists an active slot from the full playlist range', async () => {
    const writer = new StateService(dataRoot)
    await writer.saveAppState({
      selectedNoteId: null,
      menu: {
        sidebarMode: 'date',
        selectedMonths: [],
        selectedYears: [],
        searchQuery: '',
        musicActiveSlots: [1, 6, 7, 0],
      },
    })

    const reader = new StateService(dataRoot)
    const loaded = await reader.loadAppState()
    expect(loaded.menu?.musicActiveSlots).toEqual([1, 6])
  })

  it('clearAppState resets persisted app state back to the default baseline', async () => {
    const writer = new StateService(dataRoot)
    await writer.saveAppState({
      selectedNoteId: 'note-123',
      menu: {
        sidebarMode: 'find',
        selectedMonths: [3],
        selectedYears: [2024],
        searchQuery: 'stale query',
        guideView: { sectionId: 'section-1', previousNoteId: 'note-2' },
        undockedNote: { noteId: 'note-3', sectionId: 'section-1', previousNoteId: 'note-2' },
        debuggingEnabled: true,
      },
    })

    await writer.clearAppState()

    const reader = new StateService(dataRoot)
    const loaded = await reader.loadAppState()
    expect(loaded.selectedNoteId).toBeNull()
    expect(loaded.menu?.sidebarMode).toBe('date')
    expect(loaded.menu?.searchQuery).toBe('')
    expect(loaded.menu?.guideView).toBeUndefined()
    expect(loaded.menu?.undockedNote).toBeUndefined()
    expect(loaded.menu?.debuggingEnabled).toBe(false)
  })
})
