import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import type { MusicSongEntry, PlaylistSlot, PlaylistCountsResult } from '../shared/audioPlayer'
import {
  emptyPlaylistCounts,
  getNextActiveSlotsForToggle,
  PLAYLIST_SLOTS,
  PLAYLIST_SLOT_ICONS,
  PLAYLIST_SLOT_THEMES,
  shouldStopCurrentSongOnSlotToggle,
} from '../shared/audioPlayer'
import {
  nudgeLevel,
  reverbIcon,
  roomIcon,
  SOUND_LEVEL_MAX_DISPLAY,
  toDisplayLevel,
  volumeIcon,
} from '../shared/musicSoundOptions'
import { useNonPassiveWheel } from '../shared/useNonPassiveWheel'
import { musicPlayerService, MissingFileError } from '../sound/MusicPlayerService'

// Duration (ms) a pointer must be held to trigger the "arm for clear" action.
const HOLD_THRESHOLD_MS = 700

// Fade-in duration (seconds) for playback resumed from the previous
// session (see the initialWasPlaying restore below) -- starts at silence
// and full reverb, ramping up to the persisted volume/reverb over this
// span, rather than jumping straight in at launch.
const RESTORE_PLAYBACK_FADE_IN_SEC = 10



/** Latest playback snapshot, kept fresh by AudioControls for the parent to read on save. */
export interface MusicPlaybackSnapshot {
  songId: number | null
  positionSec: number
  wasPlaying: boolean
}

export interface AudioControlsProps {
  /**
   * 0–1 volume for the music player. This is the LEVEL, not the audibility:
   * it keeps its value while muted (see `isMuted`) so unmuting restores it
   * without a separately remembered copy.
   */
  volume: number
  onVolumeChange: (value: number) => void
  /** Whether volume is currently silenced. The level above is left intact. */
  isMuted: boolean
  onMutedChange: (value: boolean) => void
  /** 0–1 reverb wet mix. Like `volume`, retained while bypassed. */
  reverbAmount: number
  onReverbAmountChange: (value: number) => void
  /** 0–1 reverb room size. */
  reverbRoom: number
  onReverbRoomChange: (value: number) => void
  /**
   * Whether reverb is bypassed. One switch behind two buttons: both the
   * reverb button and the room button toggle it and both show `fa-ban` while
   * it is on, because room size is meaningless with no wet signal.
   */
  isReverbBypassed: boolean
  onReverbBypassedChange: (value: boolean) => void
  /** Which playlist slots are currently toggled active. */
  activeSlots: PlaylistSlot[]
  onActiveSlotsChange: (slots: PlaylistSlot[]) => void
  /**
   * Whether the bottom row is showing the sound options instead of the
   * playlist buckets. Owned by the parent so it survives a restart.
   */
  isSoundOptionsOpen: boolean
  onSoundOptionsOpenChange: (value: boolean) => void
  /** DB id of the song that was last active in the previous session, if any. */
  initialSongId?: number | null
  /** Playback position (seconds) to resume the initial song at. */
  initialPositionSec?: number
  /** Whether the initial song was playing when the previous session ended. */
  initialWasPlaying?: boolean
  /**
   * Ref kept up to date with the current song id / position / playing state so
   * the parent can read a fresh snapshot whenever it persists app state,
   * without triggering a re-render on every position tick.
   */
  playbackStateRef?: React.MutableRefObject<MusicPlaybackSnapshot>
}

