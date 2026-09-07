import { describe, expect, it } from 'vitest'
import { BASE_STAT_CAP, clampBaseStats, createStatBlock, deriveStats } from './stats'
import { DIFFICULTY_PRESETS, enemyBaseValue } from './difficulty'
import { resolveCheck } from './checks'
import { resolveProfile, type Modifier, type ModifierCatalog } from './modifiers'
import { pickArchetype, rollEnemy, type EnemyArchetype } from './enemies'
import { DEFAULT_COMBAT_TUNING, resolveCombat } from './combat'
import { rollOffers } from './offers'
import { EMPTY_LOADOUT, acquire, keepCandidateIds, keepOneOfEach, type Loadout } from './loadout'
import { STANDARD_ROUND_LAYOUT } from './round'
import {
  applyStepOutcome,
  beginRound,
  endRound,
  profileOf,
  spendStatPoint,
  startRun,
  takeOffer,
  type RunState,
} from './run'

const NOW = 1_700_000_000_000

describe('stats', () => {
  it('derives every value from the specification\'s formulas', () => {
    const derived = deriveStats({ luck: 4, might: 2, perception: 3, charm: 1, agility: 6 })
    expect(derived.offerChoices).toBe(4)        // 2 + 4/2
    expect(derived.critChance).toBeCloseTo(0.6) // 20% + 10%*4
    expect(derived.maxHitPoints).toBe(80)       // 50 + 15*2
    expect(derived.damageMultiplier).toBeCloseTo(0.8) // 50% + 15%*2
    expect(derived.encounterChoices).toBe(3)    // 2 + floor(3/2)
    expect(derived.spellCasts).toBe(3)          // 2 + 1
    expect(derived.dodgeChance).toBeCloseTo(0.8) // 50% + 5%*6
    expect(derived.hitChance).toBeCloseTo(0.8)
  })

  it('floors the half-step counts rather than offering half a choice', () => {
    expect(deriveStats({ ...createStatBlock(), luck: 3, perception: 5 })).toMatchObject({
      offerChoices: 3,
      encounterChoices: 4,
    })
  })

  it('clamps chances into 0..1 however high a stat climbs', () => {
    const derived = deriveStats({ ...createStatBlock(), luck: 20, agility: 30 })
    expect(derived.critChance).toBe(1)
    expect(derived.dodgeChance).toBe(1)
  })

  it('caps BASE stats at six', () => {
    expect(clampBaseStats({ ...createStatBlock(), might: 9 }).might).toBe(BASE_STAT_CAP)
    expect(clampBaseStats({ ...createStatBlock(), might: -3 }).might).toBe(0)
  })
})

describe('modifiers', () => {
  const chainmail: Modifier = { id: 'chainmail', name: 'Chainmail', kind: 'gear', statDeltas: { might: 3 } }
  const charm: Modifier = { id: 'charm', name: 'Rabbit Foot', kind: 'trait', derivedDeltas: { critChance: 0.15 } }
  const cloak: Modifier = { id: 'cloak', name: 'Cloak', kind: 'gear', derivedScales: { dodgeChance: 1.5 } }

  it('caps base stats before gear, and not after -- the whole rule', () => {
    const profile = resolveProfile({ ...createStatBlock(), might: 9 }, [chainmail])
    expect(profile.stats.might).toBe(BASE_STAT_CAP + 3)
    expect(profile.derived.maxHitPoints).toBe(50 + 15 * 9)
  })

  it('scales before it adds, and normalizes after both', () => {
    const profile = resolveProfile({ ...createStatBlock(), agility: 1, luck: 0 }, [cloak, charm])
    expect(profile.derived.dodgeChance).toBeCloseTo(0.55 * 1.5) // scaled
    expect(profile.derived.critChance).toBeCloseTo(0.35)        // added
  })

  it('still clamps a chance gear pushed over 100%', () => {
    const profile = resolveProfile({ ...createStatBlock(), agility: 4 }, [cloak])
    expect(profile.derived.dodgeChance).toBe(1) // 0.7 * 1.5, clamped
  })

  it('leaves the base stats alone when nothing is held', () => {
    const profile = resolveProfile(createStatBlock(2), [])
    expect(profile.stats).toEqual(createStatBlock(2))
  })
})

describe('checks', () => {
  it('passes when the stat matches or beats the die plus the rating', () => {
    // The die is the opposition: at rating 0 a stat of 6 cannot fail, and a
    // rating at the die's maximum cannot be passed.
    for (let seed = 1; seed <= 40; seed += 1) {
      expect(resolveCheck(6, 0, seed).passed).toBe(true)
      expect(resolveCheck(6, 6, seed).passed).toBe(false)
    }
  })

  it('reports the roll it made, so an encounter can narrate it', () => {
    const result = resolveCheck(3, 2, 12345)
    expect(result.target).toBe(result.roll + 2)
    expect(result.passed).toBe(3 >= result.target)
    expect(result.rngState).not.toBe(12345)
  })
})

