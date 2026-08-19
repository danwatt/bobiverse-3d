import {
  BufferAttribute,
  DoubleSide,
  RingGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  DynamicDrawUsage,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Viewer } from './scene';
import type { Resident, ShipPhase, ShipState, Voyage } from './types';

export interface Fleet {
  /** Evaluate every voyage at `year` and move its marker. Returns the same order as the voyages. */
  update(year: number): ShipState[];
  /** Ships sitting in each system at the last evaluated year, keyed by `Star.id`. */
  residents(): ReadonlyMap<string, Resident[]>;
  /** Show or hide the route lines, leaving the ships themselves visible. */
  setRoutesVisible(visible: boolean): void;
}

/** Cone pointing along +Y, reoriented per voyage. Shared by every ship marker. */
const MARKER_GEOMETRY = new ConeGeometry(0.22, 0.8, 10);
const UP = new Vector3(0, 1, 0);

/** Billboarded ring drawn around a system that currently has ships in it. */
const PRESENCE_GEOMETRY = new RingGeometry(0.62, 0.78, 28);
const PRESENCE_COLOR = new Color('#8affd0');

/**
 * Golden-angle hue spacing, so consecutively added ships never land on adjacent colours
 * however many there are.
 */
function shipColor(index: number): Color {
  return new Color().setHSL(((index * 137.508) % 360) / 360, 0.72, 0.68);
}

/**
 * Fraction of the route covered after `t` of the trip's duration (both 0–1).
 *
 * Ships fly a flip-and-burn profile at constant acceleration `a`: they burn to the midpoint,
 * flip, and decelerate into the destination, so distance goes as ½at² out of the origin and
 * mirrors that coming in. That puts them a quarter of the way along at the halfway point, not
 * halfway — the marker crawls at both ends of the route and sprints through the middle.
 *
 * `noDeceleration` ships never flip, so they are still under a single ½at² curve at arrival.
 * With the departure and arrival years fixed by the timeline, that same-shaped curve stretched
 * over the whole trip implies half the acceleration of a ship that flips — the same order of
 * burn, spent entirely on getting there rather than half of it on stopping.
 */
function routeFraction(t: number, noDeceleration: boolean): number {
  if (noDeceleration) return t * t;
  return t <= 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
}

interface Entry {
  voyage: Voyage;
  origin: Vector3;
  destination: Vector3;
  /** Reused each frame so the update path allocates nothing. */
  position: Vector3;
  routeLine: Line;
  progressLine: Line;
  progressPositions: BufferAttribute;
  marker: Mesh;
  label: CSS2DObject;
  progressElement: HTMLSpanElement;
}

/**
 * The voyage layer: one dim full-length route per ship, a bright line for the leg already
 * flown, and a labelled marker at the ship's position for the current year.
 */
/** Where a ship first appears, for ships that are built somewhere rather than arriving. */
export interface ShipOrigin {
  systemId: string;
  year: number;
}

export interface FleetOptions {
  /** World position of every system, keyed by `Star.id`. */
  positions: Map<string, Vector3>;
  voyages: Voyage[];
  /**
   * Year each ship was destroyed, keyed by ship name. A ship past that year stops counting as
   * present anywhere — without it the map accumulates Bobs that the books killed off.
   */
  lostYears: ReadonlyMap<string, number>;
  /**
   * Where each ship was built, keyed by ship name. Most Bobs are cloned at a system and sit
   * there until they leave, and several never leave at all; without this they would be present
   * nowhere, which reads as an empty Epsilon Eridani for most of the timeline.
   */
  origins: ReadonlyMap<string, ShipOrigin>;
}

