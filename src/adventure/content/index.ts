// Content: everything the game is made of that a player never changes.
//
// Ships with the app, is never written, and changes every release -- which
// is exactly why it is TypeScript data rather than rows in the save
// database. A copy in the database would need a migration per content edit
// and could drift from the code that reads it; a copy in code cannot.
//
// The save refers to all of this BY ID and tolerates an id that content no
// longer has (dropped, never crashed on), which is what lets an item or a
// region be deleted without breaking somebody's game.
//
// WHAT IS AND IS NOT SPECIFIED: the game's rules document leaves large
// parts deliberately blank, and this module does not fill them in. An entry
// whose effect has not been decided carries a `tag` effect that says so, in
// words, which means an unspecified trait is visible AS unspecified -- in
// the tab bar, to the player, rather than as a plausible number nobody
// chose. See docs/adventure-platform.md.

import type { Modifier } from '../model/modifiers'
import type { StatKey } from '../model/stats'

/** What you were, before any of this. Chosen once, at the start of a game. */
export interface Origin {
  id: string
  name: string
  icon: string
  statDeltas: Partial<Record<StatKey, number>>
}

/**
 * Where a level is played. A region is meant to determine which encounters
 * and which monsters are in scope for that level; those pools are NOT
 * specified yet, so a region is currently a name and nothing more. The
 * fields for the pools are not written until there is something to put in
 * them -- an empty array is a promise, and this document does not make ones
 * it cannot keep.
 */
export interface Region {
  id: string
  name: string
  icon: string
}

export interface Content {
  origins: readonly Origin[]
  items: readonly Modifier[]
  traits: readonly Modifier[]
  regions: readonly Region[]
}

export function buildCatalog(content: Content): ReadonlyMap<string, Modifier> {
  return new Map([...content.items, ...content.traits].map((modifier) => [modifier.id, modifier]))
}

/**
 * Everything that can be wrong with content, as a list of complaints rather
 * than a throw. Run in a test, not at launch: content is fixed at build
 * time, so a content error is a failing test on somebody's branch, never a
 * crash in somebody's evening.
 */
export function validateContent(content: Content): string[] {
  const problems: string[] = []
  const seen = new Set<string>()

  const check = (id: string, where: string) => {
    if (id.length === 0) problems.push(`${where} has an empty id`)
    if (seen.has(id)) problems.push(`duplicate id "${id}" (${where})`)
    seen.add(id)
  }

  for (const origin of content.origins) check(origin.id, `origin "${origin.name}"`)
  for (const region of content.regions) check(region.id, `region "${region.name}"`)
  for (const item of content.items) {
    check(item.id, `item "${item.name}"`)
    if (item.kind !== 'item') problems.push(`item "${item.id}" is declared as a ${item.kind}`)
  }
  for (const trait of content.traits) {
    check(trait.id, `trait "${trait.name}"`)
    if (trait.kind !== 'trait') problems.push(`trait "${trait.id}" is declared as a ${trait.kind}`)
  }

  if (content.origins.length === 0) problems.push('no origins: character creation would have nothing to offer')
  if (content.regions.length === 0) problems.push('no regions: a level would have nowhere to happen')

  return problems
}

export { THOCKQUEST } from './thockquest'
