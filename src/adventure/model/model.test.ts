import { describe, expect, it } from 'vitest'
import { absorb, applyAcquisition, armorFromHoldings, NO_ARMOR, totalArmor } from './armor'
import { describeEffect, resolveProfile, type Modifier } from './modifiers'
import { createStatBlock } from './stats'
import { resolveCheck, tierForMargin } from './checks'

const noHoldings = { items: 0, traits: 0 }

describe('stat resolution', () => {
  it('caps BASE stats at six but lets modifiers carry past it', () => {
    const base = { ...createStatBlock(0), perception: 9 }
    const spyglass: Modifier = {
      id: 'spyglass',
      kind: 'item',
      name: 'Spyglass',
      icon: '',
      effects: [{ kind: 'statDelta', stat: 'perception', amount: 2 }],
    }
    // Six from the cap, then two from the item: the whole reason the cap is
    // applied in one documented place rather than wherever stats are read.
    expect(resolveProfile(base, [spyglass], noHoldings).stats.perception).toBe(8)
  })

  it('scales a derived value by what is held, recomputed rather than remembered', () => {
    const collector: Modifier = {
      id: 'avid-collector',
      kind: 'trait',
      name: 'Avid Collector',
      icon: '',
      effects: [{ kind: 'derivedScalePerHolding', derived: 'damageMultiplier', factorPer: 0.1, holding: 'item' }],
    }
    const base = createStatBlock(0)
    const none = resolveProfile(base, [collector], { items: 0, traits: 1 }).derived.damageMultiplier
    const three = resolveProfile(base, [collector], { items: 3, traits: 1 }).derived.damageMultiplier
    expect(three).toBeCloseTo(none * 1.3)
  })

  it('describes an effect with the number it currently has, not the one it was written with', () => {
    const line = describeEffect(
      { kind: 'derivedScalePerHolding', derived: 'damageMultiplier', factorPer: 0.1, holding: 'item' },
      { items: 3, traits: 0 },
    )
    // The tab bar shows this string. If it said only "+10% per item" the
    // player would have to do the arithmetic the game already did.
    expect(line).toContain('+10%')
    expect(line).toContain('3 held')
  })

  it('keeps counts whole and chances inside 0..1 after modifiers have had their say', () => {
    const absurd: Modifier = {
      id: 'absurd',
      kind: 'item',
      name: 'Absurd',
      icon: '',
      effects: [
        { kind: 'derivedDelta', derived: 'critChance', amount: 5 },
        { kind: 'derivedDelta', derived: 'encounterChoices', amount: 0.5 },
      ],
    }
    const derived = resolveProfile(createStatBlock(1), [absurd], noHoldings).derived
    expect(derived.critChance).toBe(1)
    expect(Number.isInteger(derived.encounterChoices)).toBe(true)
  })
})

describe('armor', () => {
  const plate: Modifier = {
    id: 'plate',
    kind: 'item',
    name: 'Plate',
    icon: '',
    effects: [{ kind: 'armorOnAcquire', amount: 3 }],
  }
  const hide: Modifier = {
    id: 'hide',
    kind: 'trait',
    name: 'Thick Hide',
    icon: '',
    effects: [{ kind: 'naturalArmor', amount: 2 }],
  }

  it('grants armor once per acquisition rather than as a standing bonus', () => {
    const once = applyAcquisition(NO_ARMOR, plate)
    expect(once.fromItems).toBe(3)
    // Carrying the same item into the next level counts as a fresh
    // acquisition, which is a REBUILD, not a second grant on top.
    expect(armorFromHoldings([plate, hide])).toEqual({ fromItems: 3, natural: 2 })
  })

  it('reduces damage by the whole shield, both pools together', () => {
    const result = absorb({ fromItems: 3, natural: 2 }, 8, 0, 0, 1)
    expect(result.absorbed).toBe(5)
    expect(result.damage).toBe(3)
  })

  it('never decays when it did not actually stop anything', () => {
    // Luck 0 makes survival unlikely, so a decay here would be a real one.
    const untested = absorb({ fromItems: 3, natural: 0 }, 0, 0, 0, 11)
    expect(untested.decayed).toBe(false)
    expect(untested.armor.fromItems).toBe(3)
  })

  it('wears down only the pool that items granted, never natural armor', () => {
    let armor = { fromItems: 3, natural: 2 }
    let rng = 5
    for (let index = 0; index < 200; index += 1) {
      const result = absorb(armor, 4, 0, 0, rng)
      armor = result.armor
      rng = result.rng
    }
    expect(armor.fromItems).toBe(0)
    expect(armor.natural).toBe(2)
    expect(totalArmor(armor)).toBe(2)
  })

  it('stops decaying at the floor a trait sets', () => {
    let armor = { fromItems: 4, natural: 0 }
    let rng = 5
    for (let index = 0; index < 200; index += 1) {
      const result = absorb(armor, 4, 0, 2, rng)
      armor = result.armor
      rng = result.rng
    }
    expect(armor.fromItems).toBe(2)
  })
})

describe('stat checks', () => {
  it('treats the die as the opposition: the stat must match or beat roll + rating', () => {
    // A stat of 6 against DR 0 cannot fail, because the die alone never
    // exceeds 6. The inverse convention would make this a coin flip.
    let rng = 1
    for (let index = 0; index < 200; index += 1) {
      const result = resolveCheck(6, 0, rng)
      rng = result.rng
      expect(result.passed).toBe(true)
    }
  })

  it('cannot be passed at all at a rating of six', () => {
    let rng = 1
    for (let index = 0; index < 200; index += 1) {
      const result = resolveCheck(6, 6, rng)
      rng = result.rng
      expect(result.passed).toBe(false)
    }
  })

  it('reports how well it went, for content that reads in degrees', () => {
    expect(tierForMargin(-1)).toBe('failed')
    expect(tierForMargin(0)).toBe('marginal')
    expect(tierForMargin(2)).toBe('solid')
    expect(tierForMargin(5)).toBe('complete')
  })
})
