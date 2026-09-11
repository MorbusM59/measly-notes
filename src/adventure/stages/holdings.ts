// The two interludes: what you are carrying, and what you have become.
//
// Reachable from every screen, because the director adds their cells to
// every screen -- and they must give back exactly the screen they were
// opened from. That is the whole reason the director keeps a STACK: these
// two push a frame and pop it, and the fight or the offer underneath never
// learns it was interrupted.
//
// They read game state and change nothing. A screen whose only exit is
// "back" is still a screen, and it earns its place by being where a
// modifier's live effects are read (model/modifiers.ts describes them from
// the same declaration the resolver applies, so what is shown here is what
// is actually happening).

import type { StageModule } from '../core/stage'
import { holdingCounts } from '../model/gameState'
import { describeModifier, type ModifierKind } from '../model/modifiers'

export const ACQUIRED_ITEMS_STAGE_ID = 'acquiredItems'
export const ACQUIRED_TRAITS_STAGE_ID = 'acquiredTraits'

const BACK_CHOICE_ID = 'holdings:back'

function holdingsStage(id: string, kind: ModifierKind, emptyLine: string): StageModule {
  return {
    id,

    enter: (_input, context, rng) => ({
      state: {},
      // The narration the player was reading is REPLACED while an interlude
      // is up and restored when it closes, which is why the interlude says
      // what it is: coming back to a fight's last line under a list of
      // trinkets would read as though the fight had moved on.
      narration: context.held.some((modifier) => modifier.kind === kind)
        ? `You take stock of what you carry.`
        : emptyLine,
      rng,
    }),

    present: (_state, context) => {
      const counts = holdingCounts(context.held)
      return {
        choices: [
          ...context.held
            .filter((modifier) => modifier.kind === kind)
            .map((modifier) => ({
              id: `holding:${modifier.id}`,
              label: modifier.name,
              icon: modifier.icon,
              detail: { title: modifier.name, lines: describeModifier(modifier, counts) },
            })),
          { id: BACK_CHOICE_ID, label: 'Back', icon: 'fa-solid fa-rotate-left' },
        ],
      }
    },

    // Everything here is read-only: looking at a thing you own is not a
    // move. Selecting one is how its effects reach the tab bar, and that
    // has already happened by the time a choice can be made.
    resolve: (state, choiceId, _context, rng) =>
      choiceId === BACK_CHOICE_ID ? { kind: 'pop', rng } : { kind: 'stay', state, rng },
  }
}

export const acquiredItemsStage = holdingsStage(
  ACQUIRED_ITEMS_STAGE_ID,
  'item',
  'You are carrying nothing at all.',
)

export const acquiredTraitsStage = holdingsStage(
  ACQUIRED_TRAITS_STAGE_ID,
  'trait',
  'Nothing about you is remarkable yet.',
)