export function createFleet(viewer: Viewer, options: FleetOptions): Fleet {
  const { positions, voyages, lostYears, origins } = options;
  const group = new Object3D();
  group.name = 'fleet';
  viewer.scene.add(group);

  // Split so the "Voyage routes" toggle can drop the lines without hiding the ships.
  const routeGroup = new Object3D();
  const shipGroup = new Object3D();
  const presenceGroup = new Object3D();
  group.add(routeGroup, shipGroup, presenceGroup);

  const entries: Entry[] = [];
  /** Every voyage a given ship makes, in departure order. */
  const byShip = new Map<string, Entry[]>();
  /** One ring-and-count marker per system, built the first time a ship stops there. */
  const presence = new Map<string, { ring: Mesh; label: CSS2DObject; element: HTMLDivElement }>();
  const residentsBySystem = new Map<string, Resident[]>();

  function add(voyage: Voyage): void {
    const origin = positions.get(voyage.originId);
    const destination = positions.get(voyage.destinationId);
    if (!origin) throw new Error(`Unknown origin system "${voyage.originId}"`);
    if (!destination) throw new Error(`Unknown destination system "${voyage.destinationId}"`);

    const color = shipColor(entries.length);

    const routeGeometry = new BufferGeometry().setFromPoints([origin, destination]);
    const routeLine = new Line(
      routeGeometry,
      new LineBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    routeGroup.add(routeLine);

    const progressPositions = new BufferAttribute(new Float32Array(6), 3);
    progressPositions.setUsage(DynamicDrawUsage);
    const progressGeometry = new BufferGeometry();
    progressGeometry.setAttribute('position', progressPositions);
    const progressLine = new Line(
      progressGeometry,
      new LineBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    progressLine.frustumCulled = false;
    routeGroup.add(progressLine);

    const marker = new Mesh(MARKER_GEOMETRY, new MeshBasicMaterial({ color }));
    // Point the cone down the route; ships never manoeuvre, so this is set once.
    marker.quaternion.setFromUnitVectors(UP, destination.clone().sub(origin).normalize());
    shipGroup.add(marker);

    const element = document.createElement('div');
    element.className = 'ship-label';
    element.style.color = `#${color.getHexString()}`;
    element.append(voyage.shipName);

    const progressElement = document.createElement('span');
    progressElement.className = 'pct';
    // Muted version of the ship's own colour, so the percentage reads as part of its label.
    progressElement.style.color = `#${color.getHexString()}99`;
    element.append(progressElement);

    const label = new CSS2DObject(element);
    shipGroup.add(label);

    const entry: Entry = {
      voyage,
      origin,
      destination,
      position: origin.clone(),
      routeLine,
      progressLine,
      progressPositions,
      marker,
      label,
      progressElement,
    };

    entries.push(entry);

    const history = byShip.get(voyage.shipName);
    if (history) history.push(entry);
    else byShip.set(voyage.shipName, [entry]);
  }

  /** Ring plus count for a system, created on demand and reused from then on. */
  function presenceFor(systemId: string): { ring: Mesh; label: CSS2DObject; element: HTMLDivElement } {
    const existing = presence.get(systemId);
    if (existing) return existing;

    const position = positions.get(systemId);
    if (!position) throw new Error(`Unknown system "${systemId}"`);

    const ring = new Mesh(
      PRESENCE_GEOMETRY,
      new MeshBasicMaterial({
        color: PRESENCE_COLOR,
        transparent: true,
        opacity: 0.75,
        side: DoubleSide,
        depthWrite: false,
      }),
    );
    ring.position.copy(position);
    presenceGroup.add(ring);

    const element = document.createElement('div');
    element.className = 'presence-label';

    const label = new CSS2DObject(element);
    label.position.copy(position);
    presenceGroup.add(label);

    const created = { ring, label, element };
    presence.set(systemId, created);
    return created;
  }

  /**
   * Where each surviving ship is sitting at `year`.
   *
   * A ship's location is decided by the last voyage it has departed on: still under way means it
   * is nowhere, and a later departure moves it on from wherever it landed before.
   */
  function updateResidents(year: number): void {
    residentsBySystem.clear();

    const place = (systemId: string, resident: Resident): void => {
      const here = residentsBySystem.get(systemId);
      if (here) here.push(resident);
      else residentsBySystem.set(systemId, [resident]);
    };

    for (const shipName of shipNames) {
      const lost = lostYears.get(shipName);
      if (lost !== undefined && year >= lost) continue;

      let latest: Entry | undefined;
      for (const candidate of byShip.get(shipName) ?? []) {
        if (candidate.voyage.departYear <= year) latest = candidate;
      }

      if (latest) {
        // Under way: the ship is drawn on its route rather than sitting anywhere.
        if (year < latest.voyage.arriveYear) continue;
        place(latest.voyage.destinationId, { shipName, sinceYear: latest.voyage.arriveYear });
        continue;
      }

      // Not launched yet, so it is wherever it was built — if it exists at all.
      const origin = origins.get(shipName);
      if (!origin || year < origin.year || !positions.has(origin.systemId)) continue;
      place(origin.systemId, { shipName, sinceYear: origin.year });
    }

    // Longest-standing first, so a system's list reads as its settlement order.
    for (const here of residentsBySystem.values()) {
      here.sort((a, b) => a.sinceYear - b.sinceYear || a.shipName.localeCompare(b.shipName));
    }

    for (const [systemId, marker] of presence) {
      const count = residentsBySystem.get(systemId)?.length ?? 0;
      marker.ring.visible = count > 0;
      marker.label.visible = count > 0;
      if (count > 0) marker.element.textContent = String(count);
    }

    for (const [systemId, here] of residentsBySystem) {
      if (presence.has(systemId)) continue;
      presenceFor(systemId).element.textContent = String(here.length);
    }
  }

  function update(year: number): ShipState[] {
    const states: ShipState[] = [];

    for (const entry of entries) {
      const { departYear, arriveYear } = entry.voyage;
      const span = arriveYear - departYear;
      const lost = lostYears.get(entry.voyage.shipName);

      // A ship destroyed in flight stops where it died, so its travelled leg freezes there
      // instead of quietly completing the trip.
      const asOf = lost === undefined ? year : Math.min(year, lost);

      // A zero-length span would divide by zero; treat it as an instantaneous jump.
      const raw = span === 0 ? (asOf >= departYear ? 1 : 0) : (asOf - departYear) / span;
      const elapsed = Math.min(Math.max(raw, 0), 1);
      const progress = routeFraction(elapsed, entry.voyage.noDeceleration === true);

      let phase: ShipPhase;
      if (lost !== undefined && year >= lost) phase = 'lost';
      else if (year < departYear) phase = 'pending';
      else if (year >= arriveYear) phase = 'arrived';
      else phase = 'transit';

      entry.position.copy(entry.origin).lerp(entry.destination, progress);

      // A voyage that has not left yet draws nothing: showing its route would spoil where the
      // fleet is headed, and at 58 voyages it also turns the map into a ball of string.
      const visible = phase !== 'pending';
      // The cone is a heading indicator, so it only makes sense while the ship is moving. A
      // ship that has landed is represented by its system's presence ring instead.
      entry.marker.visible = phase === 'transit';
      entry.routeLine.visible = visible;
      entry.progressLine.visible = visible;
      // Only ships under way are labelled. Arrived hulls pile up on their destination star —
      // dozens of them by the end of the timeline — and their names would bury it.
      entry.label.visible = phase === 'transit';
      entry.marker.position.copy(entry.position);
      entry.label.position.copy(entry.position);

      if (visible) {
        entry.progressPositions.setXYZ(0, entry.origin.x, entry.origin.y, entry.origin.z);
        entry.progressPositions.setXYZ(1, entry.position.x, entry.position.y, entry.position.z);
        entry.progressPositions.needsUpdate = true;
      }

      // Only ships under way carry a percentage; parking an "arrived" tag on every finished
      // voyage buries the destination star under its own fleet.
      entry.progressElement.textContent = phase === 'transit' ? `${Math.round(progress * 100)}%` : '';

      states.push({ voyage: entry.voyage, phase, progress, position: entry.position });
    }

    updateResidents(year);

    return states;
  }

  for (const voyage of voyages) add(voyage);

  // Every ship the map knows about, whether it was built somewhere or only ever arrives.
  const shipNames = new Set([...byShip.keys(), ...origins.keys()]);

  // Rings are flat geometry, so they have to face the camera to read as rings at any angle.
  viewer.onFrame(() => {
    for (const marker of presence.values()) {
      if (marker.ring.visible) marker.ring.quaternion.copy(viewer.camera.quaternion);
    }
  });

  return {
    update,
    residents: () => residentsBySystem,
    setRoutesVisible(visible) {
      routeGroup.visible = visible;
    },
  };
}
