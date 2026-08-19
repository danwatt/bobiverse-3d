import type { Viewer } from './scene';
import type { Voyage } from './types';
import { byId, queryAll } from './ui/dom';

export interface Timeline {
  getYear(): number;
  onChange(callback: (year: number) => void): void;
}

/** Years of simulated time per second of wall clock at 1x speed. */
const YEARS_PER_SECOND = 3;
/** Breathing room either side of the voyages so departures aren't pinned to the slider edge. */
const RANGE_PADDING = 5;
/** Used when there are no voyages at all to derive a range from. */
const EMPTY_RANGE = { min: 2100, max: 2200 };

/** The span the timeline should cover for a set of voyages. */
function voyageRange(voyages: Voyage[]): { min: number; max: number } {
  if (voyages.length === 0) return { ...EMPTY_RANGE };

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const voyage of voyages) {
    min = Math.min(min, voyage.departYear);
    max = Math.max(max, voyage.arriveYear);
  }
  return { min: min - RANGE_PADDING, max: max + RANGE_PADDING };
}

/**
 * Year state plus the transport controls that drive it.
 *
 * Playback advances from the render loop's delta rather than a timer, so the year tracks
 * real elapsed time even when frames are dropped, and never runs ahead of what is drawn.
 */
export function createTimeline(viewer: Viewer, voyages: Voyage[]): Timeline {
  const slider = byId<HTMLInputElement>('year-slider');
  const yearInput = byId<HTMLInputElement>('year-input');
  const playToggle = byId<HTMLButtonElement>('play-toggle');
  const speedButtons = queryAll<HTMLButtonElement>('.btn--speed');

  const listeners: ((year: number) => void)[] = [];

  const { min, max } = voyageRange(voyages);
  let year = min;
  let speed = 1;
  let playing = false;

  slider.step = '0.05';

  function setPlaying(next: boolean): void {
    playing = next;
    playToggle.textContent = playing ? '❚❚' : '▶';
    playToggle.classList.toggle('is-active', playing);
  }

  function setYear(next: number): void {
    const clamped = Math.min(Math.max(next, min), max);
    if (clamped === year) return;
    year = clamped;

    slider.value = String(year);
    // Only the integer year is meaningful to read; the fractional part exists for smooth motion.
    yearInput.value = String(Math.round(year));

    for (const listener of listeners) listener(year);
  }

  slider.addEventListener('input', () => {
    setPlaying(false);
    setYear(Number(slider.value));
  });

  // 'change' rather than 'input': committing on every keystroke fights the user mid-number.
  yearInput.addEventListener('change', () => {
    const parsed = Number(yearInput.value);
    if (Number.isFinite(parsed)) setYear(parsed);
    yearInput.value = String(Math.round(year));
  });

  playToggle.addEventListener('click', () => {
    // Restarting from the top is friendlier than a play button that does nothing at the end.
    if (!playing && year >= max) setYear(min);
    setPlaying(!playing);
  });

  for (const button of speedButtons) {
    button.addEventListener('click', () => {
      speed = Number(button.dataset.speed ?? 1);
      for (const other of speedButtons) other.classList.toggle('is-active', other === button);
    });
  }

  viewer.onFrame((delta) => {
    if (!playing) return;
    setYear(year + delta * speed * YEARS_PER_SECOND);
    if (year >= max) setPlaying(false);
  });

  slider.min = String(min);
  slider.max = String(max);
  yearInput.min = String(Math.ceil(min));
  yearInput.max = String(Math.floor(max));
  slider.value = String(year);
  yearInput.value = String(Math.round(year));
  setPlaying(false);

  return {
    getYear: () => year,
    onChange(callback) {
      listeners.push(callback);
    },
  };
}
