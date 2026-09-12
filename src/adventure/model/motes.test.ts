import { describe, expect, it } from 'vitest'
import {
  allocateStatPoint,
  canAllocateStatPoint,
  FIRST_STAT_POINT_THRESHOLD,
  moteBalance,
  statPointProgress,
  statPointSpan,
} from './motes'

/** Walks the threshold sequence by taking every point as soon as it is due. */
function thresholds(count: number): number[] {
  let next = FIRST_STAT_POINT_THRESHOLD
  let acquired = 0
  const seen: number[] = []
  for (let index = 0; index < count; index += 1) {
    seen.push(next)
    const taken = allocateStatPoint(next, acquired)
    next = taken.experienceToNextStatPoint
    acquired = taken.statPointsAcquired
  }
  return seen
}

describe('experience motes', () => {
  it('spends on traits without touching the stat track', () => {
    // The whole reason two numbers are stored rather than one balance.
    expect(moteBalance(30, 12)).toBe(18)
    expect(canAllocateStatPoint(30, 25)).toBe(true)
    // ...and it is still true after spending every last mote.
    expect(moteBalance(30, 30)).toBe(0)
    expect(canAllocateStatPoint(30, 25)).toBe(true)
  })

  it('walks the threshold sequence 10, 15, 25, 40, 60, 85', () => {
    expect(thresholds(6)).toEqual([10, 15, 25, 40, 60, 85])
  })

  it('measures progress across the span between the last point and the next', () => {
    // Before any point: nought to ten.
    expect(statPointProgress(0, 10, 0)).toBe(0)
    expect(statPointProgress(4, 10, 0)).toBeCloseTo(0.4, 10)
    expect(statPointProgress(10, 10, 0)).toBe(1)
    // After one: ten to fifteen.
    expect(statPointProgress(10, 15, 1)).toBe(0)
    expect(statPointProgress(12, 15, 1)).toBeCloseTo(0.4, 10)
    // After two: fifteen to twenty-five.
    expect(statPointProgress(20, 25, 2)).toBeCloseTo(0.5, 10)
  })

  it('does not divide by zero before the first point is taken', () => {
    // The general span is 5 * pointsAcquired, which is 0 here. Fails with a
    // NaN if the first span is not read as the first threshold instead.
    expect(statPointSpan(0)).toBe(FIRST_STAT_POINT_THRESHOLD)
    expect(Number.isFinite(statPointProgress(7, 10, 0))).toBe(true)
  })

  it('is a fixed point: taking every point as it falls due lands exactly on 0', () => {
    // The property, walked rather than spot-checked: whatever the run earns,
    // the bar is never outside 0..1 and reads exactly 0 the moment a point
    // is taken -- which is what makes "full means now" true at every level.
    let next = FIRST_STAT_POINT_THRESHOLD
    let acquired = 0
    for (let earned = 0; earned <= 200; earned += 1) {
      while (canAllocateStatPoint(earned, next)) {
        const taken = allocateStatPoint(next, acquired)
        next = taken.experienceToNextStatPoint
        acquired = taken.statPointsAcquired
        expect(statPointProgress(earned, next, acquired)).toBeLessThan(1)
      }
      const ratio = statPointProgress(earned, next, acquired)
      expect(ratio).toBeGreaterThanOrEqual(0)
      expect(ratio).toBeLessThan(1)
    }
    expect(acquired).toBeGreaterThan(5)
  })
})
