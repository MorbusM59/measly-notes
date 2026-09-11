// The master: it decides which stage is current, composes the ring, and is
// the only thing in the game that writes.
//
// Everything the player sees is one Screen, and every screen is built the
// same way: the stage on top of the stack supplies the question and its
// options, and the director adds the options that are always there. A
// stage therefore never has to remember to offer "leave the game", and
// never gets to decide not to.
//
// A STACK, not a current stage, because the design has interludes: looking
// at your traits is reachable from every screen and must give you back the
// screen you were on, and a fight has decisions inside it that are not the
// fight itself. One current stage could only express that by making every
// stage save and restore its own suspended state, which is the same
// mechanism written once per stage instead of once here.
//
// The director holds NO rules. It does not know that zero hit points ends a
// game or that a boss ends a level; a stage that deals the damage says so
// by handing off. Everything the director knows is in this file, and it is
// all about sequencing.

import { applyEffects, activeGame, heldModifiers, profileOf, type GameSave, type StageFrame } from '../model/gameState'
import type { Modifier } from '../model/modifiers'
import type { Effect } from '../model/effects'
import type { Content } from '../content'
import type { JsonObject } from './json'
import type { RngState } from './rng'
import type { Choice, Screen } from './screen'
import type { StageContext, StageModule, StageRegistry, Transition } from './stage'

export interface DirectorDeps {
  stages: StageRegistry
  content: Content
  catalog: ReadonlyMap<string, Modifier>
  /** Where an empty stack starts. The welcome screen, today. */
  rootStageId: string
  /** Stages the always-present core cells push. */
  coreStageIds: { items: string; traits: string }
}

/**
 * The cells the director contributes to every screen. Ids are namespaced so
 * that a stage can never accidentally collide with one -- a stage choice
 * called "leave" must not close the game view.
 */
export const CORE_CHOICE_IDS = {
  items: 'core:items',
  traits: 'core:traits',
  leave: 'core:leave',
} as const

export function buildContext(save: GameSave, deps: DirectorDeps): StageContext {
  const game = activeGame(save)
  const held = game ? heldModifiers(save, game.id, deps.catalog) : []
  return {
    save,
    game,
    content: deps.content,
    catalog: deps.catalog,
    profile: game ? profileOf(save, game, deps.catalog) : null,
    held,
  }
}

function stageOf(deps: DirectorDeps, stageId: string): StageModule | null {
  return deps.stages.get(stageId) ?? null
}

function topFrame(save: GameSave): StageFrame | null {
  return save.director.stack[save.director.stack.length - 1] ?? null
}

interface Applied {
  save: GameSave
  rng: RngState
}

function commit(
  save: GameSave,
  effects: readonly Effect[] | undefined,
  rng: RngState,
  deps: DirectorDeps,
  nowMs: number,
): Applied {
  const next = effects && effects.length > 0 ? applyEffects(save, effects, deps.catalog, nowMs) : save
  return { save: next, rng }
}

function withDirector(
  save: GameSave,
  next: Partial<GameSave['director']>,
): GameSave {
  return { ...save, director: { ...save.director, ...next } }
}

/**
 * Enters a stage and puts it on the stack at `depth`, discarding anything
 * at or above it. `enter` may roll and may emit effects -- it runs once per
 * entry, which is the point: a fight generates its enemy here, not while
 * being looked at.
 */
function enterStage(
  save: GameSave,
  stageId: string,
  input: JsonObject,
  depth: number,
  deps: DirectorDeps,
  nowMs: number,
): GameSave {
  const stage = stageOf(deps, stageId)
  if (!stage) return save

  const entry = stage.enter(input, buildContext(save, deps), save.director.rng)
  const committed = commit(save, entry.effects, entry.rng, deps, nowMs)
  const stack = [...committed.save.director.stack.slice(0, depth), { stageId, state: entry.state }]

  return withDirector(committed.save, {
    stack,
    rng: entry.rng,
    narration: entry.narration ?? committed.save.director.narration,
  })
}

/**
 * Puts the player somewhere to be, if they are nowhere. Idempotent, and
 * called when the view opens rather than while it renders -- entering a
 * stage can roll, and a roll during render is the one thing determinism
 * cannot survive (see core/rng.ts).
 */
export function ensureEntered(save: GameSave, deps: DirectorDeps, nowMs: number): GameSave {
  if (save.director.stack.length > 0) return save
  return enterStage(save, deps.rootStageId, {}, 0, deps, nowMs)
}

