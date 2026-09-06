import { describe, expect, it } from 'vitest'

import {
  remainingWheelNotchTravelPx,
  retargetWheelNotchTravel,
  takeWheelNotchTravelStep,
  WHEEL_NOTCH_TRAVEL_MS,
  type WheelNotchTravel,
} from './wheelNotchTravel'

const NOTCH_PX = 76.8

/** Runs a leg to a moment, returning what it paid and how fast it was going. */
function playTo(travel: WheelNotchTravel, startMs: number, untilMs: number, stepMs = 4) {
  let paidPx = 0
  let lastPaidPx = 0
  let lastSpeedPxPerMs = 0
  for (let tMs = startMs + stepMs; tMs < untilMs + stepMs; tMs += stepMs) {
    const step = takeWheelNotchTravelStep(travel, Math.min(tMs, untilMs))
    paidPx += step.pixels
    lastSpeedPxPerMs = (paidPx - lastPaidPx) / stepMs
    lastPaidPx = paidPx
  }
  return { paidPx, lastSpeedPxPerMs }
}

describe('wheelNotchTravel', () => {
  it('delivers a notch over time instead of at once', () => {
    const travel = retargetWheelNotchTravel(null, NOTCH_PX, 0)
    const firstFrame = takeWheelNotchTravelStep(travel, 16)
    expect(firstFrame.pixels).toBeGreaterThan(0)
    expect(firstFrame.pixels).toBeLessThan(NOTCH_PX * 0.25)
    expect(firstFrame.finished).toBe(false)
  })

  it('eases from rest on the first notch', () => {
    const travel = retargetWheelNotchTravel(null, NOTCH_PX, 0)
    const opening = takeWheelNotchTravelStep(travel, 1).pixels
    expect(opening).toBeLessThan(0.5)
  })

  it('pays out exactly one notch, and no more', () => {
    const travel = retargetWheelNotchTravel(null, NOTCH_PX, 0)
    const { paidPx } = playTo(travel, 0, WHEEL_NOTCH_TRAVEL_MS + 40)
    expect(paidPx).toBeCloseTo(NOTCH_PX, 6)
    expect(takeWheelNotchTravelStep(travel, WHEEL_NOTCH_TRAVEL_MS + 40).finished).toBe(true)
  })

  it('carries the unpaid remainder into the next notch', () => {
    const first = retargetWheelNotchTravel(null, NOTCH_PX, 0)
    const { paidPx } = playTo(first, 0, 30)
    const remaining = remainingWheelNotchTravelPx(first, 30)
    expect(paidPx + remaining).toBeCloseTo(NOTCH_PX, 4)

    const second = retargetWheelNotchTravel(first, NOTCH_PX, 30)
    expect(second.plan.signedDistance).toBeCloseTo(remaining + NOTCH_PX, 6)
  })

  it('splices without a velocity step when a second notch lands mid-flight', () => {
    // The defect this replaces would be a restart from rest: speed dropping
    // to zero at the exact moment the reader asked for more of it.
    const first = retargetWheelNotchTravel(null, NOTCH_PX, 0)
    const { lastSpeedPxPerMs: before } = playTo(first, 0, 40, 1)
    expect(before).toBeGreaterThan(0)

    const second = retargetWheelNotchTravel(first, NOTCH_PX, 40)
    const after = takeWheelNotchTravelStep(second, 41).pixels
    expect(Math.abs(after - before) / before).toBeLessThan(0.1)
  })

  it('keeps composing across a run of notches', () => {
    let travel = retargetWheelNotchTravel(null, NOTCH_PX, 0)
    let totalPaid = 0
    for (let n = 1; n < 5; n += 1) {
      const atMs = n * 20
      totalPaid += playTo(travel, (n - 1) * 20, atMs).paidPx
      travel = retargetWheelNotchTravel(travel, NOTCH_PX, atMs)
    }
    totalPaid += playTo(travel, 80, 80 + WHEEL_NOTCH_TRAVEL_MS + 40).paidPx
    // Five notches asked for, five notches delivered -- nothing dropped by
    // the splicing.
    expect(totalPaid).toBeCloseTo(NOTCH_PX * 5, 4)
  })

  it('never scrolls backwards within a leg', () => {
    // A quintic asked to land a short distance while already moving fast
    // will overshoot and come back; the reader must not see that.
    const fast = retargetWheelNotchTravel(null, NOTCH_PX * 4, 0)
    playTo(fast, 0, 60, 1)
    const tiny = retargetWheelNotchTravel(fast, 1, 60)
    for (let tMs = 61; tMs <= 60 + WHEEL_NOTCH_TRAVEL_MS; tMs += 1) {
      expect(takeWheelNotchTravelStep(tiny, tMs).pixels).toBeGreaterThanOrEqual(0)
    }
  })

  it('turns around when the reader reverses the wheel', () => {
    const down = retargetWheelNotchTravel(null, NOTCH_PX, 0)
    playTo(down, 0, 30)
    const up = retargetWheelNotchTravel(down, -NOTCH_PX * 2, 30)
    expect(up.sign).toBe(-1)
    const { paidPx } = playTo(up, 30, 30 + WHEEL_NOTCH_TRAVEL_MS + 40)
    expect(paidPx).toBeLessThan(0)
  })

  it('owes the same total however coarsely it is sampled', () => {
    const fine = retargetWheelNotchTravel(null, NOTCH_PX, 0)
    const coarse = retargetWheelNotchTravel(null, NOTCH_PX, 0)
    const finePaid = playTo(fine, 0, 60, 2).paidPx
    const coarsePaid = playTo(coarse, 0, 60, 30).paidPx
    expect(coarsePaid).toBeCloseTo(finePaid, 4)
  })
})
