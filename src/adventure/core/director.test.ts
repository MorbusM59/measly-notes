import { describe, expect, it } from 'vitest'
import { buildCatalog, THOCKQUEST, validateContent } from '../content'
import { choose, CORE_CHOICE_IDS, currentScreen, ensureEntered, type DirectorDeps } from './director'
import { emptySave, type GameSave } from '../model/gameState'
import { CORE_STAGE_IDS, ROOT_STAGE_ID, STAGES } from '../stages'
import { MAX_STAGE_CHOICES } from './screen'

const DEPS: DirectorDeps = {
  stages: STAGES,
  content: THOCKQUEST,
  catalog: buildCatalog(THOCKQUEST),
  rootStageId: ROOT_STAGE_ID,
  coreStageIds: CORE_STAGE_IDS,
}

const NOW = 1_700_000_000_000

function start(seed = 4242): GameSave {
  return ensureEntered(emptySave(seed), DEPS, NOW)
}

function screenOf(save: GameSave) {
  const screen = currentScreen(save, DEPS)
  if (!screen) throw new Error('no screen')
  return screen
}

/** The first choice that is the stage's own rather than one the director adds. */
function firstStageChoiceId(save: GameSave): string {
  const coreIds = new Set<string>(Object.values(CORE_CHOICE_IDS))
  const choice = screenOf(save).choices.find((candidate) => !coreIds.has(candidate.id))
  if (!choice) throw new Error('no stage choice on offer')
  return choice.id
}

/** Plays by always taking the first offered choice, recording what was taken. */
function playForward(save: GameSave, steps: number): { save: GameSave; taken: string[] } {
  let current = save
  const taken: string[] = []
  for (let index = 0; index < steps; index += 1) {
    const choiceId = firstStageChoiceId(current)
    taken.push(choiceId)
    current = choose(current, choiceId, DEPS, NOW).save
  }
  return { save: current, taken }
}

describe('content', () => {
  it('is internally consistent', () => {
    expect(validateContent(THOCKQUEST)).toEqual([])
  })
})

describe('director', () => {
  it('puts a player with an empty stack on the root stage, and does it only once', () => {
    const first = start()
    expect(first.director.stack).toHaveLength(1)
    expect(first.director.stack[0].stageId).toBe(ROOT_STAGE_ID)
    // Idempotent, because it runs on a React effect that can re-run.
    expect(ensureEntered(first, DEPS, NOW)).toBe(first)
  })

  it('adds the way out to every screen, and the two interludes once a game exists', () => {
    const welcome = start()
    const welcomeIds = screenOf(welcome).choices.map((choice) => choice.id)
    expect(welcomeIds).toContain(CORE_CHOICE_IDS.leave)
    // Nothing to look at before a game exists, so nothing is offered.
    expect(welcomeIds).not.toContain(CORE_CHOICE_IDS.items)

    const inGame = playForward(welcome, 1).save
    const inGameIds = screenOf(inGame).choices.map((choice) => choice.id)
    expect(inGameIds).toEqual(expect.arrayContaining([CORE_CHOICE_IDS.items, CORE_CHOICE_IDS.traits, CORE_CHOICE_IDS.leave]))
  })

  it('reports leaving as a host action and changes nothing itself', () => {
    const save = start()
    const result = choose(save, CORE_CHOICE_IDS.leave, DEPS, NOW)
    expect(result.hostAction).toBe('leave')
    expect(result.save).toBe(save)
  })

  it('returns an interlude to exactly the screen it was opened from', () => {
    const playing = playForward(start(), 3).save
    const before = screenOf(playing)

    const opened = choose(playing, CORE_CHOICE_IDS.items, DEPS, NOW).save
    expect(opened.director.stack).toHaveLength(playing.director.stack.length + 1)
    expect(screenOf(opened).stageId).toBe(CORE_STAGE_IDS.items)

    const closed = choose(opened, 'holdings:back', DEPS, NOW).save
    const after = screenOf(closed)
    expect(after.stageId).toBe(before.stageId)
    expect(after.choices.map((choice) => choice.id)).toEqual(before.choices.map((choice) => choice.id))
    // The stage underneath never learned it was interrupted.
    expect(closed.director.stack).toEqual(playing.director.stack)
  })

  it('ignores a choice that was not on offer rather than corrupting the game', () => {
    const save = playForward(start(), 2).save
    expect(choose(save, 'nonsense:choice', DEPS, NOW).save).toBe(save)
  })

  it('never leaves the player nowhere: popping past the bottom lands on the root stage', () => {
    // The interlude is the only stage that pops today, so it is opened at
    // the root -- where there is nothing underneath to go back to.
    const playing = playForward(start(), 1).save
    const opened = choose(playing, CORE_CHOICE_IDS.items, DEPS, NOW).save
    const popped = choose(opened, 'holdings:back', DEPS, NOW).save
    expect(popped.director.stack.length).toBeGreaterThan(0)
    expect(screenOf(popped)).toBeTruthy()
  })

  it('keeps every screen inside the ring budget', () => {
    let save = start()
    const coreIds = new Set<string>(Object.values(CORE_CHOICE_IDS))
    for (let index = 0; index < 12; index += 1) {
      const screen = screenOf(save)
      const stageChoices = screen.choices.filter((choice) => !coreIds.has(choice.id))
      expect(stageChoices.length).toBeLessThanOrEqual(MAX_STAGE_CHOICES)
      save = choose(save, firstStageChoiceId(save), DEPS, NOW).save
    }
  })
})

