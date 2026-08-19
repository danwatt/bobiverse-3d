import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Object3D,
  Points,
  PointsMaterial,
} from 'three';

/** Inner edge matches the catalogue horizon, so the backdrop picks up where real data stops. */
const INNER_RADIUS_LY = 35;
const OUTER_RADIUS_LY = 10_000;
const STAR_COUNT = 6000;

/** Muted tints only — these are backdrop, not catalogue systems, so no saturated colour. */
const TINTS = ['#cfd8f5', '#f4ece0', '#e8d9c8', '#ffffff', '#d9e4ff'];

/**
 * Distant, unclickable backdrop stars filling the space beyond the catalogue horizon.
 *
 * Plain `PointsMaterial` rather than the shader used for `starfield.ts`: these have no
 * per-star data to encode, need no picking, and a fixed screen-space size (no distance
 * attenuation) reads better for a field this deep — real background stars don't visibly
 * grow as the camera drifts a few hundred light-years.
 */
export function createBackgroundStars(): Object3D {
  const vertices: number[] = [];
  const colors: number[] = [];

  const innerCubed = INNER_RADIUS_LY ** 3;
  const outerCubed = OUTER_RADIUS_LY ** 3;
  const tint = new Color();

  for (let i = 0; i < STAR_COUNT; i += 1) {
    // Uniform volume density: sampling radius linearly would bunch points near the centre.
    const radius = Math.cbrt(innerCubed + Math.random() * (outerCubed - innerCubed));
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    const x = radius * Math.sin(phi) * Math.cos(theta);
    const y = radius * Math.cos(phi);
    const z = radius * Math.sin(phi) * Math.sin(theta);
    vertices.push(x, y, z);

    tint.set(TINTS[Math.floor(Math.random() * TINTS.length)]);
    // Dim and vary brightness so the field doesn't read as a flat wall of dots.
    const dim = 0.25 + Math.random() * 0.35;
    colors.push(tint.r * dim, tint.g * dim, tint.b * dim);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));

  const material = new PointsMaterial({
    size: 1.6,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  });

  const points = new Points(geometry, material);
  points.name = 'background-stars';
  return points;
}
