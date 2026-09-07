import { describe, expect, it } from 'vitest'
import { judgeResume, sanitizeAdventureSession } from './session'
import { createSession } from './engine'
import { THE_LONG_MARGIN } from './content/theLongMargin'
import { ADVENTURE_SESSION_VERSION, type AdventureSession } from './types'

const NOW = 1_700_000_000_000

function savedRun(): AdventureSession {
  return createSession(THE_LONG_MARGIN, { seed: 7, nowMs: NOW })
}

/** What actually crosses the bridge: a session that has been through JSON. */
function roundTrip(session: unknown): unknown {
  return JSON.parse(JSON.stringify(session))
}

describe('sanitizeAdventureSession', () => {
  it('round-trips a real run through JSON unchanged', () => {
    const session = savedRun()
    expect(sanitizeAdventureSession(roundTrip(session))).toEqual(session)
  })

  it('rejects anything that is not a session', () => {
    for (const input of [undefined, null, 0, 'run', [], {}]) {
      expect(sanitizeAdventureSession(input)).toBeNull()
    }
  })

  it('rejects a save from a different session format', () => {
    expect(sanitizeAdventureSession({ ...roundTrip(savedRun()) as object, version: ADVENTURE_SESSION_VERSION + 1 })).toBeNull()
  })

  it('rejects a run missing the fields that identify where it is', () => {
    const base = roundTrip(savedRun()) as Record<string, unknown>
    expect(sanitizeAdventureSession({ ...base, sceneId: 42 })).toBeNull()
    expect(sanitizeAdventureSession({ ...base, adventureId: '' })).toBeNull()
    expect(sanitizeAdventureSession({ ...base, status: 'paused' })).toBeNull()
    expect(sanitizeAdventureSession({ ...base, rngState: 'lots' })).toBeNull()
  })

  it('drops junk inside otherwise-valid collections rather than failing the whole run', () => {
    const base = roundTrip(savedRun()) as Record<string, unknown>
    const sanitized = sanitizeAdventureSession({
      ...base,
      stats: { lantern: 3, resolve: 'many', insight: 1 },
      flags: ['carries-the-page', 7],
      history: [{ sceneId: 'a', choiceId: 'b', resultSceneId: 'c' }, { sceneId: 'a' }],
    })
    expect(sanitized?.stats).toEqual({ lantern: 3, insight: 1 })
    expect(sanitized?.flags).toEqual(['carries-the-page'])
    expect(sanitized?.history).toEqual([{ sceneId: 'a', choiceId: 'b', resultSceneId: 'c' }])
  })
})

describe('judgeResume', () => {
  it('says nothing at all when there is no saved run', () => {
    expect(judgeResume(null, THE_LONG_MARGIN)).toBeNull()
  })

  it('resumes a run that is still in the story it started in', () => {
    expect(judgeResume(savedRun(), THE_LONG_MARGIN)).toEqual({ kind: 'resumable' })
  })

  it('reports a finished run as finished rather than resumable', () => {
    expect(judgeResume({ ...savedRun(), status: 'ended', endingId: 'surfaced' }, THE_LONG_MARGIN)).toEqual({ kind: 'finished' })
  })

  it('refuses to resume a run whose story has moved underneath it', () => {
    expect(judgeResume({ ...savedRun(), contentVersion: 0 }, THE_LONG_MARGIN)).toEqual({ kind: 'stale', reason: 'content-moved' })
    expect(judgeResume({ ...savedRun(), sceneId: 'a-scene-that-was-removed' }, THE_LONG_MARGIN)).toEqual({
      kind: 'stale',
      reason: 'unknown-scene',
    })
    expect(judgeResume({ ...savedRun(), adventureId: 'some-other-story' }, THE_LONG_MARGIN)).toEqual({
      kind: 'stale',
      reason: 'unknown-adventure',
    })
    expect(judgeResume(savedRun(), null)).toEqual({ kind: 'stale', reason: 'unknown-adventure' })
  })
})
