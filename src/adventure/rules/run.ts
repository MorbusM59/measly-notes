// The run: rounds of steps, with a shape for what happens between them.
//
// Everything here is a pure transition -- `(run, input) => run` -- over a
// state that is entirely serializable, for the same reason the scene engine
// is (../engine.ts): a run has to survive being saved after every single
// player action, and be replayable from its seed for a defect to be
// reportable at all.
//
// WHAT THIS MODULE DOES NOT DECIDE, on purpose, because it is not specified
// yet: what an encounter actually IS. A step's content -- the choices
// offered, their prose, whether picking one starts a fight or a stat check
// -- is supplied from outside and lands back here as a StepOutcome, the
// single seam through which anything can change a run. That keeps the
// machine below honest about what it knows: the shape of a round, the
// economy, the loadout rule, and when a run ends.
//
// The phases are explicit states rather than booleans because the ring can
// only ever show one question at a time, and "which question" is exactly
// what a phase is:
//
//   outfitting -> step -> ... -> roundEnd -> outfitting -> ...
//                  |                             |
//                  +--------- over <-------------+
//
// Nothing here reaches for a clock or Math.random; the seed in the state is
// the only source of chance.

import { nextRandom } from '../rng'
import type { DifficultyKey } from './difficulty'
import { acquire, EMPTY_LOADOUT, heldModifiers, keepOneOfEach, type Loadout } from './loadout'
import { resolveProfile, type EffectiveProfile, type ModifierCatalog, type ModifierKind } from './modifiers'
import { rollOffers } from './offers'
import { layoutForRound, stepAt, type RoundLayout, type StepKind } from './round'
import { BASE_STAT_CAP, createStatBlock, type StatBlock, type StatKey } from './stats'

/** Bumped when this state's SHAPE changes incompatibly. See ../session.ts. */
export const RUN_STATE_VERSION = 1

/**
 * One pending selection at the start of a round: a unit of experience buys
 * a trait, a unit of gold buys a piece of gear. Offers are rolled when the
 * selection becomes current rather than all at once, so a Luck bonus from
 * the item just picked widens the next offer -- which is the behaviour the
 * stat promises, and would be quietly wrong if the whole slate were rolled
 * up front.
 */
export interface PendingSelection {
  kind: ModifierKind
  /** Ids on offer, rolled from the catalog. Empty until this one is current. */
  offerIds: readonly string[]
}

export type RunPhase =
  /** Spending the round's experience and gold before it starts. */
  | { kind: 'outfitting'; queue: readonly PendingSelection[] }
  /** Playing a step; `stepIndex` in the run says which. */
  | { kind: 'step' }
  /** The boss is down: keep one piece of gear and one trait. */
  | { kind: 'roundEnd' }
  /** Nothing further happens. */
  | { kind: 'over'; reason: 'defeat' | 'retired' }

export interface RunState {
  version: number
  difficulty: DifficultyKey
  seed: number
  rngState: number
  /** 1-based. Also the exponent in the enemy scale (difficulty.ts). */
  round: number
  /** 0-based position in the current round's layout. */
  stepIndex: number
  layoutId: string
  baseStats: StatBlock
  /** Earned but not yet assigned to a stat. */
  statPoints: number
  loadout: Loadout
  hitPoints: number
  spellCastsRemaining: number
  /** Quantized: one unit buys one selection at the start of a round. */
  experienceUnits: number
  goldUnits: number
  /** The score. Only ever goes up. */
  fame: number
  phase: RunPhase
  startedAtMs: number
  updatedAtMs: number
}

/**
 * Everything a step can hand back. The single seam between content and the
 * run: a fight, a chest, a skill check and a conversation all end as one of
 * these, so adding a kind of encounter never means adding a case here.
 */
export interface StepOutcome {
  fame?: number
  experienceUnits?: number
  goldUnits?: number
  damageTaken?: number
  healed?: number
  spellCastsSpent?: number
  gearGainedIds?: readonly string[]
  traitsGainedIds?: readonly string[]
  statPoints?: number
  /** Advance to the next step. False for an outcome that leaves you where you are. */
  advance?: boolean
}

