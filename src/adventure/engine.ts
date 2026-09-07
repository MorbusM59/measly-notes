// The adventure engine: given a story (AdventureDefinition) and a run
// (AdventureSession), what can the player do, and what does doing it
// produce. Entirely pure -- every function here takes a session and returns
// a new one, touching no clock it was not handed, no randomness it does not
// carry in the session, and no React. The UI can therefore be swapped,
// replayed, or tested headlessly without the engine noticing, and a run can
// be reconstructed from its seed plus its choice ids.
//
// The engine deliberately does NOT know that its choices are rendered as a
// ring of icons, except in one respect: MAX_CHOICES_PER_STEP, below. That
// is a real constraint of the surface the game is played on, and pretending
// otherwise would just move the truncation somewhere it cannot be
// validated.

import { nextIntInclusive, nextRandom, createSeed, toRngState } from './rng'
import { applyEffects, evaluateConditions, type RuleState } from './rules'
import {
  ADVENTURE_SESSION_VERSION,
  type AdventureChoice,
  type AdventureDefinition,
  type AdventureEffect,
  type AdventureOutcome,
  type AdventureScene,
  type AdventureSession,
  type AdventureStatDefinition,
  type AdventureStats,
} from './types'

/**
 * How many story choices one step may offer. The escape-hold ring stays
 * legible at a handful of cells and the mode adds one of its own (leaving
 * the game), so a story that wants more has to make it two decisions -- a
 * better story anyway. validateAdventure reports a scene that can exceed
 * this, so it is caught in tests rather than silently truncated in front of
 * a player. listChoices still truncates as a last resort, because a
 * mis-sized ring is a worse failure than a missing option.
 */
export const MAX_CHOICES_PER_STEP = 4

/** Default die for a `check` outcome when content does not say otherwise. */
const DEFAULT_DIE_SIDES = 6

function indexScenes(definition: AdventureDefinition): Map<string, AdventureScene> {
  return new Map(definition.scenes.map((scene) => [scene.id, scene]))
}

function indexStats(definition: AdventureDefinition): Map<string, AdventureStatDefinition> {
  return new Map(definition.stats.map((stat) => [stat.key, stat]))
}

function initialStats(definition: AdventureDefinition): AdventureStats {
  const stats: AdventureStats = {}
  for (const stat of definition.stats) stats[stat.key] = stat.initial
  return stats
}

function toRuleState(session: AdventureSession): RuleState {
  return { stats: session.stats, flags: session.flags, visited: session.visited, turn: session.turn }
}

export function getScene(definition: AdventureDefinition, sceneId: string): AdventureScene | null {
  return definition.scenes.find((scene) => scene.id === sceneId) ?? null
}

export function getCurrentScene(definition: AdventureDefinition, session: AdventureSession): AdventureScene | null {
  return getScene(definition, session.sceneId)
}

/**
 * The choices a player may take right now: the current scene's, filtered by
 * their requirements, capped at MAX_CHOICES_PER_STEP. Empty for an ended
 * run and for any terminal scene -- callers distinguish "the story is over"
 * from "nothing is available" via session.status, not by counting choices.
 */
export function listChoices(definition: AdventureDefinition, session: AdventureSession): AdventureChoice[] {
  if (session.status !== 'active') return []
  const scene = getCurrentScene(definition, session)
  if (!scene || scene.ending) return []
  const state = toRuleState(session)
  return (scene.choices ?? [])
    .filter((choice) => evaluateConditions(choice.requires, state))
    .slice(0, MAX_CHOICES_PER_STEP)
}

export interface CreateSessionOptions {
  /** Omit for a real run; pass a fixed value in tests and replays. */
  seed?: number
  /** Injected rather than read from Date.now, for the same reason. */
  nowMs?: number
}

export function createSession(
  definition: AdventureDefinition,
  options: CreateSessionOptions = {},
): AdventureSession {
  const seed = toRngState(options.seed ?? createSeed())
  const nowMs = options.nowMs ?? Date.now()

  const base: AdventureSession = {
    version: ADVENTURE_SESSION_VERSION,
    adventureId: definition.id,
    contentVersion: definition.contentVersion,
    seed,
    rngState: seed,
    sceneId: definition.startSceneId,
    stats: initialStats(definition),
    flags: [],
    visited: [],
    history: [],
    turn: 0,
    status: 'active',
    startedAtMs: nowMs,
    updatedAtMs: nowMs,
  }

  // The opening scene is *entered*, not merely assigned -- its onEnter
  // effects and its ending (a one-scene story is legal) have to run exactly
  // as they would for any later arrival.
  return enterScene(definition, base, definition.startSceneId, nowMs)
}

