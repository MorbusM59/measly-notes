// The catalogue of playable stories. One today; the registry exists so the
// second one costs a line here and nothing anywhere else -- the engine, the
// session format, the persistence sanitizer and the escape-menu glue all
// key off `AdventureDefinition.id` rather than off there being exactly one
// story.

import type { AdventureDefinition } from '../types'
import { THE_LONG_MARGIN } from './theLongMargin'

export const ADVENTURES: readonly AdventureDefinition[] = [THE_LONG_MARGIN]

/** What "New adventure!" starts. */
export const DEFAULT_ADVENTURE_ID = THE_LONG_MARGIN.id

export function findAdventure(adventureId: string | undefined | null): AdventureDefinition | null {
  if (!adventureId) return null
  return ADVENTURES.find((adventure) => adventure.id === adventureId) ?? null
}

export function getDefaultAdventure(): AdventureDefinition {
  return THE_LONG_MARGIN
}