export const AudioControls = memo(function AudioControls({
  volume,
  onVolumeChange,
  isMuted,
  onMutedChange,
  reverbAmount,
  onReverbAmountChange,
  reverbRoom,
  onReverbRoomChange,
  isReverbBypassed,
  onReverbBypassedChange,
  activeSlots,
  onActiveSlotsChange,
  isSoundOptionsOpen,
  onSoundOptionsOpenChange,
  initialSongId,
  initialPositionSec,
  initialWasPlaying,
  playbackStateRef,
}: AudioControlsProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentSong, setCurrentSong] = useState<MusicSongEntry | null>(null)
  const [counts, setCounts] = useState<PlaylistCountsResult>(emptyPlaylistCounts)
  // Slot button that is currently "primed" for clearing (held right-click)
  const [primedSlot, setPrimedSlot] = useState<PlaylistSlot | null>(null)
  // Position to seek to once the restored song's first playback begins.
  const pendingSeekSecRef = useRef<number | null>(null)

  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seekIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isSeekScrubbing = useRef(false)
  const activeRef = useRef(activeSlots)
  activeRef.current = activeSlots

  const currentSongRef = useRef<MusicSongEntry | null>(null)

  const refreshCountsRef = useRef(async () => {
    const c = await window.thockdownAudioPlayer?.getPlaylistCounts()
    if (c) setCounts(c)
  })

  // Sync player config whenever props change. The mute/bypass flags are
  // resolved into the graph's numbers HERE and nowhere else: the service keeps
  // taking plain 0-1 config and knows nothing about toggles, so every one of
  // its own uses of config.volume (the scrub dim, the resume-from-pause gain
  // restore, the fade-in ramp) stays silent while muted without any of them
  // needing to learn about mute.
  const effectiveVolume = isMuted ? 0 : volume
  const effectiveReverbAmount = isReverbBypassed ? 0 : reverbAmount
  useEffect(() => {
    musicPlayerService.setConfig({
      volume: effectiveVolume,
      reverbAmount: effectiveReverbAmount,
      reverbRoom,
    })
  }, [effectiveVolume, effectiveReverbAmount, reverbRoom])

  // Refresh playlist counts on mount.
  useEffect(() => {
    void window.thockdownAudioPlayer?.getPlaylistCounts().then((c) => {
      if (c) setCounts(c)
    })
  }, [])

  // Keep currentSongRef in sync so the onEnded closure can read it without going stale.
  useEffect(() => {
    currentSongRef.current = currentSong
  }, [currentSong])

  // Register "song ended" → auto-advance.
  useEffect(() => {
    musicPlayerService.onEnded(() => {
      const finished = currentSongRef.current
      if (finished) {
        void window.thockdownAudioPlayer?.afterPlay(finished.id)
      }
      void advanceToNextSong()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------------------------------------------------------------- helpers

  const advanceToNextSong = useCallback(async (slotsOverride?: PlaylistSlot[]) => {
    const slots = slotsOverride ?? activeRef.current
    if (slots.length === 0) {
      setIsPlaying(false)
      setCurrentSong(null)
      return
    }

    // Safety limit: avoid an infinite loop if every song in the pool is missing.
    const MAX_ATTEMPTS = 50
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const next = await window.thockdownAudioPlayer?.pickNextSong(slots)
      if (!next) {
        setIsPlaying(false)
        setCurrentSong(null)
        return
      }
      try {
        setCurrentSong(next)
        await musicPlayerService.play(next.filePath)
        setIsPlaying(true)
        return
      } catch (err) {
        if (err instanceof MissingFileError) {
          // Silently purge the bad entry and try the next song.
          await window.thockdownAudioPlayer?.purgeSong(next.id)
          await refreshCountsRef.current()
          musicPlayerService.stop()
          continue
        }
        // Non-file-missing error (e.g. AbortError from rapid pause): surface it.
        throw err
      }
    }

    // Exhausted retries — give up.
    setIsPlaying(false)
    setCurrentSong(null)
  }, [])

  const refreshCounts = useCallback(async () => {
    await refreshCountsRef.current()
  }, [])

  // ---------------------------------------------------------------- restore last session

  // Restore the last-played song (paused, cued at its saved position) once the
  // parent finishes loading app state and supplies a real id. initialSongId
  // only ever transitions from null/undefined to a number once, so this runs
  // a single time per app launch.
  useEffect(() => {
    if (initialSongId == null) return
    let cancelled = false
    void (async () => {
      const song = await window.thockdownAudioPlayer?.getSongById(initialSongId)
      if (cancelled || !song) return
      pendingSeekSecRef.current = initialPositionSec ?? 0
      setCurrentSong(song)
      if (initialWasPlaying) {
        try {
          await musicPlayerService.play(song.filePath)
          musicPlayerService.beginFadeIn(RESTORE_PLAYBACK_FADE_IN_SEC)
          if (pendingSeekSecRef.current) musicPlayerService.setCurrentTime(pendingSeekSecRef.current)
          pendingSeekSecRef.current = null
          setIsPlaying(true)
        } catch {
          // Playback may be refused this early (no user gesture yet). Leave
          // the song cued up and paused rather than treating it as missing.
          musicPlayerService.stop()
        }
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSongId])

  // Keep the parent-owned snapshot fresh so it can be persisted at any time
  // (e.g. on the debounced app-state save, or on quit).
  useEffect(() => {
    if (!playbackStateRef) return
    playbackStateRef.current.songId = currentSong?.id ?? null
    playbackStateRef.current.wasPlaying = isPlaying
    playbackStateRef.current.positionSec = musicPlayerService.currentTime
  }, [playbackStateRef, currentSong, isPlaying])

  // While playing, periodically refresh the saved position. Position isn't
  // reactive state — polling avoids a re-render on every audio frame.
  useEffect(() => {
    if (!playbackStateRef || !isPlaying) return
    const id = setInterval(() => {
      playbackStateRef.current.positionSec = musicPlayerService.currentTime
    }, 3000)
    return () => clearInterval(id)
  }, [playbackStateRef, isPlaying])

  // ---------------------------------------------------------------- play / stop

  const handlePlayToggle = useCallback(async () => {
    if (isPlaying) {
      musicPlayerService.pause()
      setIsPlaying(false)
    } else {
      if (currentSong) {
        try {
          // Resume the current song.
          await musicPlayerService.play(currentSong.filePath)
          if (pendingSeekSecRef.current != null) {
            musicPlayerService.setCurrentTime(pendingSeekSecRef.current)
            pendingSeekSecRef.current = null
          }
          setIsPlaying(true)
        } catch (err) {
          if (err instanceof MissingFileError) {
            // File gone since last session — purge and pick a fresh song.
            await window.thockdownAudioPlayer?.purgeSong(currentSong.id)
            setCurrentSong(null)
            musicPlayerService.stop()
            await refreshCountsRef.current()
            await advanceToNextSong()
          } else {
            throw err
          }
        }
      } else {
        await advanceToNextSong()
      }
    }
  }, [isPlaying, currentSong, advanceToNextSong])

  // ---------------------------------------------------------------- favorability button

  const handleFavoriteLeft = useCallback(async () => {
    if (!currentSong) return
    const updated = await window.thockdownAudioPlayer?.favoriteSong(currentSong.id)
    if (updated) setCurrentSong(updated)
    // Priority set to 0 = replay immediately on next advance; do nothing more here.
  }, [currentSong])

  const handleSkipRight = useCallback(async (event: MouseEvent) => {
    event.preventDefault()
    if (!currentSong) return
    await window.thockdownAudioPlayer?.skipSong(currentSong.id)
    if (currentSong.id != null) {
      await window.thockdownAudioPlayer?.afterPlay(currentSong.id)
    }
    await musicPlayerService.fadeOut()
    await advanceToNextSong()
  }, [currentSong, advanceToNextSong])

  const handleFavoriteContextMenu = useCallback((event: MouseEvent) => {
    event.preventDefault()
    // Right-click = skip; check for held right-click is handled by pointer events below.
    void handleSkipRight(event)
  }, [handleSkipRight])

  // Held right-click on the favorability button = purge song.
  const favHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const favPrimedRef = useRef(false)

  const handleFavPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 2) return
    event.preventDefault()
    favPrimedRef.current = false
    favHoldTimerRef.current = setTimeout(() => {
      favPrimedRef.current = true
    }, HOLD_THRESHOLD_MS)
  }, [])

  const handleFavPointerUp = useCallback(async (event: React.PointerEvent) => {
    if (event.button !== 2) return
    if (favHoldTimerRef.current) {
      clearTimeout(favHoldTimerRef.current)
      favHoldTimerRef.current = null
    }
    if (favPrimedRef.current && currentSong) {
      favPrimedRef.current = false
      musicPlayerService.stop()
      setIsPlaying(false)
      await window.thockdownAudioPlayer?.purgeSong(currentSong.id)
      setCurrentSong(null)
      await refreshCounts()
      // Pick the next song.
      await advanceToNextSong()
    }
    // Normal right-click handled by contextmenu event.
  }, [currentSong, advanceToNextSong, refreshCounts])

  // ---------------------------------------------------------------- seek buttons
  // Two direction-fixed buttons, rewind and forward. Each one always seeks its
  // OWN way on either mouse button -- the older single button's "right-click
  // inverts" trick existed only because there was nowhere else to put rewind,
  // and keeping it once a rewind button exists would mean two controls for one
  // direction and a right-click that contradicts the glyph under the cursor.
  // Click: 20% of the track. Hold: 5% per 100 ms after a 200 ms delay.

  const SEEK_HOLD_DELAY_MS = 200
  const SEEK_INTERVAL_MS = 100
  const SEEK_HOLD_STEP = 0.05
  const SEEK_CLICK_STEP = 0.2

  /** +1 seeks forward, -1 rewinds. */
  type SeekDirection = 1 | -1

  const stopSeekScrub = useCallback(() => {
    if (seekTimerRef.current) {
      clearTimeout(seekTimerRef.current)
      seekTimerRef.current = null
    }
    if (seekIntervalRef.current) {
      clearInterval(seekIntervalRef.current)
      seekIntervalRef.current = null
    }
    if (isSeekScrubbing.current) {
      musicPlayerService.endScrub()
    }
    isSeekScrubbing.current = false
  }, [])

  const handleSeekPointerDown = useCallback((event: React.PointerEvent, direction: SeekDirection) => {
    if (event.button !== 0 && event.button !== 2) return
    event.preventDefault()
    seekTimerRef.current = setTimeout(() => {
      isSeekScrubbing.current = true
      musicPlayerService.beginScrub()
      musicPlayerService.seek(direction * SEEK_HOLD_STEP)
      seekIntervalRef.current = setInterval(() => {
        musicPlayerService.seek(direction * SEEK_HOLD_STEP)
      }, SEEK_INTERVAL_MS)
    }, SEEK_HOLD_DELAY_MS)
  }, [])

  const handleSeekPointerUp = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0 && event.button !== 2) return
    stopSeekScrub()
  }, [stopSeekScrub])

  const handleSeekActivate = useCallback((direction: SeekDirection) => {
    // A hold that already scrubbed swallows the click that ends it, so a
    // release after scrubbing does not tack an extra 20% on top.
    if (isSeekScrubbing.current) return
    musicPlayerService.seek(direction * SEEK_CLICK_STEP)
  }, [])

  const handleSeekContextMenu = useCallback((event: React.MouseEvent, direction: SeekDirection) => {
    event.preventDefault()
    handleSeekActivate(direction)
  }, [handleSeekActivate])

  // ---------------------------------------------------------------- playlist buttons

  const handleSlotLeftClick = useCallback(async (slot: PlaylistSlot) => {
    if (counts[slot] === 0) {
      // Empty playlist: open file picker.
      const files = await window.thockdownAudioPlayer?.pickFiles()
      if (files && files.length > 0) {
        await window.thockdownAudioPlayer?.addSongs(slot, files)
        await refreshCounts()
        // Auto-toggle the slot on after first add.
        if (!activeSlots.includes(slot)) {
          onActiveSlotsChange([...activeSlots, slot])
        }
      }
      return
    }
    // Toggle the slot in/out of the active pool.
    const next = getNextActiveSlotsForToggle(activeSlots, slot)
    const isDeactivating = activeSlots.includes(slot) && !next.includes(slot)

    onActiveSlotsChange(next)

    if (isDeactivating && shouldStopCurrentSongOnSlotToggle({
      currentSongSlot: currentSong?.playlistSlot,
      activeSlots,
      toggledSlot: slot,
    })) {
      musicPlayerService.stop()
      setIsPlaying(false)
      setCurrentSong(null)
      await advanceToNextSong(next)
    }
  }, [activeSlots, counts, currentSong, onActiveSlotsChange, advanceToNextSong, refreshCounts])

  const handleSlotRightClick = useCallback(async (event: MouseEvent, slot: PlaylistSlot) => {
    event.preventDefault()
    if (primedSlot === slot) return // Already primed — wait for pointer-up.
    // Normal right-click = add more files.
    const files = await window.thockdownAudioPlayer?.pickFiles()
    if (files && files.length > 0) {
      await window.thockdownAudioPlayer?.addSongs(slot, files)
      await refreshCounts()
    }
  }, [primedSlot, refreshCounts])

  const handleSlotPointerDown = useCallback((event: React.PointerEvent, slot: PlaylistSlot) => {
    if (event.button !== 2) return
    event.preventDefault()
    holdTimerRef.current = setTimeout(() => {
      setPrimedSlot(slot)
    }, HOLD_THRESHOLD_MS)
  }, [])

  const handleSlotPointerUp = useCallback(async (event: React.PointerEvent, slot: PlaylistSlot) => {
    if (event.button !== 2) return
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    if (primedSlot === slot) {
      setPrimedSlot(null)
      const nextActiveSlots = activeSlots.filter((s) => s !== slot)
      await window.thockdownAudioPlayer?.clearPlaylist(slot)
      await refreshCounts()
      // Remove this slot from active set if it was active.
      onActiveSlotsChange(nextActiveSlots)
      // If current song was from this slot, stop and pick next.
      if (currentSong?.playlistSlot === slot) {
        musicPlayerService.stop()
        setIsPlaying(false)
        setCurrentSong(null)
        await advanceToNextSong(nextActiveSlots)
      }
    }
  }, [primedSlot, activeSlots, currentSong, onActiveSlotsChange, refreshCounts, advanceToNextSong])

  const handleSlotPointerLeave = useCallback((slot: PlaylistSlot) => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    if (primedSlot === slot) setPrimedSlot(null)
  }, [primedSlot])

  const handleSlotShiftRightClick = useCallback(async (event: MouseEvent, slot: PlaylistSlot) => {
    if (!event.shiftKey) return
    event.preventDefault()
    const folder = await window.thockdownAudioPlayer?.pickFolder()
    if (!folder) return
    const files = await window.thockdownAudioPlayer?.scanFolderForAudio(folder)
    if (files && files.length > 0) {
      await window.thockdownAudioPlayer?.addSongs(slot, files)
      await refreshCounts()
      if (!activeSlots.includes(slot)) {
        onActiveSlotsChange([...activeSlots, slot])
      }
    }
  }, [activeSlots, onActiveSlotsChange, refreshCounts])

  // Combine shift+right-click vs plain right-click on slot buttons.
  const handleSlotContextMenu = useCallback(async (event: MouseEvent, slot: PlaylistSlot) => {
    if (event.shiftKey) {
      await handleSlotShiftRightClick(event, slot)
    } else {
      await handleSlotRightClick(event, slot)
    }
  }, [handleSlotShiftRightClick, handleSlotRightClick])

  // ---------------------------------------------------------------- song label

  const songLabel = currentSong
    ? `${currentSong.favorability} | ${currentSong.title || '?'}${currentSong.artist ? ` (${currentSong.artist})` : ''}`
    : 'No song'

  // ---------------------------------------------------------------- sound options
  // The headphones button swaps the bottom row's six playlist buckets for six
  // sound controls. It is a swap, not an overlay: the row keeps its geometry,
  // so nothing under the cursor moves and the grid stays 2x6 in both states.
  //
  // Adjusting a level while its toggle is off turns the toggle back on. A
  // number that changes while nothing can be heard is a dead control, and the
  // toggle button remains the way to silence it again deliberately.

  const handleMuteToggle = useCallback(() => {
    onMutedChange(!isMuted)
  }, [isMuted, onMutedChange])

  const handleReverbBypassToggle = useCallback(() => {
    onReverbBypassedChange(!isReverbBypassed)
  }, [isReverbBypassed, onReverbBypassedChange])

  const handleVolumeWheel = useCallback((event: WheelEvent) => {
    event.preventDefault()
    if (isMuted) onMutedChange(false)
    onVolumeChange(nudgeLevel(volume, event.deltaY, event.shiftKey))
  }, [volume, isMuted, onMutedChange, onVolumeChange])

  const handleReverbWheel = useCallback((event: WheelEvent) => {
    event.preventDefault()
    if (isReverbBypassed) onReverbBypassedChange(false)
    onReverbAmountChange(nudgeLevel(reverbAmount, event.deltaY, event.shiftKey))
  }, [reverbAmount, isReverbBypassed, onReverbBypassedChange, onReverbAmountChange])

  const handleRoomWheel = useCallback((event: WheelEvent) => {
    event.preventDefault()
    if (isReverbBypassed) onReverbBypassedChange(false)
    onReverbRoomChange(nudgeLevel(reverbRoom, event.deltaY, event.shiftKey))
  }, [reverbRoom, isReverbBypassed, onReverbBypassedChange, onReverbRoomChange])

  const volumeGlyph = useMemo(() => volumeIcon(volume, isMuted), [volume, isMuted])
  const reverbGlyph = useMemo(() => reverbIcon(isReverbBypassed), [isReverbBypassed])
  const roomGlyph = useMemo(() => roomIcon(reverbRoom, isReverbBypassed), [reverbRoom, isReverbBypassed])

  // ---------------------------------------------------------------- render

  return (
    <div className="audio-controls" aria-label="Audio player controls">
      {/* Top row — playback controls */}
      <div className="audio-micro-grid">
        {/* Play / stop — spans 2 columns */}
        <button
          type="button"
          className={`audio-ctrl-btn audio-play-btn${isPlaying ? ' is-active' : ''}`}
          data-tooltip={songLabel}
          aria-label={isPlaying ? 'Stop music' : 'Play music'}
          aria-pressed={isPlaying}
          onClick={() => { void handlePlayToggle() }}
          style={{ gridColumn: 'span 2' }}
        >
          <span
            className={`fa-solid ${isPlaying ? 'fa-stop' : 'fa-play'}`}
            aria-hidden="true"
          />
        </button>

        {/* Rewind — mirror of the forward button, always backwards */}
        <button
          type="button"
          className="audio-ctrl-btn"
          data-tooltip="Rewind 20%. Hold: scrub back 5%/100 ms."
          aria-label="Rewind"
          onClick={() => handleSeekActivate(-1)}
          onContextMenu={(e) => handleSeekContextMenu(e, -1)}
          onPointerDown={(e) => handleSeekPointerDown(e, -1)}
          onPointerUp={handleSeekPointerUp}
          onPointerLeave={stopSeekScrub}
        >
          <span className="fa-solid fa-backward" aria-hidden="true" />
        </button>

        {/* Favorability / skip button */}
        <button
          type="button"
          className={`audio-ctrl-btn${currentSong?.priority === 0 ? ' is-active' : ''}`}
          data-tooltip="Left-click: favourite (replay next). Right-click: skip. Hold right-click: purge."
          aria-label="Favourite or skip current song"
          aria-pressed={currentSong?.priority === 0}
          onClick={() => { void handleFavoriteLeft() }}
          onContextMenu={handleFavoriteContextMenu}
          onPointerDown={handleFavPointerDown}
          onPointerUp={(e) => { void handleFavPointerUp(e) }}
        >
          <span className="fa-solid fa-heart" aria-hidden="true" />
        </button>

        {/* Fast forward */}
        <button
          type="button"
          className="audio-ctrl-btn"
          data-tooltip="Forward 20%. Hold: scrub forward 5%/100 ms."
          aria-label="Fast forward"
          onClick={() => handleSeekActivate(1)}
          onContextMenu={(e) => handleSeekContextMenu(e, 1)}
          onPointerDown={(e) => handleSeekPointerDown(e, 1)}
          onPointerUp={handleSeekPointerUp}
          onPointerLeave={stopSeekScrub}
        >
          <span className="fa-solid fa-forward" aria-hidden="true" />
        </button>

        {/* Sound-options toggle: swaps the bottom row between buckets and levels */}
        <button
          type="button"
          className={`audio-ctrl-btn${isSoundOptionsOpen ? ' is-active' : ''}`}
          data-tooltip={isSoundOptionsOpen ? 'Back to playlists' : 'Sound options'}
          aria-label={isSoundOptionsOpen ? 'Show playlists' : 'Show sound options'}
          aria-pressed={isSoundOptionsOpen}
          onClick={() => onSoundOptionsOpenChange(!isSoundOptionsOpen)}
        >
          <span className="fa-solid fa-headphones" aria-hidden="true" />
        </button>

        {/* Bottom row — playlist buckets, or the sound options in their place */}
        {isSoundOptionsOpen ? (
          <>
            <button
              type="button"
              className={`audio-ctrl-btn audio-sound-btn${isMuted ? '' : ' is-active'}`}
              data-tooltip={isMuted ? `Muted — click to restore volume ${toDisplayLevel(volume)}` : 'Mute'}
              aria-label={isMuted ? 'Unmute music' : 'Mute music'}
              aria-pressed={!isMuted}
              onClick={handleMuteToggle}
            >
              <span className={volumeGlyph} aria-hidden="true" />
            </button>

            <SoundLevelButton
              value={volume}
              onWheel={handleVolumeWheel}
              label="Music volume"
              tooltip="Volume — scroll to adjust (Shift: by 10)"
              isDimmed={isMuted}
            />

            <button
              type="button"
              className={`audio-ctrl-btn audio-sound-btn${isReverbBypassed ? '' : ' is-active'}`}
              data-tooltip={isReverbBypassed ? `Reverb off — click to restore ${toDisplayLevel(reverbAmount)}` : 'Turn reverb off'}
              aria-label={isReverbBypassed ? 'Enable reverb' : 'Disable reverb'}
              aria-pressed={!isReverbBypassed}
              onClick={handleReverbBypassToggle}
            >
              <span className={reverbGlyph} aria-hidden="true" />
            </button>

            <SoundLevelButton
              value={reverbAmount}
              onWheel={handleReverbWheel}
              label="Music reverb amount"
              tooltip="Reverb — scroll to adjust (Shift: by 10)"
              isDimmed={isReverbBypassed}
            />

            <button
              type="button"
              className={`audio-ctrl-btn audio-sound-btn${isReverbBypassed ? '' : ' is-active'}`}
              data-tooltip={isReverbBypassed ? 'Reverb off — click to restore' : `Room size ${toDisplayLevel(reverbRoom)} — click to turn reverb off`}
              aria-label={isReverbBypassed ? 'Enable reverb' : 'Disable reverb'}
              aria-pressed={!isReverbBypassed}
              onClick={handleReverbBypassToggle}
            >
              <span className={roomGlyph} aria-hidden="true" />
            </button>

            <SoundLevelButton
              value={reverbRoom}
              onWheel={handleRoomWheel}
              label="Music reverb room size"
              tooltip="Room size — scroll to adjust (Shift: by 10)"
              isDimmed={isReverbBypassed}
            />
          </>
        ) : (
          PLAYLIST_SLOTS.map((slot) => {
            const isEmpty = counts[slot] === 0
            const isActive = activeSlots.includes(slot)
            const isPrimed = primedSlot === slot
            return (
              <button
                key={slot}
                type="button"
                className={`audio-ctrl-btn audio-playlist-btn${isActive ? ' is-active' : ''}${isPrimed ? ' is-primed' : ''}${isEmpty ? ' is-empty' : ''}`}
                data-tooltip={
                  isEmpty
                    ? `${PLAYLIST_SLOT_THEMES[slot]}: empty — click to add files`
                    : isPrimed
                      ? `${PLAYLIST_SLOT_THEMES[slot]}: release to clear all ${counts[slot]} songs`
                      : `${PLAYLIST_SLOT_THEMES[slot]}: ${counts[slot]} song${counts[slot] !== 1 ? 's' : ''}${isActive ? ' (active)' : ''}`
                }
                aria-label={PLAYLIST_SLOT_THEMES[slot]}
                aria-pressed={isActive}
                onClick={() => { void handleSlotLeftClick(slot) }}
                onContextMenu={(e) => { void handleSlotContextMenu(e, slot) }}
                onPointerDown={(e) => handleSlotPointerDown(e, slot)}
                onPointerUp={(e) => { void handleSlotPointerUp(e, slot) }}
                onPointerLeave={() => handleSlotPointerLeave(slot)}
              >
                <span className={PLAYLIST_SLOT_ICONS[slot]} aria-hidden="true" />
              </button>
            )
          })
        )}
      </div>
    </div>
  )
})