describe('difficulty', () => {
  it('scales the enemy base exponentially, per preset', () => {
    expect(enemyBaseValue('easy', 0)).toBeCloseTo(10)
    expect(enemyBaseValue('medium', 10)).toBeCloseTo(10 * 1.02 ** 10)
    expect(enemyBaseValue('insane', 20)).toBeGreaterThan(enemyBaseValue('hard', 20))
    expect(DIFFICULTY_PRESETS.insane.scaleFactor).toBe(1.1)
  })
})

describe('enemies', () => {
  const brute: EnemyArchetype = {
    id: 'brute', name: 'Brute', role: 'miniboss',
    health: { min: 1.4, max: 1.8 }, damage: { min: 0.8, max: 1.1 }, fame: 5,
  }

  it('rolls a statline inside the archetype\'s band of the round base', () => {
    const base = enemyBaseValue('hard', 12)
    for (let seed = 1; seed <= 30; seed += 1) {
      const { enemy } = rollEnemy(brute, 'hard', 12, seed)
      expect(enemy.maxHitPoints).toBeGreaterThanOrEqual(Math.round(base * 1.4))
      expect(enemy.maxHitPoints).toBeLessThanOrEqual(Math.round(base * 1.8))
      expect(enemy.damage).toBeGreaterThanOrEqual(1)
      expect(enemy.role).toBe('miniboss')
    }
  })

  it('picks only among archetypes of the asked-for role, and reports none when content has none', () => {
    expect(pickArchetype([brute], 'boss', 1).archetype).toBeNull()
    expect(pickArchetype([brute], 'miniboss', 1).archetype?.id).toBe('brute')
  })
})

describe('combat', () => {
  const derived = deriveStats({ luck: 2, might: 4, perception: 0, charm: 0, agility: 4 })
  const weakling = { archetypeId: 'w', name: 'Weakling', role: 'minion' as const, maxHitPoints: 5, damage: 1, fame: 1, tags: [] }
  const titan = { archetypeId: 't', name: 'Titan', role: 'boss' as const, maxHitPoints: 100000, damage: 40, fame: 50, tags: [] }

  it('resolves to a verdict in one call, with a log to narrate from', () => {
    const result = resolveCombat({ derived, hitPoints: derived.maxHitPoints, enemy: weakling, rngState: 7 })
    expect(result.outcome).toBe('victory')
    expect(result.log.length).toBeGreaterThan(0)
    expect(result.hitPointsRemaining).toBeLessThanOrEqual(derived.maxHitPoints)
  })

  it('loses, rather than hanging, against something it cannot beat', () => {
    const result = resolveCombat({ derived, hitPoints: derived.maxHitPoints, enemy: titan, rngState: 7 })
    expect(result.outcome).toBe('defeat')
    expect(result.hitPointsRemaining).toBe(0)
    expect(result.exchanges).toBeLessThanOrEqual(DEFAULT_COMBAT_TUNING.maxExchanges)
  })

  it('is deterministic for a given rng state', () => {
    const once = resolveCombat({ derived, hitPoints: 80, enemy: weakling, rngState: 4242 })
    const twice = resolveCombat({ derived, hitPoints: 80, enemy: weakling, rngState: 4242 })
    expect(once).toEqual(twice)
  })
})

describe('offers', () => {
  const pool: Modifier[] = Array.from({ length: 6 }, (_, index) => ({
    id: `m${index}`, name: `M${index}`, kind: 'gear' as const,
  }))

  it('never offers the same thing twice in one slate', () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const { offers } = rollOffers(pool, 4, seed)
      expect(new Set(offers.map((offer) => offer.id)).size).toBe(4)
    }
  })

  it('offers what exists when the pool is smaller than the ask', () => {
    expect(rollOffers(pool.slice(0, 2), 5, 1).offers).toHaveLength(2)
  })
})

describe('loadout', () => {
  it('keeps exactly one of each and discards the rest, previous keeps included', () => {
    let loadout: Loadout = { ...EMPTY_LOADOUT, keptGearId: 'old-sword', keptTraitId: 'old-trait' }
    loadout = acquire(loadout, 'gear', 'new-axe')
    loadout = acquire(loadout, 'trait', 'new-trait')
    expect(keepCandidateIds(loadout, 'gear')).toEqual(['old-sword', 'new-axe'])

    const kept = keepOneOfEach(loadout, { gearId: 'new-axe', traitId: 'old-trait' })
    expect(kept).toEqual({
      keptGearId: 'new-axe',
      keptTraitId: 'old-trait',
      roundGearIds: [],
      roundTraitIds: [],
    })
  })

  it('refuses to keep something that was never held', () => {
    expect(keepOneOfEach(EMPTY_LOADOUT, { gearId: 'imaginary' }).keptGearId).toBeNull()
  })
})

