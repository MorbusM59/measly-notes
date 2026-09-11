// The welcome screen: the only stage that runs without a game.
//
// It is the root of the stack, which means it is also where the player
// lands when anything pops past the bottom -- a game that ended does not
// have to know the way home.

import type { StageModule } from '../core/stage'
import { resumableGame } from '../model/gameState'

export const WELCOME_STAGE_ID = 'welcome'

const CHOICE = {
  start: 'welcome:start',
  continue: 'welcome:continue',
  settings: 'welcome:settings',
} as const

export const welcomeStage: StageModule = {
  id: WELCOME_STAGE_ID,

  enter: (_input, _context, rng) => ({
    state: {},
    narration: 'What would you like to do?',
    rng,
  }),

  present: (_state, context) => {
    const resumable = resumableGame(context.save)
    return {
      choices: [
        { id: CHOICE.start, label: 'Start new adventure', icon: 'fa-solid fa-flag' },
        ...(resumable
          ? [{ id: CHOICE.continue, label: 'Continue previous adventure', icon: 'fa-solid fa-play' }]
          : []),
        { id: CHOICE.settings, label: 'Change Game Settings', icon: 'fa-solid fa-sliders' },
      ],
    }
  },

  resolve: (state, choiceId, context, rng) => {
    if (choiceId === CHOICE.start) {
      return {
        kind: 'replace',
        stageId: 'characterCreation',
        input: { step: 'origin' },
        effects: [{ kind: 'startGame' }],
        rng,
      }
    }

    if (choiceId === CHOICE.continue) {
      const game = resumableGame(context.save)
      if (!game) return { kind: 'stay', state, rng }
      // A resumed game re-enters at the encounter selector. Resuming to the
      // exact screen the player left is what the persisted stack is FOR,
      // and it will land here once leaving a game suspends its stack into
      // its row rather than discarding it -- see model/gameState.ts.
      return {
        kind: 'replace',
        stageId: 'encounterSelect',
        effects: [{ kind: 'openGame', gameId: game.id }],
        narration: 'You take up where you left off.',
        rng,
      }
    }

    if (choiceId === CHOICE.settings) {
      return {
        kind: 'stay',
        state,
        narration: 'Difficulty and presets are not specified yet. What would you like to do?',
        rng,
      }
    }

    return { kind: 'stay', state, rng }
  },
}
