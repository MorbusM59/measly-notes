import { describe, expect, it } from 'vitest'
import {
  cursorTwitchDurationSec,
  cursorTwitchRadiusMultiplier,
  resolveCursorClickDurationSec,
} from './CursorClickCurve'
import {
  CURSOR_CLICK_RAMP_DEFAULT,
  CURSOR_CLICK_SKEW_DEFAULT,
  CURSOR_CLICK_SPEED_X_DEFAULT,
  CURSOR_CLICK_MAX_SPEED_DEFAULT,
} from '../shared/cursorSettings'
import { cursorClickApexTimeSec } from './CursorClickCurve'

const RAMP = CURSOR_CLICK_RAMP_DEFAULT
const SKEW = CURSOR_CLICK_SKEW_DEFAULT
const DURATION = cursorTwitchDurationSec(resolveCursorClickDurationSec(CURSOR_CLICK_SPEED_X_DEFAULT))

function sample(direction: -1 | 1, elapsedSec: number, maxImpact = CURSOR_CLICK_MAX_SPEED_DEFAULT): number {
  return cursorTwitchRadiusMultiplier(direction, elapsedSec, RAMP, SKEW, DURATION, maxImpact)
}

describe('the confirmation twitch', () => {
  it('is half as long as the click response it borrows its shape from', () => {
    for (const speedX of [0, 0.25, 0.6, 0.9, 1]) {
      const clickDurationSec = resolveCursorClickDurationSec(speedX)
      expect(cursorTwitchDurationSec(clickDurationSec)).toBeCloseTo(clickDurationSec / 2, 10)
    }
  })

  it('reaches exactly the held radius times (1 + max impact), or divided by it', () => {
    // The property the whole thing exists for: the excursion is measured
    // from wherever the hold left the orbit, and the two polarities are
    // exact reciprocals rather than merely similar-looking.
    const apexSec = cursorClickApexTimeSec(SKEW, DURATION)
    for (const maxImpact of [0.05, 0.35, 0.7, 1]) {
      expect(sample(1, apexSec, maxImpact)).toBeCloseTo(1 + maxImpact, 10)
      expect(sample(-1, apexSec, maxImpact)).toBeCloseTo(1 / (1 + maxImpact), 10)
      expect(sample(1, apexSec, maxImpact) * sample(-1, apexSec, maxImpact)).toBeCloseTo(1, 10)
    }
  })

  it('starts and finishes at exactly the held radius, so nothing has to put it back', () => {
    // Both ends are exactly 1 -- the press axis keeps sustaining underneath,
    // so a twitch that ends at a factor of 1 has already restored the held
    // state. Exactly, not nearly: the underlying bell stands at ~0.098 of its
    // peak at both ends, and discarding the twitch with 3.6% of radius still
    // standing pops. Fails without twitchHeight's floor subtraction.
    for (const direction of [-1, 1] as const) {
      expect(sample(direction, 0)).toBeCloseTo(1, 10)
      expect(sample(direction, DURATION)).toBeCloseTo(1, 10)
    }
  })

  it('never overshoots its apex anywhere in between', () => {
    const apex = sample(1, cursorClickApexTimeSec(SKEW, DURATION))
    for (let t = 0; t <= DURATION; t += DURATION / 200) {
      const expanding = sample(1, t)
      expect(expanding).toBeGreaterThanOrEqual(1 - 1e-9)
      expect(expanding).toBeLessThanOrEqual(apex + 1e-9)
      // The mirror holds at every sample, not only at the apex.
      expect(expanding * sample(-1, t)).toBeCloseTo(1, 10)
    }
  })

  it('does nothing at all when max impact is zero', () => {
    for (let t = 0; t <= DURATION; t += DURATION / 20) {
      expect(sample(1, t, 0)).toBeCloseTo(1, 10)
      expect(sample(-1, t, 0)).toBeCloseTo(1, 10)
    }
  })
})
