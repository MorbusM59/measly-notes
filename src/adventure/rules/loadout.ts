// What the player is carrying, and the rule that empties it every round.
//
// The rule is unusual enough to be worth stating as its own module: at the
// end of a round the player keeps ONE piece of gear and ONE trait, and
// everything else goes -- including whatever they kept last time. So the
// carry-over is never a growing pile; it is exactly two things, chosen
// fresh each round from everything currently held. That is what stops the
// run from being decided by round three, and it is why "kept" and "gained
// this round" are separate fields rather than one list: the distinction
// disappears the moment they are merged, and with it the ability to offer
// the choice at all.
//
// Ids, not objects, because a loadout is saved state -- see modifiers.ts's
// note on resolving ids against the catalog.

import { resolveModifiers, type Modifier, type ModifierCatalog, type ModifierKind } from './modifiers'

export interface Loadout {
  /** The one piece of gear carried in from previous rounds, if any. */
  keptGearId: string | null
  /** The one trait carried in from previous rounds, if any. */
  keptTraitId: string | null
  /** Acquired during the current round -- discarded unless kept at its end. */
  roundGearIds: readonly string[]
  roundTraitIds: readonly string[]
}

export const EMPTY_LOADOUT: Loadout = {
  keptGearId: null,
  keptTraitId: null,
  roundGearIds: [],
  roundTraitIds: [],
}

/** Everything in effect right now, kept and temporary alike. */
export function heldModifierIds(loadout: Loadout): string[] {
  return [
    ...(loadout.keptGearId ? [loadout.keptGearId] : []),
    ...(loadout.keptTraitId ? [loadout.keptTraitId] : []),
    ...loadout.roundGearIds,
    ...loadout.roundTraitIds,
  ]
}

export function heldModifiers(loadout: Loadout, catalog: ModifierCatalog): Modifier[] {
  return resolveModifiers(heldModifierIds(loadout), catalog)
}

export function acquire(loadout: Loadout, kind: ModifierKind, modifierId: string): Loadout {
  if (kind === 'gear') {
    if (loadout.roundGearIds.includes(modifierId)) return loadout
    return { ...loadout, roundGearIds: [...loadout.roundGearIds, modifierId] }
  }
  if (loadout.roundTraitIds.includes(modifierId)) return loadout
  return { ...loadout, roundTraitIds: [...loadout.roundTraitIds, modifierId] }
}

/** What the end-of-round choice may pick from, per kind: everything held. */
export function keepCandidateIds(loadout: Loadout, kind: ModifierKind): string[] {
  return kind === 'gear'
    ? [...(loadout.keptGearId ? [loadout.keptGearId] : []), ...loadout.roundGearIds]
    : [...(loadout.keptTraitId ? [loadout.keptTraitId] : []), ...loadout.roundTraitIds]
}

/**
 * Closes the round: the two chosen ids become the whole carry-over and the
 * rest is gone. Passing null for either keeps nothing of that kind, which
 * is a legal choice (and the only one available when nothing was acquired).
 * An id that was not actually held is refused rather than conjured.
 */
export function keepOneOfEach(
  loadout: Loadout,
  keep: { gearId?: string | null; traitId?: string | null },
): Loadout {
  const gearId = keep.gearId ?? null
  const traitId = keep.traitId ?? null
  return {
    keptGearId: gearId && keepCandidateIds(loadout, 'gear').includes(gearId) ? gearId : null,
    keptTraitId: traitId && keepCandidateIds(loadout, 'trait').includes(traitId) ? traitId : null,
    roundGearIds: [],
    roundTraitIds: [],
  }
}
