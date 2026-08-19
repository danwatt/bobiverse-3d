import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Object3D,
  Points,
  PointsMaterial,
} from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { equatorialToVec3 } from './astro';

/**
 * Sagittarius A*, J2000. The distance is the 2019 GRAVITY collaboration figure, 8178 pc.
 */
const GALACTIC_CENTER = {
  raHours: 17.7611,
  decDegrees: -29.0078,
  distanceLy: 26_700,
};

const GALACTIC_COLOR = '#ffb765';

/** Screen-space diameter of the marker, in CSS pixels. */
const MARKER_PIXELS = 14;

/**
 * Soft amber disc, drawn once into a canvas and reused as the point sprite.
 *
 * A bare `PointsMaterial` renders square dots. At this size that reads as a UI element rather
 * than an object in the sky, so the marker gets a radial falloff instead.
 */
function markerTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d');
  if (context) {
    const half = size / 2;
    const gradient = context.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, 'rgba(255, 236, 200, 1)');
    gradient.addColorStop(0.28, 'rgba(255, 183, 101, 0.95)');
    gradient.addColorStop(0.6, 'rgba(255, 143, 60, 0.35)');
    gradient.addColorStop(1, 'rgba(255, 143, 60, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }

  return new CanvasTexture(canvas);
}

/**
 * Sagittarius A* at its true position: 26,700 ly down RA 17h 45m / Dec −29°.
 *
 * That is three orders of magnitude outside the catalogue, which is the point — the map's whole
 * 50 ly of stars sits in one pixel of the way there. Two consequences fall out of drawing it
 * honestly rather than as a pointer at the edge of the grid:
 *
 * - The camera's far plane has to reach past 26,700 ly, or neither the marker nor its label
 *   (`CSS2DRenderer` drops anything whose projected depth leaves the clip range) is rendered.
 * - The marker is drawn without size attenuation, so it holds a constant pixel size instead of
 *   collapsing to nothing at a distance no zoom on this map can meaningfully close.
 *
 * It is added to the scene on its own, outside the display toggles and outside the starfield's
 * label modes, so it is always on screen.
 */
export function createGalacticCenter(): Object3D {
  const group = new Object3D();
  group.name = 'galactic-centre';

  const position = equatorialToVec3(
    GALACTIC_CENTER.raHours,
    GALACTIC_CENTER.decDegrees,
    GALACTIC_CENTER.distanceLy,
  );

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([position.x, position.y, position.z], 3),
  );

  const marker = new Points(
    geometry,
    new PointsMaterial({
      size: MARKER_PIXELS,
      sizeAttenuation: false,
      map: markerTexture(),
      color: GALACTIC_COLOR,
      transparent: true,
      depthWrite: false,
      // At 26,700 ly the depth buffer has saturated: the backdrop stars a couple of thousand
      // light-years out land on the same value, and the marker would flicker in and out against
      // them. Nothing here is solid, so skipping the test costs nothing and keeps it on screen.
      depthTest: false,
      blending: AdditiveBlending,
    }),
  );
  // A single point 26,700 ly out: the bounding sphere is fine, but frustum culling on one vertex
  // buys nothing and has bitten this kind of marker before.
  marker.frustumCulled = false;
  group.add(marker);

  const element = document.createElement('div');
  element.className = 'gc-label';

  const name = document.createElement('span');
  name.textContent = 'Sagittarius A*';
  const distance = document.createElement('span');
  distance.className = 'gc-distance';
  // The name alone would lose what it is; nothing else on the map says why this dot matters.
  distance.textContent = `galactic centre · ${GALACTIC_CENTER.distanceLy.toLocaleString('en-US')} ly`;
  element.append(name, distance);

  const label = new CSS2DObject(element);
  label.position.copy(position);
  group.add(label);

  return group;
}