/**
 * One of the three numeric level buttons in the sound-options row: prints a
 * 0-99 readout and takes a wheel over it.
 *
 * It exists as its own component purely so each readout owns the ref that
 * `useNonPassiveWheel` needs. The listener has to be native and non-passive
 * (React's delegated synthetic wheel runs late enough that the browser can
 * already have nudged the nearest scrollable ancestor -- the sidebar, here --
 * before preventDefault lands), and a hook cannot be called in a loop.
 *
 * It is deliberately NOT a button that does something on click: the click
 * gesture on a level belongs to its paired toggle, and a readout that both
 * scrolls and clicks would make the toggle ambiguous. Hence `tabIndex={-1}`
 * and a plain div -- there is no keyboard action to expose, and the value is
 * announced through aria-label on the group instead.
 */
function SoundLevelButton({
  value,
  onWheel,
  label,
  tooltip,
  isDimmed,
}: {
  value: number
  onWheel: (event: WheelEvent) => void
  label: string
  tooltip: string
  isDimmed: boolean
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useNonPassiveWheel(ref, onWheel)
  const display = toDisplayLevel(value)
  return (
    <div
      ref={ref}
      className={`audio-ctrl-btn audio-sound-level${isDimmed ? ' is-dimmed' : ''}`}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={SOUND_LEVEL_MAX_DISPLAY}
      aria-valuenow={display}
      tabIndex={-1}
      data-tooltip={tooltip}
    >
      {display}
    </div>
  )
}
