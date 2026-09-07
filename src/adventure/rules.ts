// Evaluation of the two closed unions in types.ts: conditions (do we show
// this?) and effects (what does taking it change?). Split out from the
// engine because they are the part content authors reason about most, and
// because they are pure in the strictest sense -- no RNG, no clock, no
// session identity -- which makes them exhaustively testable on their own.
//
// Both work against a `RuleState` rather than an AdventureSession: the
// engine needs to evaluate effects against a half-built next state (a
// choice's own effects apply before its outcome resolves, and an outcome
// leg's effects apply before the destination scene is entered), and
// threading a whole session through those intermediate steps would mean
// inventing meaningless values for fields the rules cannot read anyway.

import type {
  AdventureComparison,
  AdventureCondition,
  AdventureEffect,
  AdventureStatDefinition,
  AdventureStats,
} from './types'

export interface RuleState {
  stats: AdventureStats
  flags: string[]
  visited: string[]
  turn: number
}

function compare(left: number, op: AdventureComparison, right: number): boolean {
  switch (op) {
    case 'lt': return left < right
    case 'lte': return left <= right
    case 'gt': return left > right
    case 'gte': return left >= right
    case 'eq': return left === right
    case 'neq': return left !== right
  }
}

/**
 * A stat the run has never touched reads as 0 rather than throwing or
 * being treated as "unknown". Content declares its stats up front
 * (AdventureDefinition.stats) and validateAdventure rejects references to
 * undeclared ones, so a 0 here means "declared, untouched", not "typo" --
 * the typo case is caught at test time instead of degrading at runtime.
 */
export function readStat(state: RuleState, stat: string): number {
  return state.stats[stat] ?? 0
}

export function evaluateCondition(condition: AdventureCondition, state: RuleState): boolean {
  switch (condition.kind) {
    case 'stat':
      return compare(readStat(state, condition.stat), condition.op, condition.value)
    case 'flag':
      return state.flags.includes(condition.flag) === (condition.present ?? true)
    case 'visited':
      return state.visited.includes(condition.sceneId) === (condition.present ?? true)
    case 'turnsElapsed':
      return compare(state.turn, condition.op, condition.value)
    case 'all':
      return condition.of.every((inner) => evaluateCondition(inner, state))
    case 'any':
      return condition.of.some((inner) => evaluateCondition(inner, state))
    case 'not':
      return !evaluateCondition(condition.of, state)
  }
}

/** An empty/absent requirement list is satisfied -- an unconditional choice. */
export function evaluateConditions(conditions: AdventureCondition[] | undefined, state: RuleState): boolean {
  if (!conditions || conditions.length === 0) return true
  return conditions.every((condition) => evaluateCondition(condition, state))
}

function clampStat(value: number, definition: AdventureStatDefinition | undefined): number {
  if (!definition) return value
  const lowerBounded = definition.min === undefined ? value : Math.max(definition.min, value)
  return definition.max === undefined ? lowerBounded : Math.min(definition.max, lowerBounded)
}

/**
 * Applies effects in order, returning a NEW state. Order matters and is
 * the author's to control: two effects on the same stat compose, and a
 * clamp applied by the first is visible to the second.
 */
export function applyEffects(
  effects: AdventureEffect[] | undefined,
  state: RuleState,
  statDefinitions: Map<string, AdventureStatDefinition>,
): RuleState {
  if (!effects || effects.length === 0) return state
  let stats = state.stats
  let flags = state.flags

  for (const effect of effects) {
    switch (effect.kind) {
      case 'adjustStat': {
        const next = clampStat((stats[effect.stat] ?? 0) + effect.delta, statDefinitions.get(effect.stat))
        stats = { ...stats, [effect.stat]: next }
        break
      }
      case 'setStat': {
        const next = clampStat(effect.value, statDefinitions.get(effect.stat))
        stats = { ...stats, [effect.stat]: next }
        break
      }
      case 'setFlag': {
        const has = flags.includes(effect.flag)
        if (effect.present && !has) flags = [...flags, effect.flag]
        else if (!effect.present && has) flags = flags.filter((flag) => flag !== effect.flag)
        break
      }
    }
  }

  return { ...state, stats, flags }
}
