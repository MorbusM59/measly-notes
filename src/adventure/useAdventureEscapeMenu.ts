// The only React in the adventure module, and the only place that knows the
// game is played through the escape-hold ring. Everything above it
// (engine.ts, rules.ts, content/) is pure data and pure functions;
// everything below it (EscapeHoldPanel.tsx and the two bars) knows about
// modes, cells and status, but not about adventures. This file is the
// hinge, and it is deliberately the only file that would have to change to
// play the same game somewhere else.
//
// It owns no state at all. The run lives in App.tsx alongside every other
// persisted value, because it must be written to app-state.json the moment
// it changes (CLAUDE.md, on the two halves of state persistence) and a hook
// keeping its own copy would be a second source of truth for it. Whether
// the game is on screen is not this hook's either: that is App's
// `adventureView`, a slot-level view exactly like the User Guide's, which
// is what makes the game appear over an EMPTY editor rather than on top of
// whatever note the reader had open.

import { useCallback, useEffect, useMemo } from 'react'
import {
  EMPTY_ESCAPE_MENU_CONTRIBUTION,
  type EscapeMenuCell,
  type EscapeMenuContribution,
  type EscapeMenuMode,
} from '../escapeMenu/escapeMenuContract'
import { findAdventure, getDefaultAdventure } from './content'
import { applyChoice, createSession, getCurrentScene, listChoices, summarizeStats } from './engine'
import { judgeResume } from './session'
import type { AdventureSession } from './types'

export interface AdventureEscapeMenuOptions {
  /**
   * Whether the game currently owns an editor slot (App's `adventureView`).
   * Everything this hook produces is gated on it: the ring's takeover, and
   * the status the tab/chapter bars show around the empty editor.
   */
  isAdventureViewActive: boolean
  /** The persisted run, or null. Owned by App.tsx; see the module comment. */
  session: AdventureSession | null
  /**
   * Commits a run. Called after every choice, and the caller persists
   * immediately -- a choice the player made and the app then forgot is the
   * one failure this module cannot recover from. Never called with null:
   * discarding a run happens through `onLeave` instead, so that the clear
   * and the close reach the persistence layer as ONE write (see its note).
   */
  onCommitSession: (session: AdventureSession) => void
  /**
   * Closes the whole adventure view, giving the slot back whatever it held
   * before. Leaving the game is a slot-level act now, not a menu-level one:
   * dismissing the ring alone just lowers it over a game still in progress.
   *
   * `clearRun` additionally throws the run away -- what "Close the book" on
   * a finished one does. It is a parameter rather than a separate
   * onCommitSession(null) call because the two changes must be persisted
   * together: as two calls in one handler, the second rebuilt its snapshot
   * from state the first had not re-rendered yet and restored the run it
   * had just cleared.
   */
  onLeave: (options?: { clearRun?: boolean }) => void
}

export function useAdventureEscapeMenu(options: AdventureEscapeMenuOptions): EscapeMenuContribution {
  const { isAdventureViewActive, session, onCommitSession, onLeave } = options

  // The story this run belongs to -- not necessarily the default one, since
  // a saved run outlives the catalogue's ordering and a second story would
  // otherwise silently resume as the first.
  const definition = useMemo(() => findAdventure(session?.adventureId), [session?.adventureId])
  const verdict = useMemo(() => judgeResume(session, definition), [session, definition])

  const startFresh = useCallback(() => {
    onCommitSession(createSession(getDefaultAdventure()))
  }, [onCommitSession])

  // Opening the view is the only gesture the player makes; whether that
  // means "start" or "carry on" is this hook's business, not the caller's.
  // A run that cannot be continued -- none saved, or one whose story has
  // moved underneath it (judgeResume's 'stale') -- is replaced by a fresh
  // one here. A FINISHED run is deliberately not: its ending is the last
  // thing the story said, and it stays on screen until the player dismisses
  // it themselves.
  useEffect(() => {
    if (!isAdventureViewActive) return
    if (verdict === null || verdict.kind === 'stale') startFresh()
  }, [isAdventureViewActive, verdict, startFresh])

  const activeMode = useMemo<EscapeMenuMode | null>(() => {
    if (!isAdventureViewActive || !session || !definition) return null
    const scene = getCurrentScene(definition, session)
    const isOver = !scene || session.status === 'ended'

    const status = {
      // "Adventure" rather than the story's name: this pill says what kind
      // of thing the slot is holding (its neighbour in that role is "User
      // Guide"), and it clips at 120px. The story names itself on the
      // status bar below, where there is room.
      title: 'Adventure',
      subject: definition.title,
      headline: scene?.prompt ?? 'The way back has closed behind you.',
      readouts: summarizeStats(definition, session).map((stat) => ({
        key: stat.key,
        label: stat.short,
        value: String(stat.value),
      })),
    }

    // Always available, in both states: starting over is how a player who
    // has read an ending, or simply lost patience with a run, gets a new
    // one. It overwrites the saved run, which is the only thing it could
    // honestly mean -- there is one run.
    const restart: EscapeMenuCell = {
      id: 'adventure-restart',
      label: 'New adventure!',
      icon: 'fa-solid fa-fire',
      keepsMenuOpen: true,
      onSelect: startFresh,
    }

    // A finished run still gets a turn on the ring: the ending is the last
    // thing the story says, and dismissing it is the player's own act
    // rather than something that happens to them while they are reading.
    if (isOver) {
      return {
        id: 'adventure',
        stepKey: `${session.startedAtMs}:${session.sceneId}:end`,
        status,
        cells: [
          restart,
          {
            id: 'adventure-finish',
            label: 'Close the book',
            icon: 'fa-solid fa-flag-checkered',
            onSelect: () => onLeave({ clearRun: true }),
          },
        ],
      }
    }

    const cells: EscapeMenuCell[] = listChoices(definition, session).map((choice) => ({
      id: choice.id,
      label: choice.label,
      icon: choice.icon,
      keepsMenuOpen: true,
      onSelect: () => onCommitSession(applyChoice(definition, session, choice.id)),
    }))
    cells.push(restart)
    // Always last: a way out that is not a story choice. It closes the menu
    // AND the view, because the game is the slot now -- and the run is
    // already saved, so the same right-click drops straight back into it.
    cells.push({
      id: 'adventure-leave',
      label: 'Set it aside',
      icon: 'fa-solid fa-xmark',
      onSelect: () => onLeave(),
    })

    return {
      id: 'adventure',
      // The turn is part of the key, not just the scene: a scene that leads
      // back to itself is still a new decision, and the dial should reset
      // for it exactly as it does for any other step.
      stepKey: `${session.startedAtMs}:${session.turn}:${session.sceneId}`,
      status,
      cells,
    }
  }, [isAdventureViewActive, session, definition, onCommitSession, onLeave, startFresh])

  return useMemo<EscapeMenuContribution>(
    () => (activeMode ? { entryCells: [], activeMode } : EMPTY_ESCAPE_MENU_CONTRIBUTION),
    [activeMode],
  )
}
