import { describe, expect, it } from 'vitest'
import { resolveSeekTarget, SEEK_TAIL_GUARD_SEC } from './MusicPlayerService'

const DURATION = 200
const END = DURATION - SEEK_TAIL_GUARD_SEC

describe('seek targeting', () => {
  it('lands where asked when the move fits inside the track', () => {
    const { timeSec, overshootSec } = resolveSeekTarget(50, DURATION, 0.2)
    expect(timeSec).toBe(90)
    expect(overshootSec).toBe(0)
  })

  it('rewinds inside the track without reporting an overshoot', () => {
    const { timeSec, overshootSec } = resolveSeekTarget(50, DURATION, -0.2)
    expect(timeSec).toBe(10)
    expect(overshootSec).toBe(0)
  })

  it('stops short of the true end so it cannot fire `ended` itself', () => {
    // Two code paths would otherwise handle the same crossing: this one, and
    // the ended handler that auto-advances.
    const { timeSec } = resolveSeekTarget(DURATION - 1, DURATION, 0.2)
    expect(timeSec).toBe(END)
    expect(timeSec).toBeLessThan(DURATION)
  })

  // The overshoot is how far INTO the next song the scrub should continue --
  // it is the seek that was asked for minus the part the track could absorb.
  it('reports how far past the end the seek ran', () => {
    const { overshootSec } = resolveSeekTarget(DURATION - 1, DURATION, 0.2)
    expect(overshootSec).toBeCloseTo((DURATION - 1 + 40) - END, 10)
  })

  // Negative, and its magnitude is how far before the END of the previous song
  // to land -- the sign is what tells the two crossings apart.
  it('reports how far before the start the seek ran, as a negative', () => {
    const { timeSec, overshootSec } = resolveSeekTarget(10, DURATION, -0.2)
    expect(timeSec).toBe(0)
    expect(overshootSec).toBe(-30)
  })

  it('treats a seek that lands exactly on a boundary as no crossing', () => {
    expect(resolveSeekTarget(30, DURATION, -0.15).overshootSec).toBe(0)
    expect(resolveSeekTarget(30, DURATION, -0.15).timeSec).toBe(0)
  })

  // A held scrub is repeated 5% steps; from a standstill at either end every
  // one of them has to keep crossing, not stall once the playhead is pinned.
  it('keeps reporting a crossing on every step once pinned at an end', () => {
    expect(resolveSeekTarget(0, DURATION, -0.05).overshootSec).toBe(-10)
    expect(resolveSeekTarget(END, DURATION, 0.05).overshootSec).toBeCloseTo(10, 10)
  })
})