describe('run', () => {
  const catalog: ModifierCatalog = {
    gear: [
      { id: 'axe', name: 'Axe', kind: 'gear', statDeltas: { might: 1 } },
      { id: 'boots', name: 'Boots', kind: 'gear', statDeltas: { agility: 1 } },
      { id: 'ring', name: 'Ring', kind: 'gear', statDeltas: { luck: 1 } },
    ],
    traits: [
      { id: 'brave', name: 'Brave', kind: 'trait', statDeltas: { might: 1 } },
      { id: 'sly', name: 'Sly', kind: 'trait', statDeltas: { perception: 1 } },
    ],
  }

  const start = (): RunState => beginRound(startRun({ difficulty: 'medium', seed: 99, nowMs: NOW }), catalog)

  it('starts on the first step of a standard round, at full health', () => {
    const run = start()
    expect(run.round).toBe(1)
    expect(run.phase.kind).toBe('step')
    expect(run.stepIndex).toBe(0)
    expect(run.hitPoints).toBe(profileOf(run, catalog).derived.maxHitPoints)
    expect(run.spellCastsRemaining).toBe(2)
  })

  it('walks the layout and opens the end-of-round choice after the boss', () => {
    let run = start()
    for (let step = 0; step < STANDARD_ROUND_LAYOUT.steps.length; step += 1) {
      expect(run.phase.kind).toBe('step')
      run = applyStepOutcome(run, { fame: 1 }, NOW)
    }
    expect(run.phase.kind).toBe('roundEnd')
    expect(run.fame).toBe(STANDARD_ROUND_LAYOUT.steps.length)
  })

  it('ends the run the moment hit points run out', () => {
    const run = applyStepOutcome(start(), { damageTaken: 10_000 }, NOW)
    expect(run.phase).toEqual({ kind: 'over', reason: 'defeat' })
  })

  it('spends experience and gold as offers at the start of the next round', () => {
    let run = start()
    run = applyStepOutcome(run, { experienceUnits: 1, goldUnits: 1 }, NOW)
    while (run.phase.kind === 'step') run = applyStepOutcome(run, {}, NOW)
    run = endRound(run, {}, catalog, NOW)

    expect(run.round).toBe(2)
    expect(run.phase.kind).toBe('outfitting')
    if (run.phase.kind !== 'outfitting') throw new Error('unreachable')
    // Two selections queued (one trait, one gear); the trait comes first and
    // its offers are already rolled.
    expect(run.phase.queue).toHaveLength(2)
    expect(run.phase.queue[0].kind).toBe('trait')
    expect(run.phase.queue[0].offerIds.length).toBeGreaterThan(0)
    // Consumed as the queue was built, so a reload cannot spend them twice.
    expect(run.experienceUnits).toBe(0)
    expect(run.goldUnits).toBe(0)

    const takenTrait = run.phase.queue[0].offerIds[0]
    run = takeOffer(run, takenTrait, catalog)
    expect(run.loadout.roundTraitIds).toEqual([takenTrait])
    if (run.phase.kind !== 'outfitting') throw new Error('expected a second selection')
    expect(run.phase.queue[0].kind).toBe('gear')

    run = takeOffer(run, run.phase.queue[0].offerIds[0], catalog)
    expect(run.phase.kind).toBe('step')
  })

  it('refuses an offer that is not on the table', () => {
    let run = applyStepOutcome(start(), { goldUnits: 1 }, NOW)
    while (run.phase.kind === 'step') run = applyStepOutcome(run, {}, NOW)
    run = endRound(run, {}, catalog, NOW)
    const before = run
    expect(takeOffer(run, 'not-offered', catalog)).toBe(before)
  })

  it('grants stat points only through the layout, and caps them at six', () => {
    let run = applyStepOutcome(start(), { statPoints: 1 }, NOW)
    expect(run.statPoints).toBe(1)
    run = spendStatPoint(run, 'might')
    expect(run.baseStats.might).toBe(1)
    expect(run.statPoints).toBe(0)
    // Nothing left to spend.
    expect(spendStatPoint(run, 'might')).toBe(run)
    // And levelling stops at the cap even with points in hand.
    const capped = spendStatPoint({ ...run, statPoints: 1, baseStats: { ...run.baseStats, might: 6 } }, 'might')
    expect(capped.baseStats.might).toBe(6)
  })

  it('carries exactly one gear and one trait into the next round', () => {
    let run = start()
    run = applyStepOutcome(run, { gearGainedIds: ['axe', 'boots'], traitsGainedIds: ['brave'] }, NOW)
    while (run.phase.kind === 'step') run = applyStepOutcome(run, {}, NOW)
    run = endRound(run, { gearId: 'boots', traitId: 'brave' }, catalog, NOW)
    expect(run.loadout).toEqual({
      keptGearId: 'boots',
      keptTraitId: 'brave',
      roundGearIds: [],
      roundTraitIds: [],
    })
    expect(profileOf(run, catalog).stats.agility).toBe(1)
  })

  it('is replayable: the same seed and the same inputs give the same run', () => {
    const play = () => {
      let run = start()
      run = applyStepOutcome(run, { goldUnits: 2 }, NOW)
      while (run.phase.kind === 'step') run = applyStepOutcome(run, {}, NOW)
      return endRound(run, {}, catalog, NOW)
    }
    expect(play()).toEqual(play())
  })
})