export interface StartRunOptions {
  difficulty: DifficultyKey
  seed: number
  nowMs: number
  /** Defaults to all zeroes -- see the design doc's open question on this. */
  baseStats?: StatBlock
}

export function startRun(options: StartRunOptions): RunState {
  const baseStats = options.baseStats ?? createStatBlock(0)
  const layout = layoutForRound(1)
  const profile = resolveProfile(baseStats, [])

  return {
    version: RUN_STATE_VERSION,
    difficulty: options.difficulty,
    seed: options.seed,
    rngState: options.seed,
    round: 1,
    stepIndex: 0,
    layoutId: layout.id,
    baseStats,
    statPoints: 0,
    loadout: EMPTY_LOADOUT,
    hitPoints: profile.derived.maxHitPoints,
    spellCastsRemaining: profile.derived.spellCasts,
    experienceUnits: 0,
    goldUnits: 0,
    fame: 0,
    // Round one has nothing to spend, so outfitting is an empty queue that
    // beginRound resolves straight through to the first step. Starting in
    // this phase regardless keeps every round's entry identical.
    phase: { kind: 'outfitting', queue: [] },
    startedAtMs: options.nowMs,
    updatedAtMs: options.nowMs,
  }
}

export function currentLayout(run: RunState): RoundLayout {
  return layoutForRound(run.round)
}

export function currentStep(run: RunState): StepKind | null {
  return run.phase.kind === 'step' ? stepAt(currentLayout(run), run.stepIndex) : null
}

/** The player as the rules see them: base stats plus everything held. */
export function profileOf(run: RunState, catalog: ModifierCatalog): EffectiveProfile {
  return resolveProfile(run.baseStats, heldModifiers(run.loadout, catalog))
}

/**
 * Opens a round: full hit points, spells back, and one pending selection
 * per unit of experience and gold. The units are consumed HERE, as the
 * queue is built, so a run saved midway through outfitting cannot spend
 * them twice on reload.
 */
export function beginRound(run: RunState, catalog: ModifierCatalog): RunState {
  const profile = profileOf(run, catalog)
  const queue: PendingSelection[] = [
    ...Array.from({ length: run.experienceUnits }, () => ({ kind: 'trait' as const, offerIds: [] })),
    ...Array.from({ length: run.goldUnits }, () => ({ kind: 'gear' as const, offerIds: [] })),
  ]

  const opened: RunState = {
    ...run,
    hitPoints: profile.derived.maxHitPoints,
    spellCastsRemaining: profile.derived.spellCasts,
    experienceUnits: 0,
    goldUnits: 0,
    stepIndex: 0,
    layoutId: currentLayout(run).id,
    phase: { kind: 'outfitting', queue },
  }

  return refreshOffers(opened, catalog)
}

/**
 * Makes sure the current selection has offers rolled, and drops out of
 * outfitting the moment the queue is empty. Idempotent, so it is safe to
 * call on any outfitting state -- including one just loaded from disk,
 * which is how a run resumed mid-outfitting gets its cells back.
 */
export function refreshOffers(run: RunState, catalog: ModifierCatalog): RunState {
  if (run.phase.kind !== 'outfitting') return run
  const [current, ...rest] = run.phase.queue
  if (!current) return { ...run, phase: { kind: 'step' } }
  if (current.offerIds.length > 0) return run

  const profile = profileOf(run, catalog)
  const pool = current.kind === 'gear' ? catalog.gear : catalog.traits
  const rolled = rollOffers(pool, profile.derived.offerChoices, run.rngState)

  return {
    ...run,
    rngState: rolled.rngState,
    phase: {
      kind: 'outfitting',
      queue: [{ kind: current.kind, offerIds: rolled.offers.map((offer) => offer.id) }, ...rest],
    },
  }
}

/**
 * Takes one of the offers in front of the player. An id that is not
 * actually on offer is refused (the run is returned unchanged) rather than
 * trusted -- the same discipline applyChoice uses in the scene engine, for
 * the same reason: a rejected input must never be able to corrupt a run.
 */
