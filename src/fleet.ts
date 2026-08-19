import {
  BufferAttribute,
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
import type { ShipPhase, ShipState, Voyage } from './types';

export interface Fleet {
  /** Evaluate every voyage at `year` and move its marker. Returns the same order as the voyages. */
  update(year: number): ShipState[];
  /** Show or hide the route lines, leaving the ships themselves visible. */
  setRoutesVisible(visible: boolean): void;
}

/** Cone pointing along +Y, reoriented per voyage. Shared by every ship marker. */
const MARKER_GEOMETRY = new ConeGeometry(0.22, 0.8, 10);
const UP = new Vector3(0, 1, 0);

/**
 * Golden-angle hue spacing, so consecutively added ships never land on adjacent colours
 * however many there are.
 */
function shipColor(index: number): Color {
  return new Color().setHSL(((index * 137.508) % 360) / 360, 0.72, 0.68);
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
export function createFleet(viewer: Viewer, positions: Map<string, Vector3>, voyages: Voyage[]): Fleet {
  const group = new Object3D();
  group.name = 'fleet';
  viewer.scene.add(group);

  // Split so the "Voyage routes" toggle can drop the lines without hiding the ships.
  const routeGroup = new Object3D();
  const shipGroup = new Object3D();
  group.add(routeGroup, shipGroup);

  const entries: Entry[] = [];

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

    entries.push({
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
    });
  }

  function update(year: number): ShipState[] {
    const states: ShipState[] = [];

    for (const entry of entries) {
      const { departYear, arriveYear } = entry.voyage;
      const span = arriveYear - departYear;

      // A zero-length span would divide by zero; treat it as an instantaneous jump.
      const raw = span === 0 ? (year >= departYear ? 1 : 0) : (year - departYear) / span;
      const progress = Math.min(Math.max(raw, 0), 1);

      let phase: ShipPhase;
      if (year < departYear) phase = 'pending';
      else if (year >= arriveYear) phase = 'arrived';
      else phase = 'transit';

      entry.position.copy(entry.origin).lerp(entry.destination, progress);

      const visible = phase !== 'pending';
      entry.marker.visible = visible;
      entry.label.visible = visible;
      entry.progressLine.visible = visible;
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

    return states;
  }

  for (const voyage of voyages) add(voyage);

  return {
    update,
    setRoutesVisible(visible) {
      routeGroup.visible = visible;
    },
  };
}
