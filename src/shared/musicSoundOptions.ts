/**
 * Pure helpers for the music player's sound-options row -- the six buttons the
 * headphones toggle swaps in over the playlist buckets.
 *
 * Everything here is a total function over plain values so the row's behaviour
 * (what a wheel notch is worth, which glyph a level maps to, what a toggle
 * does) is testable without mounting the player or touching Web Audio.
 *
 * ## The two number spaces, and why they are separate
 * The audio graph (`MusicPlayerService`) has always taken 0-1 fractions, and
 * persisted state stores them that way. The row displays 0-99 because a
 * two-digit readout is what fits in a square button. `toDisplayLevel` /
 * `fromDisplayLevel` are the only place that conversion happens, and they are
 * exact inverses on the display side (`fromDisplayLevel(toDisplayLevel(d))`
 * round-trips every integer 0-99), so scrolling up and back down lands on the
 * value it started from rather than drifting.
 *
 * ## Mute and bypass are flags, not remembered values
 * The spec asks that toggling mute "remember the pre-toggled state to restore
 * that volume". Storing a separate remembered number would mean two sources of
 * truth for one setting and a sentinel for "not muted". Instead the level is
 * never destroyed: `musicVolume` keeps its value and a boolean says whether it
 * is currently audible. Restoring is then not an operation at all, and a level
 * adjusted while muted is already correct when sound comes back.
 */

/** Number of distinct display steps: levels read 0-99 inclusive. */
export const SOUND_LEVEL_MAX_DISPLAY = 99;

/** One wheel notch moves a level by this much; Shift multiplies it. */
export const SOUND_LEVEL_WHEEL_STEP = 1;
export const SOUND_LEVEL_WHEEL_STEP_COARSE = 10;

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** 0-1 audio fraction -> the 0-99 integer the button prints. */
export function toDisplayLevel(fraction: number): number {
  return Math.round(clamp01(fraction) * SOUND_LEVEL_MAX_DISPLAY);
}

/** 0-99 integer -> the 0-1 fraction the audio graph consumes. */
export function fromDisplayLevel(display: number): number {
  if (!Number.isFinite(display)) return 0;
  const clamped = Math.min(SOUND_LEVEL_MAX_DISPLAY, Math.max(0, Math.round(display)));
  return clamped / SOUND_LEVEL_MAX_DISPLAY;
}

/**
 * Apply a wheel gesture to a 0-1 level, in display steps so the printed number
 * always moves by exactly the step (a fractional nudge that rounds back to the
 * same digit would read as a dead control).
 */
export function nudgeLevel(fraction: number, deltaY: number, coarse: boolean): number {
  if (deltaY === 0) return clamp01(fraction);
  const step = coarse ? SOUND_LEVEL_WHEEL_STEP_COARSE : SOUND_LEVEL_WHEEL_STEP;
  // Wheel up (negative deltaY) increases, matching every other value control.
  const direction = deltaY < 0 ? 1 : -1;
  return fromDisplayLevel(toDisplayLevel(fraction) + direction * step);
}

/**
 * Speaker glyph for the volume toggle. Muted always reads `fa-volume-off`, as
 * does an unmuted level of 0 -- the two are told apart by the button's active
 * highlight (lit = audible), not by a second glyph, so the muted icon stays the
 * single recognisable "no sound" mark.
 */
export function volumeIcon(volume: number, isMuted: boolean): string {
  if (isMuted) return 'fa-solid fa-volume-off';
  const display = toDisplayLevel(volume);
  if (display === 0) return 'fa-solid fa-volume-off';
  if (display < 50) return 'fa-solid fa-volume-low';
  return 'fa-solid fa-volume-high';
}

/**
 * Room-size glyph, in four tiers across the 0-99 range: a box, a room, a hall,
 * open air. Rendered on the room button, which doubles as the second face of
 * the reverb bypass toggle -- when reverb is bypassed it shows `fa-ban`
 * instead, exactly as the reverb button does, because they are one switch.
 */
export const ROOM_ICON_TIERS: readonly string[] = [
  'fa-solid fa-cube',
  'fa-solid fa-house',
  'fa-solid fa-church',
  'fa-solid fa-mountain',
];

export function roomIcon(room: number, isReverbBypassed: boolean): string {
  if (isReverbBypassed) return 'fa-solid fa-ban';
  const tierCount = ROOM_ICON_TIERS.length;
  const tier = Math.min(tierCount - 1, Math.floor(clamp01(room) * tierCount));
  return ROOM_ICON_TIERS[tier];
}

/** Reverb toggle glyph: the antenna when engaged, the bar when bypassed. */
export function reverbIcon(isReverbBypassed: boolean): string {
  return isReverbBypassed ? 'fa-solid fa-ban' : 'fa-solid fa-wifi';
}
