import {
  BufferGeometry,
  Color,
  ConeGeometry,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PolarGridHelper,
  Vector3,
} from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { equatorialToVec3 } from './astro';

const RING_RADII = [5, 10, 15, 20, 25, 30, 35];
const OUTER_RADIUS = RING_RADII[RING_RADII.length - 1];
/** Radial spokes, one every 2 hours of right ascension. */
const SECTORS = 12;

/**
 * Reference geometry for the equatorial plane: concentric distance rings, radial spokes,
 * a polar axis, and distance labels.
 *
 * Without it the catalogue reads as a flat scatter — there is no other cue for how far
 * "into" the screen a star sits, and no way to judge distance by eye.
 */
export function createRefGrid(): Object3D {
  const group = new Object3D();
  group.name = 'reference-grid';

  const grid = new PolarGridHelper(
    OUTER_RADIUS,
    SECTORS,
    RING_RADII.length,
    96,
    new Color('#2c3f63'),
    new Color('#1b2740'),
  );
  // PolarGridHelper's material is typed as the general `Material | Material[]`, but the
  // helper always builds exactly one LineBasicMaterial.
  const gridMaterial = grid.material as LineBasicMaterial;
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.55;
  gridMaterial.depthWrite = false;
  group.add(grid);

  // Polar axis, drawn through the plane so celestial north/south are readable at a glance.
  const axisMaterial = new LineBasicMaterial({
    color: new Color('#3a5480'),
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const axisGeometry = new BufferGeometry();
  axisGeometry.setAttribute(
    'position',
    new Float32BufferAttribute([0, -OUTER_RADIUS, 0, 0, OUTER_RADIUS, 0], 3),
  );
  group.add(new Line(axisGeometry, axisMaterial));

  group.add(makeAxisLabel('N', 0, OUTER_RADIUS, 0));
  group.add(makeAxisLabel('S', 0, -OUTER_RADIUS, 0));

  // Distance ticks along +X, which is RA 0h on the celestial equator.
  for (const radius of RING_RADII) {
    group.add(makeAxisLabel(`${radius} ly`, radius, 0, 0));
  }

  group.add(makeGalacticCenterPointer());

  return group;
}

/**
 * Sagittarius A*, J2000. The distance is the 2019 GRAVITY collaboration figure, 8178 pc.
 *
 * It is three orders of magnitude outside this map, so it is drawn as a direction rather than a
 * position: a pointer leaving the outer ring, aimed the way you would have to travel.
 */
const GALACTIC_CENTER = {
  raHours: 17.7611,
  decDegrees: -29.0078,
  distanceLy: 26_700,
};

const GALACTIC_COLOR = new Color('#ffb765');

/** Pointer from the Sun toward the galactic centre, ending just past the outer ring. */
function makeGalacticCenterPointer(): Object3D {
  const group = new Object3D();
  group.name = 'galactic-centre';

  const direction = equatorialToVec3(
    GALACTIC_CENTER.raHours,
    GALACTIC_CENTER.decDegrees,
    1,
  ).normalize();

  // Kept inside the outer ring: a pointer that runs off the edge of the map is a pointer whose
  // label the reader never sees.
  const start = direction.clone().multiplyScalar(OUTER_RADIUS * 0.22);
  const end = direction.clone().multiplyScalar(OUTER_RADIUS * 0.6);

  const material = new LineBasicMaterial({
    color: GALACTIC_COLOR,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  const geometry = new BufferGeometry().setFromPoints([start, end]);
  group.add(new Line(geometry, material));

  // Arrowhead at the far end, so the line reads as "keep going this way".
  const head = new Mesh(
    new ConeGeometry(0.42, 1.3, 12),
    new MeshBasicMaterial({ color: GALACTIC_COLOR, transparent: true, opacity: 0.7 }),
  );
  head.position.copy(end);
  head.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction);
  group.add(head);

  const element = document.createElement('div');
  element.className = 'gc-label';

  const name = document.createElement('span');
  name.textContent = 'Galactic centre';
  const distance = document.createElement('span');
  distance.className = 'gc-distance';
  distance.textContent = `${GALACTIC_CENTER.distanceLy.toLocaleString('en-US')} ly`;
  element.append(name, distance);

  const label = new CSS2DObject(element);
  label.position.copy(direction.clone().multiplyScalar(OUTER_RADIUS * 0.66));
  group.add(label);

  return group;
}

function makeAxisLabel(text: string, x: number, y: number, z: number): CSS2DObject {
  const element = document.createElement('div');
  element.className = 'star-label';
  element.style.color = 'rgba(140, 168, 214, 0.55)';
  element.style.fontSize = '10px';
  element.textContent = text;

  const label = new CSS2DObject(element);
  label.position.set(x, y, z);
  return label;
}
