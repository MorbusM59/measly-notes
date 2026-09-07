import { describe, expect, it } from 'vitest'
import { applyChoice, createSession, listChoices, MAX_CHOICES_PER_STEP, summarizeStats, validateAdventure } from './engine'
import { THE_LONG_MARGIN } from './content/theLongMargin'
import type { AdventureDefinition, AdventureSession } from './types'

/**
 * A deliberately tiny story used for the mechanical tests, so a change to
 * the shipped content can never turn an engine test green or red for
 * reasons that have nothing to do with the engine. THE_LONG_MARGIN is
 * exercised separately, and only through validateAdventure and a full
 * playthrough -- the two things that are genuinely about the content.
 */
const TEST_STORY: AdventureDefinition = {
  id: 'test-story',
  title: 'Test Story',
  contentVersion: 3,
  startSceneId: 'start',
  stats: [
    { key: 'coin', label: 'Coin', short: 'CN', initial: 2, min: 0, max: 4 },
    { key: 'air', label: 'Air', short: 'AIR', initial: 1, min: 0, max: 3, fatalAtMin: { endingId: 'drowned', sceneId: 'drowned' } },
  ],
  scenes: [
    {
      id: 'start',
      prompt: 'Start.',
      choices: [
        {
          id: 'spend',
          label: 'Spend a coin',
          icon: 'fa-solid fa-coins',
          effects: [{ kind: 'adjustStat', stat: 'coin', delta: -1 }],
          outcome: { kind: 'goto', sceneId: 'market' },
        },
        {
          id: 'rich-only',
          label: 'Buy the map',
          icon: 'fa-solid fa-map',
          requires: [{ kind: 'stat', stat: 'coin', op: 'gte', value: 5 }],
          outcome: { kind: 'goto', sceneId: 'market' },
        },
        {
          id: 'dive',
          label: 'Dive',
          icon: 'fa-solid fa-water',
          effects: [{ kind: 'adjustStat', stat: 'air', delta: -1 }],
          outcome: { kind: 'goto', sceneId: 'market' },
        },
        {
          id: 'gamble',
          label: 'Gamble',
          icon: 'fa-solid fa-dice',
          outcome: {
            kind: 'chance',
            branches: [
              { weight: 1, sceneId: 'market', effects: [{ kind: 'setFlag', flag: 'lucky', present: true }] },
              { weight: 1, sceneId: 'market', effects: [{ kind: 'setFlag', flag: 'unlucky', present: true }] },
            ],
          },
        },
      ],
    },
    {
      id: 'market',
      prompt: 'Market.',
      onEnter: [{ kind: 'setFlag', flag: 'saw-market', present: true }],
      choices: [{ id: 'leave', label: 'Leave', icon: 'fa-solid fa-door-open', outcome: { kind: 'goto', sceneId: 'home' } }],
    },
    { id: 'home', prompt: 'Home.', ending: { id: 'home', tone: 'quiet' } },
    { id: 'drowned', prompt: 'Drowned.', ending: { id: 'drowned', tone: 'defeat' } },
  ],
}

const NOW = 1_700_000_000_000

function start(seed = 1): AdventureSession {
  return createSession(TEST_STORY, { seed, nowMs: NOW })
}

describe('createSession', () => {
  it('starts in the opening scene with content-declared stats', () => {
    const session = start()
    expect(session.sceneId).toBe('start')
    expect(session.stats).toEqual({ coin: 2, air: 1 })
    expect(session.status).toBe('active')
    expect(session.turn).toBe(0)
    expect(session.visited).toEqual(['start'])
  })

  it('records the content version it began under, so a later story change is detectable', () => {
    expect(start().contentVersion).toBe(TEST_STORY.contentVersion)
  })
})

describe('listChoices', () => {
  it('drops choices whose requirements do not hold', () => {
    expect(listChoices(TEST_STORY, start()).map((choice) => choice.id)).toEqual(['spend', 'dive', 'gamble'])
  })

  it('never offers more than the ring can show', () => {
    expect(listChoices(TEST_STORY, start()).length).toBeLessThanOrEqual(MAX_CHOICES_PER_STEP)
  })

  it('offers nothing once the run has ended', () => {
    const ended = applyChoice(TEST_STORY, applyChoice(TEST_STORY, start(), 'spend', { nowMs: NOW }), 'leave', { nowMs: NOW })
    expect(ended.status).toBe('ended')
    expect(listChoices(TEST_STORY, ended)).toEqual([])
  })
})

