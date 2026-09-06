import { describe, expect, it } from 'vitest'
import {
  createWheelNotchState,
  stepWheelNotch,
  WHEEL_GESTURE_IDLE_MS,
  WHEEL_NOTCH_DEFAULT_PX,
  resolveWheelEventUnits,
} from './wheelNotch'

/** A gesture: evenly spaced events, well inside the idle window. */
const gesture = (deltas: number[], startMs = 1000) => {
  const state = createWheelNotchState()
  const units = deltas.map((delta, i) => stepWheelNotch(state, delta, startMs + i * 40))
  return { state, units }
}

describe('stepWheelNotch', () => {
  it('moves one row per notch on a device that sends 50px notches', () => {
    // The reported bug: with a hardcoded 100px unit these alternated 0, 1.
    expect(gesture([-50, -50, -50, -50]).units).toEqual([-1, -1, -1, -1])
    expect(gesture([50, 50, 50, 50]).units).toEqual([1, 1, 1, 1])
  })

  it('still moves one row per notch on the 100px default', () => {
    expect(gesture([100, 100, 100]).units).toEqual([1, 1, 1])
  })

  it('is symmetric between directions', () => {
    const down = gesture([120, 120, 120, 120, 120]).units
    const up = gesture([-120, -120, -120, -120, -120]).units
    expect(up).toEqual(down.map((u) => -u))
  })

  it('never learns a notch from trackpad-sized deltas', () => {
    const { state } = gesture([4, 4, 4, 4])
    expect(state.notchPx).toBe(WHEEL_NOTCH_DEFAULT_PX)
  })

  it('accumulates trackpad deltas into whole rows', () => {
    expect(gesture(Array(30).fill(4)).units.reduce((a, b) => a + b, 0)).toBe(1)
  })

  it('spends no leftover remainder on a later, separate gesture', () => {
    const state = createWheelNotchState()
    stepWheelNotch(state, 4, 1000)
    stepWheelNotch(state, 4, 1040)
    expect(state.pendingPx).toBe(8)
    expect(stepWheelNotch(state, 100, 1040 + WHEEL_GESTURE_IDLE_MS + 1)).toBe(1)
    expect(state.pendingPx).toBe(0)
  })

  it('keeps the learned notch across a pause, so an isolated notch still moves', () => {
    // The regression a per-gesture reset would reintroduce: on a 50px device
    // every deliberate single notch would be measured against 100 and die.
    const state = createWheelNotchState()
    expect(stepWheelNotch(state, -50, 1000)).toBe(-1)
    expect(stepWheelNotch(state, -50, 1000 + WHEEL_GESTURE_IDLE_MS * 4)).toBe(-1)
    expect(state.notchPx).toBe(50)
    expect(WHEEL_NOTCH_DEFAULT_PX).toBe(100)
  })

  it('gives a reversal a full first notch, not a discounted one', () => {
    const state = createWheelNotchState()
    stepWheelNotch(state, 60, 1000) // learns 60, leaves 60 pending
    expect(stepWheelNotch(state, -60, 1040)).toBe(-1)
  })

  it('turns a fast multi-notch event into that many rows', () => {
    expect(gesture([50, 150]).units).toEqual([1, 3])
  })
})

describe('resolveWheelEventUnits', () => {
  it('takes line and page mode at their word', () => {
    const state = createWheelNotchState()
    expect(resolveWheelEventUnits({ deltaY: 3, deltaMode: 1 }, state, 0)).toBe(3)
    expect(resolveWheelEventUnits({ deltaY: -1, deltaMode: 2 }, state, 0)).toBe(-1)
    // A fractional line delta is still at least one notch: a device that
    // reports 0.4 lines has still been turned.
    expect(resolveWheelEventUnits({ deltaY: -0.4, deltaMode: 1 }, state, 0)).toBe(-1)
    // ...and it teaches the pixel-mode accumulator nothing.
    expect(state.notchPx).toBe(WHEEL_NOTCH_DEFAULT_PX)
  })

  it('sends pixel mode through the accumulator, sub-notch deltas included', () => {
    const state = createWheelNotchState()
    expect(resolveWheelEventUnits({ deltaY: 4, deltaMode: 0 }, state, 0)).toBe(0)
    expect(resolveWheelEventUnits({ deltaY: 120, deltaMode: 0 }, state, 10)).toBe(1)
  })

  it('declines an event that carries no movement at all', () => {
    const state = createWheelNotchState()
    expect(resolveWheelEventUnits({ deltaY: 0, deltaMode: 0 }, state, 0)).toBe(0)
    expect(resolveWheelEventUnits({ deltaY: Number.NaN, deltaMode: 1 }, state, 0)).toBe(0)
  })
})
