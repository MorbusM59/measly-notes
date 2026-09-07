// The adventure game's data model: what a story IS (AdventureDefinition and
// everything under it) and what a run through one IS (AdventureSession).
// Pure data -- no React, no DOM, no persistence, no engine logic. The
// engine (engine.ts) reads a definition and a session and produces the
// next session; the UI glue (useAdventureEscapeMenu.ts) never touches
// anything else.
//
// The split matters: a definition is code shipped with the app and changes
// with releases, a session is user data written to app-state.json and has
// to survive them. Every field a session carries is therefore either a
// primitive or a plain array/record of primitives -- never a reference into
// a definition. A saved run points at its story by id and at its position
// by scene id, so a story that no longer exists (or whose shape changed
// underneath) is *detectably* stale rather than silently mis-resumed. See
// session.ts for where that detection lives.

/**
 * Named counters the story reasons about. Deliberately an open record
 * rather than a fixed set of fields: which stats exist is content's
 * business, not the engine's, and a second story is free to track entirely
 * different ones. The engine only ever compares and adds.
 */
export type AdventureStats = Record<string, number>

// --- Conditions ------------------------------------------------------------

export type AdventureComparison = 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq'

/**
 * A predicate over a run's current state. Closed union, evaluated by
 * conditions.ts. `all`/`any`/`not` make it a full boolean algebra, so
 * content never needs an escape hatch into arbitrary functions -- which is
 * what keeps a definition serializable, inspectable, and testable, and
 * leaves the door open to loading stories from data files later without
 * changing anything here.
 */
export type AdventureCondition =
  | { kind: 'stat'; stat: string; op: AdventureComparison; value: number }
  | { kind: 'flag'; flag: string; present?: boolean }
  | { kind: 'visited'; sceneId: string; present?: boolean }
  | { kind: 'turnsElapsed'; op: AdventureComparison; value: number }
  | { kind: 'all'; of: AdventureCondition[] }
  | { kind: 'any'; of: AdventureCondition[] }
  | { kind: 'not'; of: AdventureCondition }

// --- Effects ---------------------------------------------------------------

/**
 * A state change. Same closed-union reasoning as conditions. `adjustStat`
 * is separate from `setStat` because clamping (see AdventureStatDefinition)
 * makes them genuinely different operations, not one expressible as the
 * other.
 */
export type AdventureEffect =
  | { kind: 'adjustStat'; stat: string; delta: number }
  | { kind: 'setStat'; stat: string; value: number }
  | { kind: 'setFlag'; flag: string; present: boolean }

// --- Outcomes --------------------------------------------------------------

/**
 * Where a choice leads. Every variant ends at a scene id; the variants
 * differ only in how that id is picked and what happens on the way.
 *
 * `chance` and `check` both consume randomness, which is why a session
 * carries its own RNG state (rng.ts) rather than calling Math.random: a run
 * that is saved, closed, reopened and continued must behave as though it
 * had never stopped, and a run replayed from its seed and choice history
 * must reproduce exactly. That is what makes a bug in a live session
 * reportable at all.
 */
export type AdventureOutcome =
  | { kind: 'goto'; sceneId: string }
  | { kind: 'chance'; branches: AdventureChanceBranch[] }
  | {
      kind: 'check'
      /** Stat added to the roll. Missing stats read as 0. */
      stat: string
      /** Roll is 1..`dieSides` (default 6) plus the stat; >= this passes. */
      difficulty: number
      dieSides?: number
      success: AdventureOutcomeLeg
      failure: AdventureOutcomeLeg
    }

export interface AdventureChanceBranch {
  /** Relative weight; must be > 0. Weights need not sum to anything. */
  weight: number
  sceneId: string
  effects?: AdventureEffect[]
}

export interface AdventureOutcomeLeg {
  sceneId: string
  effects?: AdventureEffect[]
}

// --- Content ---------------------------------------------------------------

