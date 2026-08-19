import type { Vector3 } from 'three';

/** One physical star (or brown dwarf / white dwarf) inside a system. */
export interface StarComponent {
  /** Display name, e.g. "α Cen A". */
  name: string;
  /** Morgan-Keenan spectral type, e.g. "G2V", "M5.5Ve", "DZ8" (white dwarf), "T8" (brown dwarf). */
  spectral: string;
  /** Absolute visual magnitude. Omitted for objects too cool to have a meaningful V. */
  absMag?: number;
}

/**
 * One star *system* — a gravitationally bound group sharing a position on the map.
 *
 * Positions are stored as catalogue values (equatorial RA/Dec + distance) rather than
 * pre-computed cartesian coordinates so they stay diffable against a published catalogue.
 * Conversion to world space happens in `astro.ts`.
 */
export interface Star {
  /** Stable slug used by voyages to reference this system. */
  id: string;
  name: string;
  /** Right ascension, in hours (0–24). J2000. */
  ra: number;
  /** Declination, in degrees (-90–90). J2000. */
  dec: number;
  /** Distance from the Sun, in light-years. */
  distanceLy: number;
  components: StarComponent[];
  /** Optional free-text note shown in the info panel. */
  note?: string;
}

/** Shape of `data/stars.json`. */
export interface StarCatalog {
  meta: {
    horizonLy: number;
    epoch: string;
    provenance: string;
  };
  systems: Star[];
}

/** A named ship travelling in a straight line between two systems at constant speed. */
export interface Voyage {
  id: string;
  shipName: string;
  /** `Star.id` of the departure system. */
  originId: string;
  /** `Star.id` of the arrival system. */
  destinationId: string;
  departYear: number;
  arriveYear: number;
}

export type ShipPhase = 'pending' | 'transit' | 'arrived';

/** A voyage evaluated at one instant on the timeline. */
export interface ShipState {
  voyage: Voyage;
  phase: ShipPhase;
  /** Fraction of the route covered, clamped to 0–1. */
  progress: number;
  /** World-space position at the evaluated year. */
  position: Vector3;
}