export function takeOffer(run: RunState, modifierId: string, catalog: ModifierCatalog): RunState {
  if (run.phase.kind !== 'outfitting') return run
  const [current, ...rest] = run.phase.queue
  if (!current || !current.offerIds.includes(modifierId)) return run

  const taken: RunState = {
    ...run,
    loadout: acquire(run.loadout, current.kind, modifierId),
    phase: { kind: 'outfitting', queue: rest },
  }
  return refreshOffers(taken, catalog)
}

/** Spends an earned stat point. Refused past the base cap -- gear goes past 6, levelling does not. */
export function spendStatPoint(run: RunState, stat: StatKey): RunState {
  if (run.statPoints <= 0) return run
  if (run.baseStats[stat] >= BASE_STAT_CAP) return run
  return {
    ...run,
    statPoints: run.statPoints - 1,
    baseStats: { ...run.baseStats, [stat]: run.baseStats[stat] + 1 },
  }
}

/**
 * Folds a step's result into the run and moves on. The only way anything
 * outside these rules changes a run, and therefore the only place that has
 * to know what ends one: hit points reaching zero ends it immediately, and
 * the last step of a layout opens the end-of-round choice instead of a
 * further step.
 */
export function applyStepOutcome(run: RunState, outcome: StepOutcome, nowMs: number): RunState {
  if (run.phase.kind !== 'step') return run

  const profile = { ...run }
  let loadout: Loadout = run.loadout
  for (const gearId of outcome.gearGainedIds ?? []) loadout = acquire(loadout, 'gear', gearId)
  for (const traitId of outcome.traitsGainedIds ?? []) loadout = acquire(loadout, 'trait', traitId)

  const hitPoints = run.hitPoints - (outcome.damageTaken ?? 0) + (outcome.healed ?? 0)

  const next: RunState = {
    ...profile,
    loadout,
    hitPoints: Math.max(0, hitPoints),
    spellCastsRemaining: Math.max(0, run.spellCastsRemaining - (outcome.spellCastsSpent ?? 0)),
    fame: run.fame + (outcome.fame ?? 0),
    experienceUnits: run.experienceUnits + (outcome.experienceUnits ?? 0),
    goldUnits: run.goldUnits + (outcome.goldUnits ?? 0),
    statPoints: run.statPoints + (outcome.statPoints ?? 0),
    updatedAtMs: nowMs,
  }

  if (next.hitPoints <= 0) return { ...next, phase: { kind: 'over', reason: 'defeat' } }
  if (outcome.advance === false) return next

  const layout = currentLayout(run)
  const stepIndex = run.stepIndex + 1
  if (stepIndex >= layout.steps.length) return { ...next, stepIndex: layout.steps.length, phase: { kind: 'roundEnd' } }
  return { ...next, stepIndex }
}

/**
 * Closes the round on the player's keep-one-of-each choice and opens the
 * next one. The stat point a round is expected to yield is NOT granted
 * here: it comes from the layout's `boon` step, so a round that was left
 * early never quietly pays out.
 */
export function endRound(
  run: RunState,
  keep: { gearId?: string | null; traitId?: string | null },
  catalog: ModifierCatalog,
  nowMs: number,
): RunState {
  if (run.phase.kind !== 'roundEnd') return run
  const advanced: RunState = {
    ...run,
    loadout: keepOneOfEach(run.loadout, keep),
    round: run.round + 1,
    stepIndex: 0,
    updatedAtMs: nowMs,
  }
  return beginRound(advanced, catalog)
}

/** Ends a run at the player's word rather than by defeat. Fame is kept as the score. */
export function retireRun(run: RunState, nowMs: number): RunState {
  if (run.phase.kind === 'over') return run
  return { ...run, phase: { kind: 'over', reason: 'retired' }, updatedAtMs: nowMs }
}

/** A draw from the run's own randomness, for callers building step content. */
export function drawFromRun(run: RunState): { value: number; run: RunState } {
  const draw = nextRandom(run.rngState)
  return { value: draw.value, run: { ...run, rngState: draw.state } }
}