describe('applyChoice', () => {
  it('applies effects, advances the scene, and records history', () => {
    const next = applyChoice(TEST_STORY, start(), 'spend', { nowMs: NOW + 1 })
    expect(next.stats.coin).toBe(1)
    expect(next.sceneId).toBe('market')
    expect(next.flags).toContain('saw-market')
    expect(next.turn).toBe(1)
    expect(next.history).toEqual([{ sceneId: 'start', choiceId: 'spend', resultSceneId: 'market' }])
    expect(next.updatedAtMs).toBe(NOW + 1)
  })

  it('returns the session untouched for a choice that is not currently available', () => {
    const session = start()
    expect(applyChoice(TEST_STORY, session, 'rich-only', { nowMs: NOW })).toBe(session)
    expect(applyChoice(TEST_STORY, session, 'no-such-choice', { nowMs: NOW })).toBe(session)
  })

  it('ends the run when a fatal stat bottoms out, before the destination gets a turn', () => {
    const drowned = applyChoice(TEST_STORY, start(), 'dive', { nowMs: NOW })
    expect(drowned.status).toBe('ended')
    expect(drowned.endingId).toBe('drowned')
    expect(drowned.sceneId).toBe('drowned')
  })

  it('clamps stats to the range content declared', () => {
    // Two coins, three spends: the third is unavailable only because the
    // scene is gone, so drive the clamp directly through a repeated dive on
    // a stat that cannot go below zero.
    const session = { ...start(), stats: { coin: 0, air: 3 } }
    const next = applyChoice(TEST_STORY, { ...session, stats: { ...session.stats, coin: 0 } }, 'spend', { nowMs: NOW })
    expect(next.stats.coin).toBe(0)
  })

  it('is deterministic: the same seed and the same choices replay identically', () => {
    const replay = (seed: number) => {
      const session = applyChoice(TEST_STORY, createSession(TEST_STORY, { seed, nowMs: NOW }), 'gamble', { nowMs: NOW })
      return { flags: session.flags, rngState: session.rngState }
    }
    expect(replay(12345)).toEqual(replay(12345))
  })

  it('resolves a chance outcome differently for different seeds', () => {
    // Not a statistical claim -- just that the draw is actually consulted.
    // Two seeds, one of which is known to take the other branch.
    const flagsFor = (seed: number) =>
      applyChoice(TEST_STORY, createSession(TEST_STORY, { seed, nowMs: NOW }), 'gamble', { nowMs: NOW }).flags
    const outcomes = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => flagsFor(seed).includes('lucky'))
    expect(new Set(outcomes).size).toBe(2)
  })

  it('does not consume randomness for a plain goto', () => {
    const session = start()
    expect(applyChoice(TEST_STORY, session, 'spend', { nowMs: NOW }).rngState).toBe(session.rngState)
  })
})

describe('summarizeStats', () => {
  it('reports every declared stat in declaration order, with its short form', () => {
    expect(summarizeStats(TEST_STORY, start())).toEqual([
      { key: 'coin', label: 'Coin', short: 'CN', value: 2 },
      { key: 'air', label: 'Air', short: 'AIR', value: 1 },
    ])
  })
})

describe('validateAdventure', () => {
  it('passes the shipped story', () => {
    expect(validateAdventure(THE_LONG_MARGIN)).toEqual([])
  })

  it('catches a dangling scene reference', () => {
    const broken: AdventureDefinition = {
      ...TEST_STORY,
      scenes: TEST_STORY.scenes.map((scene) =>
        scene.id === 'market'
          ? { ...scene, choices: [{ id: 'leave', label: 'Leave', icon: '', outcome: { kind: 'goto', sceneId: 'nowhere' } }] }
          : scene,
      ),
    }
    expect(validateAdventure(broken)).toContain('scene "market" choice "leave" points at unknown scene "nowhere"')
  })

  it('catches a scene where a run could arrive with nothing available', () => {
    const broken: AdventureDefinition = {
      ...TEST_STORY,
      scenes: TEST_STORY.scenes.map((scene) =>
        scene.id === 'market'
          ? {
              ...scene,
              choices: [
                {
                  id: 'leave',
                  label: 'Leave',
                  icon: '',
                  requires: [{ kind: 'stat', stat: 'coin', op: 'gte', value: 99 }],
                  outcome: { kind: 'goto', sceneId: 'home' },
                },
              ],
            }
          : scene,
      ),
    }
    expect(validateAdventure(broken)).toContain(
      'scene "market" has no unconditional choice; a run could reach it with nothing available',
    )
  })

  it('catches an undeclared stat', () => {
    const broken: AdventureDefinition = {
      ...TEST_STORY,
      scenes: TEST_STORY.scenes.map((scene) =>
        scene.id === 'home' ? { ...scene, onEnter: [{ kind: 'adjustStat', stat: 'ghost', delta: 1 }] } : scene,
      ),
    }
    expect(validateAdventure(broken)).toContain('scene "home" onEnter uses undeclared stat "ghost"')
  })
})

describe('the shipped story', () => {
  it('can be played from its opening to an ending, always with something to choose', () => {
    let session = createSession(THE_LONG_MARGIN, { seed: 99, nowMs: NOW })
    let steps = 0
    while (session.status === 'active' && steps < 50) {
      const choices = listChoices(THE_LONG_MARGIN, session)
      expect(choices.length).toBeGreaterThan(0)
      // Always take the last option, which walks the story forward rather
      // than round its resource loop.
      session = applyChoice(THE_LONG_MARGIN, session, choices[choices.length - 1].id, { nowMs: NOW })
      steps += 1
    }
    expect(session.status).toBe('ended')
    expect(session.endingId).toBeTruthy()
  })
})
