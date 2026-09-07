// Everything about a run that has to survive leaving the app: the
// structural sanitizer the main process runs on the saved JSON, and the
// renderer-side judgment of whether a structurally-valid saved run can
// still be resumed against the story as it now ships.
//
// The two are deliberately different jobs done in different places.
// electron/stateService.ts cannot know anything about story content -- it
// is a file reader whose only defence is that a field is the shape it
// claims to be (CLAUDE.md: a PersistedMenuState field missing from
// sanitizeMenu is silently dropped on every read and write, which is how
// settings have shipped broken before). Deciding whether scene
// "the-lantern" still exists is content's business, and content lives in
// the renderer, so it happens there, on load, once.

import { getScene } from './engine'
import { ADVENTURE_SESSION_VERSION, type AdventureDefinition, type AdventureSession } from './types'

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function sanitizeStringArray(input: unknown): string[] {
  return Array.isArray(input) ? input.filter((value): value is string => typeof value === 'string') : []
}

function sanitizeStats(input: unknown): Record<string, number> {
  if (!input || typeof input !== 'object') return {}
  const stats: Record<string, number> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (isFiniteNumber(value)) stats[key] = value
  }
  return stats
}

function sanitizeHistory(input: unknown): AdventureSession['history'] {
  if (!Array.isArray(input)) return []
  return input.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const { sceneId, choiceId, resultSceneId } = entry as Record<string, unknown>
    if (typeof sceneId !== 'string' || typeof choiceId !== 'string' || typeof resultSceneId !== 'string') return []
    return [{ sceneId, choiceId, resultSceneId }]
  })
}

/**
 * Structural sanitize of a persisted run. Returns null for anything that is
 * not a complete, self-consistent session -- absent, wrong-typed, or from a
 * future/older save format. Null means "there is no saved adventure", which
 * every caller already has to handle, so a corrupt save degrades to a fresh
 * start rather than to a crash on launch.
 *
 * Nothing here is content-aware on purpose: see the module comment.
 */
export function sanitizeAdventureSession(input: unknown): AdventureSession | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>

  if (raw.version !== ADVENTURE_SESSION_VERSION) return null
  if (typeof raw.adventureId !== 'string' || raw.adventureId.length === 0) return null
  if (typeof raw.sceneId !== 'string' || raw.sceneId.length === 0) return null
  if (!isFiniteNumber(raw.contentVersion)) return null
  if (!isFiniteNumber(raw.seed) || !isFiniteNumber(raw.rngState)) return null
  if (raw.status !== 'active' && raw.status !== 'ended') return null

  const turn = isFiniteNumber(raw.turn) ? Math.max(0, Math.floor(raw.turn)) : 0
  const startedAtMs = isFiniteNumber(raw.startedAtMs) ? raw.startedAtMs : 0
  const updatedAtMs = isFiniteNumber(raw.updatedAtMs) ? raw.updatedAtMs : startedAtMs

  return {
    version: ADVENTURE_SESSION_VERSION,
    adventureId: raw.adventureId,
    contentVersion: raw.contentVersion,
    seed: Math.floor(Math.abs(raw.seed)) >>> 0,
    rngState: Math.floor(Math.abs(raw.rngState)) >>> 0,
    sceneId: raw.sceneId,
    stats: sanitizeStats(raw.stats),
    flags: sanitizeStringArray(raw.flags),
    visited: sanitizeStringArray(raw.visited),
    history: sanitizeHistory(raw.history),
    turn,
    status: raw.status,
    ...(typeof raw.endingId === 'string' ? { endingId: raw.endingId } : {}),
    startedAtMs,
    updatedAtMs,
  }
}

export type AdventureResumeVerdict =
  | { kind: 'resumable' }
  | { kind: 'finished' }
  | { kind: 'stale'; reason: 'unknown-adventure' | 'content-moved' | 'unknown-scene' }

/**
 * Whether a saved run can be picked up where it stopped, and if not, why.
 * The reason is not decoration: "finished" offers a new run, "stale" says
 * the story changed under a run in progress, and those read very
 * differently to a player who left one going.
 */
export function judgeResume(
  session: AdventureSession | null,
  definition: AdventureDefinition | null,
): AdventureResumeVerdict | null {
  if (!session) return null
  if (!definition || definition.id !== session.adventureId) return { kind: 'stale', reason: 'unknown-adventure' }
  if (session.status === 'ended') return { kind: 'finished' }
  if (definition.contentVersion !== session.contentVersion) return { kind: 'stale', reason: 'content-moved' }
  if (!getScene(definition, session.sceneId)) return { kind: 'stale', reason: 'unknown-scene' }
  return { kind: 'resumable' }
}
