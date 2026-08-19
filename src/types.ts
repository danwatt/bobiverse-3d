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

/**
 * Which systems carry a name label.
 *
 * `major` is the default subset — bright enough to be a landmark, or close enough to matter.
 * `visited` is every system the fleet departs from or arrives at.
 */
export type LabelMode = 'major' | 'visited' | 'all';

/** Shape of `data/voyages.json`. */
export interface VoyageCatalog {
  meta: {
    source: string;
    license: string;
    generated: string;
    provenance: string;
  };
  voyages: Voyage[];
}

/** `lost` is a ship destroyed in the books; its route stays on the map as history. */
export type ShipPhase = 'pending' | 'transit' | 'arrived' | 'lost';

/** A ship sitting in a system, rather than under way. */
export interface Resident {
  shipName: string;
  /** Year it arrived on its most recent completed voyage. */
  sinceYear: number;
}

/** A voyage evaluated at one instant on the timeline. */
export interface ShipState {
  voyage: Voyage;
  phase: ShipPhase;
  /** Fraction of the route covered, clamped to 0–1. */
  progress: number;
  /** World-space position at the evaluated year. */
  position: Vector3;
}

/**
 * One Bob replicant, from the timeline compiled by the bobiverse-map project.
 *
 * Years are fractional (2145.7 is roughly September 2145) because the source timeline places
 * several events inside the same year.
 */
export interface BobReplicant {
  name: string;
  /** Replication generation: Bob himself is 1, his direct clones 2, and so on. */
  gen: number;
  /** Name of the Bob this one was cloned from; null for the original. */
  parent: string | null;
  created: number;
  /** `Star.id` of the system the Bob was created in. */
  atId: string;
  /** Year this Bob was destroyed, or null if it survives the covered books. */
  destroyed: number | null;
  /** Which book (1-3) introduces this Bob. */
  book: number;
}

/** A dated event from the same timeline. */
export interface TimelineEvent {
  year: number;
  text: string;
  /** Name of the Bob the event concerns, when it is about one in particular. */
  bob?: string;
  book: number;
}