export interface AdventureChoice {
  /** Unique within its scene. Part of the session's replayable history. */
  id: string
  label: string
  /** Font Awesome class string; becomes the ring cell's icon. */
  icon: string
  /**
   * Shown only when every condition holds. An ineligible choice DROPS OUT
   * of the ring entirely rather than appearing disabled -- the same rule
   * the quick-actions ring already follows, and the reason the ring can
   * carry a varying number of cells without any layout special-casing.
   */
  requires?: AdventureCondition[]
  /** Applied before the outcome resolves, so a check can read them. */
  effects?: AdventureEffect[]
  outcome: AdventureOutcome
}

export interface AdventureScene {
  id: string
  /** The question, as the ring's centre reads it. Keep it short. */
  prompt: string
  /** Applied once, on first arrival *and* on every re-entry. */
  onEnter?: AdventureEffect[]
  /**
   * Present on terminal scenes only. A scene with an ending has no
   * choices; the run's status becomes 'ended' the moment it is entered.
   */
  ending?: AdventureEnding
  choices?: AdventureChoice[]
}

export interface AdventureEnding {
  id: string
  /** Coarse shape of the ending, for summaries and (later) a ledger of runs. */
  tone: 'triumph' | 'defeat' | 'quiet'
}

export interface AdventureStatDefinition {
  key: string
  /** Shown wherever the run is summarized. */
  label: string
  /**
   * A 2-4 character form for the ring's centre, where the whole status line
   * has to fit inside a circle roughly 100px across. Falls back to `label`
   * where absent, which is correct for a story whose stat names are short
   * enough already.
   */
  short?: string
  initial: number
  /** Clamps every adjustment and assignment. Omit for unbounded. */
  min?: number
  max?: number
  /**
   * Whether reaching `min` ends the run. The engine checks this after every
   * committed choice, before the next scene's choices are listed, so a
   * story cannot forget to guard a resource it declared fatal.
   */
  fatalAtMin?: { endingId: string; sceneId: string }
}

export interface AdventureDefinition {
  id: string
  title: string
  /**
   * Bumped by content whenever a change would make an in-flight saved run
   * incoherent (a scene removed, a choice's meaning changed). A saved
   * session records the version it started under; session.ts refuses to
   * resume across a mismatch rather than dropping the player into a story
   * that has moved. Purely additive content does not need a bump.
   */
  contentVersion: number
  startSceneId: string
  stats: AdventureStatDefinition[]
  scenes: AdventureScene[]
}

// --- Session ---------------------------------------------------------------

/**
 * Bumped when the SESSION shape below changes incompatibly. Distinct from
 * a definition's contentVersion: this one is about the save format, that
 * one is about the story. Both are checked on load.
 */
export const ADVENTURE_SESSION_VERSION = 1

export interface AdventureHistoryEntry {
  sceneId: string
  choiceId: string
  /** Scene the choice actually led to, after any chance/check resolved. */
  resultSceneId: string
}

export interface AdventureSession {
  version: number
  /** Which AdventureDefinition this run belongs to. */
  adventureId: string
  /** That definition's contentVersion at the moment the run started. */
  contentVersion: number
  /** The run's own RNG state -- see rng.ts. Advances with every draw. */
  rngState: number
  /** The seed it started from; kept so a finished run stays reproducible. */
  seed: number
  sceneId: string
  stats: AdventureStats
  flags: string[]
  /** Every scene ever entered, in arrival order, duplicates included. */
  visited: string[]
  history: AdventureHistoryEntry[]
  /** Committed choices so far. Not history.length -- kept explicit so a
   *  future "the night grows colder every N turns" rule has a number to
   *  read that does not depend on how history is pruned. */
  turn: number
  status: 'active' | 'ended'
  /** Set exactly when status is 'ended'. */
  endingId?: string
  startedAtMs: number
  updatedAtMs: number
}
