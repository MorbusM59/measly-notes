// The hub a level keeps returning to: what do you do next.
//
// Two standard options today. The design has a third kind -- a situational
// encounter offered by the region or by what has already happened ("Examine
// Peculiar Rock") -- and a count of options that widens with Perception.
// Neither is written here, because neither the situational pool nor what a
// wider list would be drawn FROM has been specified. The place they will
// attach is this function and nowhere else.

import type { StageModule } from '../core/stage'

export const ENCOUNTER_SELECT_STAGE_ID = 'encounterSelect'

export const encounterSelectStage: StageModule = {
  id: ENCOUNTER_SELECT_STAGE_ID,

  enter: (_input, _context, rng) => ({ state: {}, rng }),

  present: () => ({
    choices: [
      { id: 'encounter:hunt', label: 'Go Hunting', icon: 'fa-solid fa-paw' },
      { id: 'encounter:explore', label: 'Go Exploring', icon: 'fa-solid fa-compass' },
    ],
  }),

  resolve: (state, choiceId, _context, rng) => {
    if (choiceId === 'encounter:hunt' || choiceId === 'encounter:explore') {
      return {
        kind: 'replace',
        stageId: 'underConstruction',
        input: { what: choiceId === 'encounter:hunt' ? 'Hunting' : 'Exploring' },
        rng,
      }
    }
    return { kind: 'stay', state, rng }
  },
}