/**
 * Moves a session into `sceneId`, applying that scene's onEnter effects,
 * recording the visit, and settling any terminal condition -- an ending
 * scene, or a stat that has bottomed out on a stat declared fatal at its
 * minimum.
 *
 * A fatal stat redirects to its own scene, which is itself entered
 * normally; `guard` breaks the (content-authoring) cycle of a fatal
 * redirect that lands somewhere fatal again, so a bad definition produces a
 * stuck-but-coherent run rather than a stack overflow. validateAdventure
 * catches the real cases before they ship.
 */
function enterScene(
  definition: AdventureDefinition,
  session: AdventureSession,
  sceneId: string,
  nowMs: number,
  guard: Set<string> = new Set(),
): AdventureSession {
  const scene = getScene(definition, sceneId)
  const statDefinitions = indexStats(definition)

  // An unknown scene id can only come from a saved session pointing at
  // content that has since changed. Ending the run is the honest outcome:
  // it is over either way, and leaving it 'active' would offer a player a
  // step that can never be taken.
  if (!scene) {
    return { ...session, sceneId, status: 'ended', endingId: 'lost-the-thread', updatedAtMs: nowMs }
  }

  const entered = applyEffects(scene.onEnter, toRuleState(session), statDefinitions)
  const withScene: AdventureSession = {
    ...session,
    sceneId,
    stats: entered.stats,
    flags: entered.flags,
    visited: [...session.visited, sceneId],
    updatedAtMs: nowMs,
  }

  if (scene.ending) {
    return { ...withScene, status: 'ended', endingId: scene.ending.id }
  }

  if (!guard.has(sceneId)) {
    guard.add(sceneId)
    for (const stat of definition.stats) {
      if (!stat.fatalAtMin || stat.min === undefined) continue
      if ((withScene.stats[stat.key] ?? 0) > stat.min) continue
      return enterScene(definition, withScene, stat.fatalAtMin.sceneId, nowMs, guard)
    }
  }

  return withScene
}

interface ResolvedOutcome {
  sceneId: string
  effects: AdventureEffect[]
  rngState: number
}

/**
 * Turns an outcome into a destination plus whatever effects that particular
 * resolution carries, consuming session RNG only where the outcome actually
 * involves chance. A `goto` therefore never advances the RNG, which keeps a
 * deterministic replay stable against content that later adds or removes
 * purely deterministic steps around a random one.
 */
function resolveOutcome(outcome: AdventureOutcome, session: AdventureSession): ResolvedOutcome {
  switch (outcome.kind) {
    case 'goto':
      return { sceneId: outcome.sceneId, effects: [], rngState: session.rngState }

    case 'chance': {
      const branches = outcome.branches.filter((branch) => branch.weight > 0)
      if (branches.length === 0) {
        return { sceneId: session.sceneId, effects: [], rngState: session.rngState }
      }
      const total = branches.reduce((sum, branch) => sum + branch.weight, 0)
      const draw = nextRandom(session.rngState)
      let remaining = draw.value * total
      for (const branch of branches) {
        remaining -= branch.weight
        if (remaining < 0) {
          return { sceneId: branch.sceneId, effects: branch.effects ?? [], rngState: draw.state }
        }
      }
      const last = branches[branches.length - 1]
      return { sceneId: last.sceneId, effects: last.effects ?? [], rngState: draw.state }
    }

    case 'check': {
      const roll = nextIntInclusive(session.rngState, 1, outcome.dieSides ?? DEFAULT_DIE_SIDES)
      const total = roll.value + (session.stats[outcome.stat] ?? 0)
      const leg = total >= outcome.difficulty ? outcome.success : outcome.failure
      return { sceneId: leg.sceneId, effects: leg.effects ?? [], rngState: roll.state }
    }
  }
}

export interface ApplyChoiceOptions {
  nowMs?: number
}

/**
 * Commits one choice. Returns the session unchanged if the choice is not
 * currently available -- an unknown id, a requirement that no longer holds,
 * a finished run. Callers do not have to re-validate before calling; a
 * no-op return IS the rejection, and it cannot corrupt a run.
 *
 * Order is load-bearing and mirrors how the text reads: the choice's own
 * effects land first (so a check can be made against a stat the choice just
 * spent), then the outcome resolves, then that resolution's effects, then
 * the destination scene is entered (with its own onEnter effects and any
 * terminal condition).
 */
export function applyChoice(
  definition: AdventureDefinition,
  session: AdventureSession,
  choiceId: string,
  options: ApplyChoiceOptions = {},
): AdventureSession {
  const nowMs = options.nowMs ?? Date.now()
  const choice = listChoices(definition, session).find((candidate) => candidate.id === choiceId)
  if (!choice) return session

  const statDefinitions = indexStats(definition)
  const afterChoiceEffects = applyEffects(choice.effects, toRuleState(session), statDefinitions)
  const spent: AdventureSession = {
    ...session,
    stats: afterChoiceEffects.stats,
    flags: afterChoiceEffects.flags,
  }

  const resolved = resolveOutcome(choice.outcome, spent)
  const afterOutcomeEffects = applyEffects(
    resolved.effects,
    { ...toRuleState(spent), stats: spent.stats, flags: spent.flags },
    statDefinitions,
  )

  const advanced: AdventureSession = {
    ...spent,
    stats: afterOutcomeEffects.stats,
    flags: afterOutcomeEffects.flags,
    rngState: resolved.rngState,
    turn: session.turn + 1,
    history: [
      ...session.history,
      { sceneId: session.sceneId, choiceId: choice.id, resultSceneId: resolved.sceneId },
    ],
  }

  return enterScene(definition, advanced, resolved.sceneId, nowMs)
}

