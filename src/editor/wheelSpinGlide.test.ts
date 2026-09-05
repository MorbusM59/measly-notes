import { describe, expect, it } from 'vitest'
import {
  advanceWheelSpinGlide,
  createWheelSpinGlide,
  resolveWheelSpinNudgePixels,
  WHEEL_SPIN_NUDGE_MIN_PX,
} from './wheelSpinGlide'
import { WHEEL_NOTCH_MIN_PX } from './wheelNotch'

/** A segment source that hands out a fixed list, then ends the coast. */
function segmentsOf(durations: number[]): { next: () => number | null; calls: () => number } {
  let index = 0
  return {
    next: () => (index < durations.length ? durations[index++] : null),
    calls: () => index,
  }
}

describe('wheelSpinGlide', () => {
  it('pays out exactly one nudge over one segment', () => {
    const glide = createWheelSpinGlide(1, 100)
    const source = segmentsOf([20, 20])
    let total = 0
    for (let i = 0; i < 4; i += 1) {
      total += advanceWheelSpinGlide(glide, 5, source.next).pixels
    }
    expect(total).toBeCloseTo(100, 6)
    expect(source.calls()).toBe(1)
  })

  it('keeps the direction sign', () => {
    const glide = createWheelSpinGlide(-1, 40)
    const source = segmentsOf([10])
    expect(advanceWheelSpinGlide(glide, 10, source.next).pixels).toBeCloseTo(-40, 6)
  })

  it('crosses several segments in one late frame without dropping distance', () => {
    const glide = createWheelSpinGlide(1, 50)
    const source = segmentsOf([10, 10, 10, 10])
    const step = advanceWheelSpinGlide(glide, 35, source.next)
    // Three whole nudges plus half of the fourth.
    expect(step.pixels).toBeCloseTo(175, 6)
    expect(step.finished).toBe(false)
    expect(source.calls()).toBe(4)
  })

  it('finishes when the schedule runs out, paying what it owed first', () => {
    const glide = createWheelSpinGlide(1, 30)
    const source = segmentsOf([10])
    const step = advanceWheelSpinGlide(glide, 25, source.next)
    expect(step.pixels).toBeCloseTo(30, 6)
    expect(step.finished).toBe(true)
  })

  it('delivers the same total distance as the stepped schedule, at every boundary', () => {
    const durations = [20, 24, 30, 40]
    const glide = createWheelSpinGlide(1, 12)
    const source = segmentsOf([...durations])
    let travelled = 0
    let boundaries = 0
    // One millisecond at a time, so a boundary is checked the moment it is
    // reached rather than a frame later.
    for (let ms = 1; ms <= 114; ms += 1) {
      travelled += advanceWheelSpinGlide(glide, 1, source.next).pixels
      let elapsed = 0
      let nudges = 0
      for (const duration of durations) {
        elapsed += duration
        if (elapsed <= ms) nudges += 1
      }
      if (elapsed <= ms) continue
      boundaries += 1
      expect(travelled).toBeGreaterThanOrEqual(nudges * 12 - 1e-6)
      expect(travelled).toBeLessThanOrEqual((nudges + 1) * 12 + 1e-6)
    }
    expect(boundaries).toBeGreaterThan(0)
  })

  it('ignores a non-positive or non-finite frame', () => {
    const glide = createWheelSpinGlide(1, 10)
    const source = segmentsOf([10])
    expect(advanceWheelSpinGlide(glide, 0, source.next).pixels).toBe(0)
    expect(advanceWheelSpinGlide(glide, Number.NaN, source.next).pixels).toBe(0)
    expect(source.calls()).toBe(0)
  })
})

describe('resolveWheelSpinNudgePixels', () => {
  const base = { deltaMode: 0, units: 1, notchPx: 100, lineHeightPx: 24, pageHeightPx: 700 }

  it('takes the event\'s own delta, not the learned notch size', () => {
    // The case this exists for: a 120px device whose accumulator still reads
    // 100. Continuing at 100 would visibly slow down at the handoff.
    expect(resolveWheelSpinNudgePixels({ ...base, deltaY: 120 })).toBe(120)
  })

  it('is 0 until the accumulator says a nudge has been made', () => {
    expect(resolveWheelSpinNudgePixels({ ...base, deltaY: 6, units: 0 })).toBe(0)
  })

  it('falls back to the learned notch for a nudge assembled from sub-notch events', () => {
    expect(resolveWheelSpinNudgePixels({ ...base, deltaY: 8, units: 1 })).toBe(100)
  })

  it('reads line and page mode in their own units', () => {
    expect(resolveWheelSpinNudgePixels({ ...base, deltaY: -3, deltaMode: 1 })).toBe(72)
    expect(resolveWheelSpinNudgePixels({ ...base, deltaY: 1, deltaMode: 2 })).toBe(700)
  })

  it('agrees with the notch module about what a notch minimally is', () => {
    expect(WHEEL_SPIN_NUDGE_MIN_PX).toBe(WHEEL_NOTCH_MIN_PX)
  })
})
