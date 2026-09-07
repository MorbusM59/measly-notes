// Rolling the choices a player is offered.
//
// Used for the start-of-round spend (one offer per unit of experience or
// gold) and available to anything else that has to pick a few distinct
// things out of a weighted pool. Distinct is the operative word: an offer
// of three cells showing the same charm is not a choice.

import { nextRandom } from '../rng'
import type { Modifier } from './modifiers'

/**
 * `count` distinct entries drawn by weight, without replacement. Returns
 * fewer than asked for only when the pool is smaller than the ask, which is
 * a content shortage rather than an error -- the ring simply shows what
 * exists.
 */
export function rollOffers(
  pool: readonly Modifier[],
  count: number,
  rngState: number,
): { offers: Modifier[]; rngState: number } {
  const remaining = [...pool]
  const offers: Modifier[] = []
  let state = rngState

  while (offers.length < count && remaining.length > 0) {
    const total = remaining.reduce((sum, modifier) => sum + (modifier.weight ?? 1), 0)
    const draw = nextRandom(state)
    state = draw.state
    let cursor = draw.value * total
    let index = remaining.length - 1
    for (let candidate = 0; candidate < remaining.length; candidate += 1) {
      cursor -= remaining[candidate].weight ?? 1
      if (cursor < 0) {
        index = candidate
        break
      }
    }
    offers.push(remaining[index])
    remaining.splice(index, 1)
  }

  return { offers, rngState: state }
}
