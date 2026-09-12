// The only React in the adventure module, and the only file that knows the
// game is played through the escape-hold ring.
//
// Everything above it (core/, model/, content/, stages/) is pure data and
// pure functions; everything below it (EscapeHoldPanel.tsx and the two
// bars) knows about modes, cells and status but nothing about adventures.
// This file is the hinge, and it is deliberately the only file that would
// have to change to play the same game somewhere else.
//
// It owns no state. The save lives in App.tsx alongside every other
// persisted value, because it must reach disk the moment it changes
// (CLAUDE.md, on the two halves of state persistence) and a hook keeping
// its own copy would be a second source of truth for it. Whether the game
// is on screen is not this hook's either: that is App's `adventureView`, a
// slot-level view exactly like the User Guide's, which is what makes the
// game appear over an EMPTY editor rather than on top of somebody's note.

import { useCallback, useEffect, useMemo } from 'react'
import {
  EMPTY_ESCAPE_MENU_CONTRIBUTION,
  type EscapeMenuCell,
  type EscapeMenuContribution,
  type EscapeMenuMode,
} from '../escapeMenu/escapeMenuContract'
import { buildCatalog, THOCKQUEST } from './content'
import { choose, currentScreen, ensureEntered, type DirectorDeps } from './core/director'
import { emptySave, type GameSave } from './model/gameState'
import { createSeed } from './core/rng'
import { CORE_STAGE_IDS, ROOT_STAGE_ID, STAGES } from './stages'
import { statusReadouts, statusSubject } from './status'

const CATALOG = buildCatalog(THOCKQUEST)

const DEPS: DirectorDeps = {
  stages: STAGES,
  content: THOCKQUEST,
  catalog: CATALOG,
  rootStageId: ROOT_STAGE_ID,
  coreStageIds: CORE_STAGE_IDS,
}

function regionNameOf(regionId: string): string | null {
  return THOCKQUEST.regions.find((region) => region.id === regionId)?.name ?? null
}

export interface AdventureEscapeMenuOptions {
  /**
   * Whether the game currently owns an editor slot (App's `adventureView`).
   * Everything this hook produces is gated on it: the ring's takeover, and
   * the status the tab and chapter bars show around the empty editor.
   */
  isAdventureViewActive: boolean
  /** The persisted save, or null before anything has ever been played. */
  save: GameSave | null
  /**
   * Commits a save. Called after every choice, and the caller persists
   * immediately -- a choice the player made and the app then forgot is the
   * one failure this module cannot recover from.
   */
  onCommitSave: (save: GameSave) => void
  /**
   * Closes the whole adventure view, giving the slot back whatever it held.
   * Leaving is a slot-level act, not a menu-level one: dismissing the ring
   * alone just lowers it over a game still in progress. The save is
   * untouched -- the same right-click drops straight back into the same
   * screen, which is the whole promise the persisted stack exists to keep.
   */
  onLeave: () => void
}

export function useAdventureEscapeMenu(options: AdventureEscapeMenuOptions): EscapeMenuContribution {
  const { isAdventureViewActive, save, onCommitSave, onLeave } = options

  /**
   * Puts the player somewhere to be. Runs on OPENING the view rather than
   * during render, because entering a stage may roll -- and a roll during
   * render would make the draw order depend on how many times React
   * re-rendered, which is the one thing a replayable game cannot survive
   * (core/rng.ts). It is idempotent, so a re-render that re-runs it is
   * harmless.
   */
  useEffect(() => {
    if (!isAdventureViewActive) return
    const now = Date.now()
    const current = save ?? emptySave(createSeed(now))
    const entered = ensureEntered(current, DEPS, now)
    if (entered !== current || save === null) onCommitSave(entered)
  }, [isAdventureViewActive, save, onCommitSave])

  const handleChoice = useCallback(
    (choiceId: string) => {
      if (!save) return
      const result = choose(save, choiceId, DEPS, Date.now())
      if (result.save !== save) onCommitSave(result.save)
      if (result.hostAction === 'leave') onLeave()
    },
    [save, onCommitSave, onLeave],
  )

  const activeMode = useMemo<EscapeMenuMode | null>(() => {
    if (!isAdventureViewActive || !save) return null
    const screen = currentScreen(save, DEPS)
    if (!screen) return null

    const cells: EscapeMenuCell[] = screen.choices.map((choice) => ({
      id: choice.id,
      label: choice.label,
      icon: choice.icon,
      // Every cell keeps the menu up: the ring IS the game, and a choice
      // that closed it would end the session rather than advance it. The
      // one exception is leaving, which the director reports as a host
      // action instead -- so even that is not the cell's own decision.
      keepsMenuOpen: true,
      onSelect: () => handleChoice(choice.id),
    }))

    return {
      id: 'adventure',
      stepKey: screen.screenKey,
      cells,
      // The ring IS the game, so lowering it leaves the game. Anything else
      // leaves the slot occupied by an empty editor with the toggle lit --
      // a view the player can see the effects of but not reach.
      onDismiss: onLeave,
      status: {
        // "Adventure" rather than the game's name: this pill says what KIND
        // of thing the slot is holding (its neighbour in that role is "User
        // Guide"), and it clips at 120px. The game names itself below,
        // where there is room.
        title: 'Adventure',
        subject: statusSubject(save, regionNameOf),
        headline: screen.narration,
        readouts: statusReadouts(save, CATALOG),
      },
    }
  }, [isAdventureViewActive, save, handleChoice, onLeave])

  return useMemo<EscapeMenuContribution>(
    () => (activeMode ? { entryCells: [], activeMode } : EMPTY_ESCAPE_MENU_CONTRIBUTION),
    [activeMode],
  )
}