/** The core cells, in their fixed places: informational first, the way out last. */
function coreChoices(context: StageContext): Choice[] {
  const choices: Choice[] = []
  if (context.game) {
    choices.push(
      { id: CORE_CHOICE_IDS.items, label: 'Acquired Items', icon: 'fa-solid fa-sack-xmark' },
      { id: CORE_CHOICE_IDS.traits, label: 'Acquired Traits', icon: 'fa-solid fa-scroll' },
    )
  }
  choices.push({ id: CORE_CHOICE_IDS.leave, label: 'Leave the game', icon: 'fa-solid fa-xmark' })
  return choices
}

/**
 * What to show right now. Pure: no rolls, no writes, no effects. Safe to
 * call on every render, which is exactly why it has to be.
 */
export function currentScreen(save: GameSave, deps: DirectorDeps): Screen | null {
  const frame = topFrame(save)
  if (!frame) return null
  const stage = stageOf(deps, frame.stageId)
  if (!stage) return null

  const context = buildContext(save, deps)
  const presentation = stage.present(frame.state, context)

  return {
    stageId: frame.stageId,
    // Depth is part of the key so that pushing an interlude and popping
    // back counts as a new question for the dial, even when the stage
    // underneath is presenting exactly what it was before.
    screenKey: `${save.director.stack.length}:${frame.stageId}:${presentation.screenKey ?? frame.stageId}`,
    narration: save.director.narration,
    choices: [...presentation.choices, ...coreChoices(context)],
  }
}

export interface ChoiceResult {
  save: GameSave
  /**
   * The one act the game cannot perform for itself: giving the editor slot
   * back. Null unless the player asked to leave.
   */
  hostAction: 'leave' | null
}

function applyTransition(
  save: GameSave,
  transition: Transition,
  depth: number,
  deps: DirectorDeps,
  nowMs: number,
): ChoiceResult {
  const committed = commit(save, transition.effects, transition.rng, deps, nowMs)
  const narrated = withDirector(committed.save, {
    rng: transition.rng,
    narration: 'narration' in transition && transition.narration !== undefined
      ? transition.narration
      : committed.save.director.narration,
  })

  switch (transition.kind) {
    case 'stay': {
      const stack = [...narrated.director.stack]
      stack[depth] = { stageId: stack[depth].stageId, state: transition.state }
      return { save: withDirector(narrated, { stack }), hostAction: null }
    }

    case 'push':
      return {
        save: enterStage(narrated, transition.stageId, transition.input ?? {}, depth + 1, deps, nowMs),
        hostAction: null,
      }

    case 'replace':
      return {
        save: enterStage(narrated, transition.stageId, transition.input ?? {}, depth, deps, nowMs),
        hostAction: null,
      }

    case 'pop': {
      const stack = narrated.director.stack.slice(0, depth)
      // Popping the last frame leaves the player nowhere, so the root stage
      // catches them. That is how a finished game gets back to the welcome
      // screen without every ending stage having to name it.
      if (stack.length === 0) {
        return { save: enterStage(withDirector(narrated, { stack }), deps.rootStageId, {}, 0, deps, nowMs), hostAction: null }
      }
      return { save: withDirector(narrated, { stack }), hostAction: null }
    }

    case 'leave':
      return { save: narrated, hostAction: 'leave' }
  }
}

/**
 * Answers the current screen. The single entry point for player input, and
 * therefore the single place a game changes.
 *
 * An unknown choice id returns the save UNCHANGED rather than throwing: the
 * ring can only offer what was presented, so an id that is not on offer is
 * either a stale click during a rebuild or a bug, and neither is worth
 * corrupting a game over.
 */
export function choose(save: GameSave, choiceId: string, deps: DirectorDeps, nowMs: number): ChoiceResult {
  const frame = topFrame(save)
  if (!frame) return { save, hostAction: null }

  const context = buildContext(save, deps)
  const depth = save.director.stack.length - 1

  if (choiceId === CORE_CHOICE_IDS.leave) return { save, hostAction: 'leave' }
  if (choiceId === CORE_CHOICE_IDS.items || choiceId === CORE_CHOICE_IDS.traits) {
    if (!context.game) return { save, hostAction: null }
    const stageId = choiceId === CORE_CHOICE_IDS.items ? deps.coreStageIds.items : deps.coreStageIds.traits
    return { save: enterStage(save, stageId, {}, depth + 1, deps, nowMs), hostAction: null }
  }

  const stage = stageOf(deps, frame.stageId)
  if (!stage) return { save, hostAction: null }

  const offered = stage.present(frame.state, context).choices
  if (!offered.some((choice) => choice.id === choiceId)) return { save, hostAction: null }

  const transition = stage.resolve(frame.state, choiceId, context, save.director.rng)
  return applyTransition(save, transition, depth, deps, nowMs)
}
