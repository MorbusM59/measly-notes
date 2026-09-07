// The only React in the adventure module, and the only place that knows the
// game is played inside the escape-hold ring. Everything above it
// (engine.ts, rules.ts, content/) is pure data and pure functions;
// everything below it (EscapeHoldPanel.tsx) knows about modes and cells but
// not about adventures. This file is the hinge, and it is deliberately the
// only file that would have to change to play the same game somewhere else.
//
// It owns exactly one piece of state: whether the ring is currently *being*
// the game. The run itself is not state here -- it lives in App.tsx
// alongside every other persisted value and arrives back as a prop, because
// a run has to be written to app-state.json the moment it changes (see
// CLAUDE.md on the two halves of state persistence) and a hook that kept
// its own copy would be a second source of truth for it.

import { useCallback, useEffect, useMemo, useState } from 'react'
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
   * Whether the escape menu currently belongs to the User Guide. The game
   * is reachable from there and nowhere else -- a deliberate placement, not
   * a technical limit: it is a thing you find while reading about the app,
   * and the quick-actions ring everywhere else stays about notes.
   */
  isGuideActive: boolean
  /**
   * Whether the escape menu is up at all. Closing it leaves the game (the
   * run is saved and offered again as "Continue adventure"), so this hook
   * has to see the menu go down.
   */
  isMenuOpen: boolean
  /** The persisted run, or null. Owned by App.tsx; see the module comment. */
  session: AdventureSession | null
  /**
   * Commits a run. Called with a new session after every choice and with
   * null when a run is finished and dismissed. The caller is responsible
   * for persisting immediately -- a choice the player made and the app then
   * forgot is the one failure this module cannot recover from.
   */
  onCommitSession: (session: AdventureSession | null) => void
}

/**
 * Reads as "LAN 3 · RES 2 · INS 1" under the prompt. Abbreviated because
 * the whole line has to fit one row inside a circle about 100px across --
 * see AdventureStatDefinition.short, which is content's own call rather
 * than a truncation done here.
 */
function formatStatLine(stats: Array<{ short: string; value: number }>): string {
  return stats.map((stat) => `${stat.short} ${stat.value}`).join(' · ')
}

export function useAdventureEscapeMenu(options: AdventureEscapeMenuOptions): EscapeMenuContribution {
  const { isGuideActive, isMenuOpen, session, onCommitSession } = options

  // Ephemeral by design: "the ring is currently the game" is a property of
  // this visit to the menu, not of the run. The run's own continuity is
  // carried entirely by the saved session, which is what makes closing the
  // menu mid-adventure a safe, ordinary thing to do rather than a way to
  // lose progress.
  const [isPlaying, setIsPlaying] = useState(false)

  useEffect(() => {
    if (!isMenuOpen) setIsPlaying(false)
  }, [isMenuOpen])

  // A run played to its end has nothing left to resume; leaving the ring
  // in game mode would show a dead prompt on the next visit.
  useEffect(() => {
    if (!session) setIsPlaying(false)
  }, [session])

  // The story this run belongs to -- not necessarily the default one, since
  // a saved run outlives the catalogue's ordering and a second story would
  // otherwise silently resume as the first.
  const sessionDefinition = useMemo(() => findAdventure(session?.adventureId), [session?.adventureId])
  const resumeVerdict = useMemo(() => judgeResume(session, sessionDefinition), [session, sessionDefinition])

  const startNewAdventure = useCallback(() => {
    onCommitSession(createSession(getDefaultAdventure()))
    setIsPlaying(true)
  }, [onCommitSession])

  const entryCells = useMemo<EscapeMenuCell[]>(() => {
    if (!isGuideActive) return []
    const cells: EscapeMenuCell[] = [
      {
        id: 'adventure-new',
        label: 'New adventure!',
        icon: 'fa-solid fa-fire',
        // Every entry cell keeps the menu up: selecting one does not *do*
        // something and get out of the way, it hands the ring over.
        keepsMenuOpen: true,
        onSelect: startNewAdventure,
      },
    ]
    // Offered only for a run that can genuinely be picked up where it
    // stopped. A finished run, or one whose story has changed underneath
    // it (judgeResume's 'stale'), silently offers only a fresh start --
    // there is nothing coherent for "continue" to mean in either case.
    if (resumeVerdict?.kind === 'resumable') {
      cells.push({
        id: 'adventure-continue',
        label: 'Continue adventure',
        icon: 'fa-solid fa-hourglass-half',
        keepsMenuOpen: true,
        onSelect: () => setIsPlaying(true),
      })
    }
    return cells
  }, [isGuideActive, resumeVerdict, startNewAdventure])

  const activeMode = useMemo<EscapeMenuMode | null>(() => {
    if (!isPlaying || !session || !sessionDefinition) return null
    const scene = getCurrentScene(sessionDefinition, session)
    const detail = formatStatLine(summarizeStats(sessionDefinition, session))

    // A finished run still gets a turn on the ring: the ending is the last
    // thing the story says, and dismissing it is the player's own act
    // rather than something that happens to them while they are reading.
    if (!scene || session.status === 'ended') {
      return {
        id: 'adventure',
        stepKey: `${session.startedAtMs}:${session.sceneId}:end`,
        prompt: scene?.prompt ?? 'The way back has closed behind you.',
        detail,
        cells: [
          {
            id: 'adventure-finish',
            label: 'Close the book',
            icon: 'fa-solid fa-flag-checkered',
            onSelect: () => {
              onCommitSession(null)
              setIsPlaying(false)
            },
          },
        ],
      }
    }

    const cells: EscapeMenuCell[] = listChoices(sessionDefinition, session).map((choice) => ({
      id: choice.id,
      label: choice.label,
      icon: choice.icon,
      keepsMenuOpen: true,
      onSelect: () => onCommitSession(applyChoice(sessionDefinition, session, choice.id)),
    }))

    // Always last, always present: a way out that is not a story choice.
    // It closes the menu (keepsMenuOpen is not set) precisely because
    // leaving mid-run is not a move in the game -- the run is already
    // saved, and "Continue adventure" is waiting on the next visit.
    cells.push({
      id: 'adventure-set-aside',
      label: 'Set it aside',
      icon: 'fa-solid fa-xmark',
      onSelect: () => setIsPlaying(false),
    })

    return {
      id: 'adventure',
      // The turn is part of the key, not just the scene: a scene that leads
      // back to itself is still a new decision, and the dial should reset
      // for it exactly as it does for any other step.
      stepKey: `${session.startedAtMs}:${session.turn}:${session.sceneId}`,
      prompt: scene.prompt,
      detail,
      cells,
    }
  }, [isPlaying, session, sessionDefinition, onCommitSession])

  return useMemo<EscapeMenuContribution>(() => {
    if (entryCells.length === 0 && !activeMode) return EMPTY_ESCAPE_MENU_CONTRIBUTION
    return { entryCells, activeMode }
  }, [entryCells, activeMode])
}
