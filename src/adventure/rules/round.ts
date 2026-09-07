// The shape of a round: a fixed-length sequence of steps ending in a boss.
//
// A layout is DATA, not a loop with special cases at index 3 and 6. That is
// the whole point: "a regular round might have these steps" is one template
// among many, and a round that is longer, has three minibosses, or hands
// out its stat point earlier is a new entry here rather than a new branch
// in the run machine.

export type StepKind =
  /** An ordinary step: the player picks from `encounterChoices` options. */
  | 'encounter'
  /** A fight that pays fame. */
  | 'miniboss'
  /** The round's last step, and the reason it ends. */
  | 'boss'
  /** A step whose reward is a permanent stat point. */
  | 'boon'

export interface RoundLayout {
  id: string
  steps: readonly StepKind[]
}

/** The specification's own example round, and the default for every round. */
export const STANDARD_ROUND_LAYOUT: RoundLayout = {
  id: 'standard',
  steps: [
    'encounter',
    'encounter',
    'encounter',
    'miniboss',
    'encounter',
    'encounter',
    'miniboss',
    'encounter',
    'boon',
    'boss',
  ],
}

/**
 * Which layout a given round uses. One template today; the signature takes
 * the round number so that "round 5 is a gauntlet" is a change here and
 * nowhere else.
 */
export function layoutForRound(_round: number): RoundLayout {
  return STANDARD_ROUND_LAYOUT
}

export function stepAt(layout: RoundLayout, stepIndex: number): StepKind | null {
  return layout.steps[stepIndex] ?? null
}

export function isFinalStep(layout: RoundLayout, stepIndex: number): boolean {
  return stepIndex >= layout.steps.length - 1
}