/**
 * Stats worth showing, in the order content declared them. `short` is the
 * form for cramped surfaces (the ring's centre); `label` the full one.
 */
export function summarizeStats(
  definition: AdventureDefinition,
  session: AdventureSession,
): Array<{ key: string; label: string; short: string; value: number }> {
  return definition.stats.map((stat) => ({
    key: stat.key,
    label: stat.label,
    short: stat.short ?? stat.label,
    value: session.stats[stat.key] ?? stat.initial,
  }))
}

// --- Content validation ----------------------------------------------------

/**
 * Structural problems a story can have that only surface as a broken run:
 * a dangling scene id, a dead end that is not marked as an ending, a stat
 * nobody declared, a step that would overflow the ring. Not called at
 * runtime -- it is what the content test asserts on, so an authoring
 * mistake fails a test instead of stranding a player mid-run.
 */
export function validateAdventure(definition: AdventureDefinition): string[] {
  const problems: string[] = []
  const scenes = indexScenes(definition)
  const statKeys = new Set(definition.stats.map((stat) => stat.key))

  const requireScene = (sceneId: string, where: string) => {
    if (!scenes.has(sceneId)) problems.push(`${where} points at unknown scene "${sceneId}"`)
  }
  const requireStat = (stat: string, where: string) => {
    if (!statKeys.has(stat)) problems.push(`${where} uses undeclared stat "${stat}"`)
  }

  const walkEffects = (effects: AdventureEffect[] | undefined, where: string) => {
    for (const effect of effects ?? []) {
      if (effect.kind === 'adjustStat' || effect.kind === 'setStat') requireStat(effect.stat, where)
    }
  }

  requireScene(definition.startSceneId, `${definition.id} start`)
  if (definition.scenes.length !== scenes.size) problems.push(`${definition.id} has duplicate scene ids`)

  for (const stat of definition.stats) {
    if (stat.fatalAtMin) requireScene(stat.fatalAtMin.sceneId, `stat "${stat.key}" fatalAtMin`)
  }

  for (const scene of definition.scenes) {
    const where = `scene "${scene.id}"`
    walkEffects(scene.onEnter, `${where} onEnter`)

    const choices = scene.choices ?? []
    if (scene.ending) {
      if (choices.length > 0) problems.push(`${where} is an ending but declares choices`)
      continue
    }
    if (choices.length === 0) problems.push(`${where} is a dead end with no ending`)
    if (choices.length > MAX_CHOICES_PER_STEP) {
      problems.push(`${where} declares ${choices.length} choices; the ring shows at most ${MAX_CHOICES_PER_STEP}`)
    }
    if (new Set(choices.map((choice) => choice.id)).size !== choices.length) {
      problems.push(`${where} has duplicate choice ids`)
    }
    // An unconditional choice guarantees the scene is never a dead end for
    // a player whose stats happen to fail every requirement -- the failure
    // mode this check exists for, since it depends on run state and so
    // cannot be found by walking the graph alone.
    if (!choices.some((choice) => !choice.requires || choice.requires.length === 0)) {
      problems.push(`${where} has no unconditional choice; a run could reach it with nothing available`)
    }

    for (const choice of choices) {
      const choiceWhere = `${where} choice "${choice.id}"`
      walkEffects(choice.effects, choiceWhere)
      switch (choice.outcome.kind) {
        case 'goto':
          requireScene(choice.outcome.sceneId, choiceWhere)
          break
        case 'chance':
          if (choice.outcome.branches.length === 0) problems.push(`${choiceWhere} has no chance branches`)
          for (const branch of choice.outcome.branches) {
            if (branch.weight <= 0) problems.push(`${choiceWhere} has a branch with weight <= 0`)
            requireScene(branch.sceneId, choiceWhere)
            walkEffects(branch.effects, choiceWhere)
          }
          break
        case 'check':
          requireStat(choice.outcome.stat, choiceWhere)
          requireScene(choice.outcome.success.sceneId, `${choiceWhere} success`)
          requireScene(choice.outcome.failure.sceneId, `${choiceWhere} failure`)
          walkEffects(choice.outcome.success.effects, choiceWhere)
          walkEffects(choice.outcome.failure.effects, choiceWhere)
          break
      }
    }
  }

  return problems
}
