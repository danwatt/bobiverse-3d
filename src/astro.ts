import { Color, Vector3 } from 'three';
import type { Star } from './types';

const HOURS_TO_RAD = Math.PI / 12;
const DEG_TO_RAD = Math.PI / 180;

/**
 * Convert an equatorial catalogue position into a Three.js world-space vector.
 *
 * The equatorial frame is right-handed with +z toward the celestial north pole:
 *   xEq = d·cos(dec)·cos(ra),  yEq = d·cos(dec)·sin(ra),  zEq = d·sin(dec)
 *
 * Three.js is y-up, so we remap (xEq, yEq, zEq) -> (xEq, zEq, -yEq). Celestial
 * north therefore points at +Y and the equatorial plane is the XZ plane, which is
 * also where the reference grid lives.
 *
 * One world unit is one light-year.
 */
export function equatorialToVec3(raHours: number, decDegrees: number, distanceLy: number): Vector3 {
  const ra = raHours * HOURS_TO_RAD;
  const dec = decDegrees * DEG_TO_RAD;
  const cosDec = Math.cos(dec);

  const xEq = distanceLy * cosDec * Math.cos(ra);
  const yEq = distanceLy * cosDec * Math.sin(ra);
  const zEq = distanceLy * Math.sin(dec);

  return new Vector3(xEq, zEq, -yEq);
}

/** Convenience wrapper for a catalogue record. */
export function starPosition(star: Star): Vector3 {
  return equatorialToVec3(star.ra, star.dec, star.distanceLy);
}

/**
 * Approximate sRGB colours for the head of each spectral class, keyed by the class
 * letter. Values are the usual blackbody-derived star colours, brightened so that
 * late-M dwarfs stay visible against a black background instead of going near-black.
 *
 * `D` covers all white-dwarf subtypes (DA, DB, DC, DQ, DZ...) and `L`/`T`/`Y` cover
 * brown dwarfs, which are conventionally drawn magenta-to-violet since they emit
 * almost nothing in the visible band.
 */
const CLASS_COLORS: Record<string, string> = {
  O: '#9bb0ff',
  B: '#aabfff',
  A: '#cad7ff',
  F: '#f8f7ff',
  G: '#fff4e8',
  K: '#ffd2a1',
  M: '#ff9d5c',
  L: '#f2603c',
  T: '#c052c8',
  Y: '#7b52d8',
  D: '#e3ecff',
};

/** Class order used to interpolate across a subclass digit (G2 sits 20% of the way to K). */
const CLASS_SEQUENCE = ['O', 'B', 'A', 'F', 'G', 'K', 'M', 'L', 'T', 'Y'] as const;

const FALLBACK_COLOR = '#ffd2a1';

/**
 * Map a Morgan-Keenan spectral type to a display colour.
 *
 * Recognises a leading class letter plus an optional decimal subclass, e.g. `G2V`,
 * `M5.5Ve`, `sdM1`, `K0.5V`, `DA2.9`, `T7`. The subclass linearly blends toward the
 * next cooler class so a G8 reads visibly warmer than a G0.
 */
export function spectralColor(spectral: string): Color {
  // Strip luminosity/peculiarity prefixes like the "sd" in "sdM1".
  const match = /([OBAFGKMLTYD])\s*(\d+(?:\.\d+)?)?/.exec(spectral.toUpperCase());
  if (!match) return new Color(FALLBACK_COLOR);

  const letter = match[1];
  const base = new Color(CLASS_COLORS[letter] ?? FALLBACK_COLOR);

  // White dwarfs use a temperature index, not a 0-9 subclass, so leave them flat.
  if (letter === 'D') return base;

  const subclass = match[2] === undefined ? 5 : Number(match[2]);
  const index = CLASS_SEQUENCE.indexOf(letter as (typeof CLASS_SEQUENCE)[number]);
  const next = CLASS_SEQUENCE[index + 1];
  if (index === -1 || next === undefined) return base;

  return base.lerp(new Color(CLASS_COLORS[next]), Math.min(subclass, 9) / 10);
}

/** Absolute magnitude assumed for components too cool to have a published visual magnitude. */
const ASSUMED_FAINT_MAG = 18;

/** The brightest (numerically smallest) absolute magnitude in a system. */
export function systemAbsMag(star: Star): number {
  let brightest = Number.POSITIVE_INFINITY;
  for (const component of star.components) {
    const mag = component.absMag ?? ASSUMED_FAINT_MAG;
    if (mag < brightest) brightest = mag;
  }
  return Number.isFinite(brightest) ? brightest : ASSUMED_FAINT_MAG;
}

/** The dominant component of a system, used for its colour on the map. */
export function systemColor(star: Star): Color {
  let brightest = star.components[0];
  for (const component of star.components) {
    if ((component.absMag ?? ASSUMED_FAINT_MAG) < (brightest.absMag ?? ASSUMED_FAINT_MAG)) {
      brightest = component;
    }
  }
  return brightest ? spectralColor(brightest.spectral) : new Color(FALLBACK_COLOR);
}

const MAG_BRIGHT = 0.5;
const MAG_FAINT = 17;
const RADIUS_BRIGHT = 0.85;
const RADIUS_FAINT = 0.2;

/**
 * Map absolute magnitude to a point radius in light-years.
 *
 * Purely a legibility device — real stars are ~10^-7 ly across, so any visible dot is
 * already wildly oversized. Using a magnitude ramp rather than true size at least keeps
 * the *relative* ordering honest: Sirius reads as more prominent than a nearby M6 dwarf.
 */
export function magnitudeToRadius(absMag: number): number {
  const t = (absMag - MAG_BRIGHT) / (MAG_FAINT - MAG_BRIGHT);
  const clamped = Math.min(Math.max(t, 0), 1);
  // Ease so the crowd of mid-M dwarfs doesn't all collapse to the same size.
  const eased = Math.pow(clamped, 0.8);
  return RADIUS_BRIGHT + (RADIUS_FAINT - RADIUS_BRIGHT) * eased;
}

/**
 * Whether a system earns a label by default.
 *
 * Labelling all ~90 systems is an unreadable wall of text at most camera angles, so the
 * default set is "bright enough to be a naked-eye landmark, or close enough to matter".
 * The UI exposes a toggle to label everything.
 */
export function isLabelWorthy(star: Star): boolean {
  return systemAbsMag(star) < 7 || star.distanceLy < 11;
}
