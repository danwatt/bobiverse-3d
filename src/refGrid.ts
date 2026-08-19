import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  Object3D,
  PolarGridHelper,
} from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const RING_RADII = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
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
