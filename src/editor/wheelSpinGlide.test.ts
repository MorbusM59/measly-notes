import { describe, expect, it } from 'vitest'
import { advanceWheelSpinGlide, createWheelSpinGlide } from './wheelSpinGlide'

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