describe('the promises the platform is built on', () => {
  it('presents the same screen every time it is asked, at every step', () => {
    // `present` is called on every React render, so it has to be a pure
    // function of state. This is what catches a stage that rolls or reads a
    // clock while BUILDING its cells -- which the replay test below cannot
    // see, because a screen is not part of the save. (Checked by breaking
    // it on purpose: a Math.random in a label passes replay and fails here.)
    let save = start(4242)
    for (let index = 0; index < 12; index += 1) {
      expect(currentScreen(save, DEPS)).toEqual(currentScreen(save, DEPS))
      save = choose(save, firstStageChoiceId(save), DEPS, NOW).save
    }
  })

  it('replays: the same seed and the same choices produce the same game, every time', () => {
    // The property, not a step: every roll the game makes is threaded
    // through the save, so a game is reproducible from its seed and the
    // choices taken -- which is what makes a defect in it reportable
    // rather than merely describable.
    const first = playForward(start(777), 10)
    const second = playForward(start(777), 10)
    expect(second.taken).toEqual(first.taken)
    expect(second.save).toEqual(first.save)
  })

  it('diverges on a different seed, so the replay above is not passing by being empty', () => {
    const one = playForward(start(1), 10).save
    const two = playForward(start(999_999), 10).save
    expect(two).not.toEqual(one)
  })

  it('survives being written to disk and read back at EVERY screen along the way', () => {
    // "Leave the game" is a cell on every screen, so every screen has to
    // round trip. A stage that put a closure, a Map or an undefined into
    // its state would break exactly one screen, for exactly the player who
    // quit on it.
    let save = start(31)
    for (let index = 0; index < 12; index += 1) {
      const roundTripped = JSON.parse(JSON.stringify(save)) as GameSave
      expect(roundTripped).toEqual(save)
      // And the round-tripped save must still be playable, not merely equal.
      expect(screenOf(roundTripped).choices.length).toBeGreaterThan(0)
      save = choose(save, firstStageChoiceId(save), DEPS, NOW).save
    }
  })

  it('never writes from a stage: looking at a screen twice changes nothing', () => {
    const save = playForward(start(12), 4).save
    const before = JSON.parse(JSON.stringify(save)) as GameSave
    screenOf(save)
    screenOf(save)
    expect(save).toEqual(before)
  })
})

describe('a game, played', () => {
  it('runs from the welcome screen to an encounter, carrying what was chosen', () => {
    let save = start(2024)
    expect(screenOf(save).narration).toContain('What would you like to do?')

    save = choose(save, 'welcome:start', DEPS, NOW).save
    expect(screenOf(save).narration).toContain('What are you?')
    expect(save.activeGameId).not.toBeNull()

    save = choose(save, 'origin:warrior', DEPS, NOW).save
    const game = save.games.find((candidate) => candidate.id === save.activeGameId)
    expect(game?.baseStats.might).toBe(2)
    expect(game?.baseStats.agility).toBe(1)
    expect(screenOf(save).narration).toContain('What are you known for?')

    save = choose(save, firstStageChoiceId(save), DEPS, NOW).save
    expect(screenOf(save).narration).toContain('never leave home without')

    save = choose(save, firstStageChoiceId(save), DEPS, NOW).save
    expect(screenOf(save).stageId).toBe('regionSelect')
    // One trait and one item, taken in that order.
    expect(save.holdings.map((row) => row.kind)).toEqual(['trait', 'item'])

    save = choose(save, firstStageChoiceId(save), DEPS, NOW).save
    expect(screenOf(save).stageId).toBe('encounterSelect')
    expect(save.games[0].regionId).not.toBeNull()

    // And the permanent record kept the decisions worth keeping, as rows.
    expect(save.outcomes.map((row) => row.outcome)).toEqual(['origin-chosen', 'region-entered'])
  })

  it('shows a modifier with its live effects, which is what the tab bar reads', () => {
    let save = choose(start(2024), 'welcome:start', DEPS, NOW).save
    save = choose(save, 'origin:warrior', DEPS, NOW).save
    const offer = screenOf(save).choices[0]
    expect(offer.detail?.title).toBeTruthy()
    expect(offer.detail?.lines.length).toBeGreaterThan(0)
  })
})
