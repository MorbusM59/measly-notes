// The first adventure. Content only -- every mechanic it uses is already
// described by types.ts, and the engine has no idea this particular story
// exists. It is here as much to prove the model carries a real story as to
// be played: it exercises requirements, flag-gated choices, weighted
// chance, a stat check, a resource loop that can genuinely be lost, and
// three distinct endings, without a single line of story-specific code
// anywhere else in the module.
//
// Two authoring rules the ring imposes, both enforced by
// validateAdventure (engine.ts) rather than by discipline:
//   - at most MAX_CHOICES_PER_STEP choices per scene, and
//   - every scene needs one choice with no requirements, so no run can
//     arrive somewhere with nothing available.
//
// Prompts are one line each: they are read across the tab bar above the
// editor, in the strip where a note's tabs normally sit (the ring's own
// centre never shows them -- see escapeMenuContract.ts's EscapeMenuModeStatus
// for why). Changing this prose does not invalidate a saved run and so does
// not need a contentVersion bump; only a change to the SHAPE of the story
// -- a scene removed, a choice's meaning altered -- does.

import type { AdventureDefinition } from '../types'

export const THE_LONG_MARGIN: AdventureDefinition = {
  id: 'the-long-margin',
  title: 'The Long Margin',
  contentVersion: 1,
  startSceneId: 'threshold',

  stats: [
    {
      key: 'lantern',
      label: 'Lantern',
      short: 'LAN',
      initial: 3,
      min: 0,
      max: 5,
      fatalAtMin: { endingId: 'the-dark', sceneId: 'the-dark' },
    },
    {
      key: 'resolve',
      label: 'Resolve',
      short: 'RES',
      initial: 3,
      min: 0,
      max: 5,
      fatalAtMin: { endingId: 'gave-out', sceneId: 'gave-out' },
    },
    { key: 'insight', label: 'Insight', short: 'INS', initial: 0, min: 0, max: 9 },
  ],

  scenes: [
    {
      id: 'threshold',
      prompt: 'The margin opens, and it goes down a long way.',
      choices: [
        { id: 'descend', label: 'Take the stairs', icon: 'fa-solid fa-stairs', outcome: { kind: 'goto', sceneId: 'stairs' } },
        {
          id: 'read-the-wall',
          label: 'Read the wall',
          icon: 'fa-solid fa-book-open',
          effects: [{ kind: 'adjustStat', stat: 'lantern', delta: -1 }],
          outcome: { kind: 'goto', sceneId: 'wall' },
        },
      ],
    },

    {
      id: 'wall',
      prompt: 'Someone wrote on this wall before you, and stopped mid-word.',
      onEnter: [{ kind: 'adjustStat', stat: 'insight', delta: 1 }],
      choices: [
        {
          id: 'finish-the-word',
          label: 'Finish the word',
          icon: 'fa-solid fa-pen-nib',
          requires: [{ kind: 'stat', stat: 'insight', op: 'gte', value: 1 }],
          effects: [
            { kind: 'setFlag', flag: 'finished-a-word', present: true },
            { kind: 'adjustStat', stat: 'resolve', delta: 1 },
          ],
          outcome: { kind: 'goto', sceneId: 'stairs' },
        },
        { id: 'leave-it', label: 'Leave it unfinished', icon: 'fa-solid fa-person-walking', outcome: { kind: 'goto', sceneId: 'stairs' } },
      ],
    },

    {
      id: 'stairs',
      prompt: 'A draught comes up the stairwell, and it wants your flame.',
      choices: [
        {
          id: 'shield-the-flame',
          label: 'Shield the flame',
          icon: 'fa-solid fa-hand-sparkles',
          outcome: {
            kind: 'check',
            stat: 'resolve',
            difficulty: 6,
            success: { sceneId: 'stacks', effects: [{ kind: 'adjustStat', stat: 'insight', delta: 1 }] },
            failure: { sceneId: 'stacks', effects: [{ kind: 'adjustStat', stat: 'lantern', delta: -1 }] },
          },
        },
        {
          id: 'hurry',
          label: 'Hurry through',
          icon: 'fa-solid fa-wind',
          effects: [
            { kind: 'adjustStat', stat: 'lantern', delta: -1 },
            { kind: 'adjustStat', stat: 'resolve', delta: 1 },
          ],
          outcome: { kind: 'goto', sceneId: 'stacks' },
        },
      ],
    },

    {
      id: 'stacks',
      prompt: 'Shelves and shelves of notes nobody ever came back for.',
      choices: [
        {
          id: 'search-the-shelves',
          label: 'Search the shelves',
          icon: 'fa-solid fa-magnifying-glass',
          effects: [{ kind: 'adjustStat', stat: 'resolve', delta: -1 }],
          outcome: {
            kind: 'chance',
            branches: [
              { weight: 2, sceneId: 'lost-note' },
              { weight: 3, sceneId: 'dust' },
            ],
          },
        },
        {
          id: 'trim-the-wick',
          label: 'Trim the wick',
          icon: 'fa-solid fa-fire-flame-simple',
          requires: [{ kind: 'stat', stat: 'lantern', op: 'lte', value: 2 }],
          effects: [
            { kind: 'adjustStat', stat: 'lantern', delta: 1 },
            { kind: 'adjustStat', stat: 'resolve', delta: -1 },
          ],
          outcome: { kind: 'goto', sceneId: 'stacks' },
        },
        { id: 'press-on', label: 'Press on', icon: 'fa-solid fa-arrow-down', outcome: { kind: 'goto', sceneId: 'well' } },
      ],
    },

    {
      id: 'lost-note',
      prompt: 'A page in your own handwriting. You do not remember writing it.',
      onEnter: [
        { kind: 'adjustStat', stat: 'insight', delta: 1 },
        { kind: 'setFlag', flag: 'carries-the-page', present: true },
      ],
      choices: [
        { id: 'pocket-it', label: 'Pocket it', icon: 'fa-solid fa-scroll', outcome: { kind: 'goto', sceneId: 'well' } },
        {
          id: 'read-it-aloud',
          label: 'Read it aloud',
          icon: 'fa-solid fa-volume-high',
          effects: [
            { kind: 'adjustStat', stat: 'insight', delta: 1 },
            { kind: 'adjustStat', stat: 'resolve', delta: -1 },
          ],
          outcome: { kind: 'goto', sceneId: 'well' },
        },
      ],
    },

    {
      id: 'dust',
      prompt: 'Only dust, and the sound of your own attention.',
      choices: [
        { id: 'back-to-the-stacks', label: 'Back to the stacks', icon: 'fa-solid fa-arrow-up', outcome: { kind: 'goto', sceneId: 'stacks' } },
      ],
    },

    {
      id: 'well',
      prompt: 'A stairwell that goes down further than the building is tall.',
      choices: [
        {
          id: 'go-down',
          label: 'Go down anyway',
          icon: 'fa-solid fa-arrow-down',
          outcome: {
            kind: 'check',
            stat: 'insight',
            difficulty: 6,
            success: { sceneId: 'heart' },
            failure: { sceneId: 'heart', effects: [{ kind: 'adjustStat', stat: 'lantern', delta: -1 }] },
          },
        },
        { id: 'climb-out', label: 'Climb back out', icon: 'fa-solid fa-door-open', outcome: { kind: 'goto', sceneId: 'surfaced' } },
      ],
    },

    {
      id: 'heart',
      prompt: 'At the bottom: a desk, a chair, and one unfinished line.',
      choices: [
        {
          id: 'finish-the-line',
          label: 'Finish the line',
          icon: 'fa-solid fa-feather-pointed',
          requires: [
            {
              kind: 'any',
              of: [
                { kind: 'flag', flag: 'carries-the-page' },
                { kind: 'stat', stat: 'insight', op: 'gte', value: 3 },
              ],
            },
          ],
          outcome: { kind: 'goto', sceneId: 'finished-line' },
        },
        { id: 'sit-with-it', label: 'Sit with it', icon: 'fa-solid fa-chair', outcome: { kind: 'goto', sceneId: 'quiet-desk' } },
      ],
    },

    {
      id: 'finished-line',
      prompt: 'You finish the line. The margin closes behind you, satisfied.',
      ending: { id: 'finished-line', tone: 'triumph' },
    },
    {
      id: 'quiet-desk',
      prompt: 'You sit with it a while, and leave it for whoever comes next.',
      ending: { id: 'quiet-desk', tone: 'quiet' },
    },
    {
      id: 'surfaced',
      prompt: 'You surface with exactly what you carried down, and nothing else.',
      ending: { id: 'surfaced', tone: 'quiet' },
    },
    {
      id: 'the-dark',
      prompt: 'The flame gutters out. The rest of it is dark, and long.',
      ending: { id: 'the-dark', tone: 'defeat' },
    },
    {
      id: 'gave-out',
      prompt: 'You stop. Not decided against it -- just stopped.',
      ending: { id: 'gave-out', tone: 'defeat' },
    },
  ],
}
