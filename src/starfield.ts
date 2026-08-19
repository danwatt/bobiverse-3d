import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  Points,
  Raycaster,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { isLabelWorthy, magnitudeToRadius, starPosition, systemAbsMag, systemColor } from './astro';
import type { Viewer } from './scene';
import type { Star } from './types';

export interface Starfield {
  /** World position of every system, keyed by `Star.id`. */
  positions: Map<string, Vector3>;
  /** Label every system rather than only the notable ones. */
  setLabelAll(all: boolean): void;
  /** Select a system by id, or clear the selection with `null`. */
  select(id: string | null): void;
  /** Register a listener fired whenever the selection changes. */
  onSelect(callback: (star: Star | null) => void): void;
}

/**
 * `PointsMaterial` has a single scalar `size`, so per-star sizing needs a custom shader.
 * The vertex stage converts a world-space radius into pixels itself rather than relying on
 * Three's `sizeAttenuation`, whose built-in `scale` uniform ignores the camera FOV.
 */
const VERTEX_SHADER = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uPixelsPerUnit;
  varying vec3 vColor;

  void main() {
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    // -mvPosition.z is the view-space depth; guard against the near-plane singularity.
    float depth = max(-mvPosition.z, 0.05);
    gl_PointSize = clamp(aSize * uPixelsPerUnit / depth, 2.0, 220.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

/** Soft radial falloff with a hot core, so bright stars bloom instead of reading as flat discs. */
const FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float halo = smoothstep(0.5, 0.0, d);
    float core = smoothstep(0.22, 0.0, d);
    gl_FragColor = vec4(vColor * (0.55 + core * 0.9), halo * halo);
  }
`;

interface Entry {
  star: Star;
  position: Vector3;
  label: CSS2DObject;
  labelElement: HTMLDivElement;
  /** True when the system is notable enough to be labelled by default. */
  worthy: boolean;
}

const CLICK_SLOP_PX = 5;

/**
 * Build the star point cloud, its labels, and hover/click picking.
 *
 * All systems live in one `Points` object — a single draw call for the whole catalogue —
 * with the vertex index doubling as the index into `entries`, which is what makes raycast
 * hits cheap to resolve back to a `Star`.
 */
export function createStarfield(viewer: Viewer, systems: Star[]): Starfield {
  const group = new Object3D();
  group.name = 'starfield';
  viewer.scene.add(group);

  const entries: Entry[] = [];
  const positions = new Map<string, Vector3>();

  const vertices: number[] = [];
  const colors: number[] = [];
  const sizes: number[] = [];

  for (const star of systems) {
    const position = starPosition(star);
    const color = systemColor(star);
    const radius = magnitudeToRadius(systemAbsMag(star));

    positions.set(star.id, position);
    vertices.push(position.x, position.y, position.z);
    colors.push(color.r, color.g, color.b);
    sizes.push(radius);

    const labelElement = document.createElement('div');
    labelElement.className = star.id === 'sol' ? 'star-label star-label--sun' : 'star-label';
    labelElement.textContent = star.name;

    const label = new CSS2DObject(labelElement);
    label.position.copy(position);
    group.add(label);

    // Visibility has to live on the CSS2DObject, not the element: CSS2DRenderer rewrites
    // `style.display` from `object.visible` on every frame.
    const worthy = star.id === 'sol' || isLabelWorthy(star);
    label.visible = worthy;

    entries.push({ star, position, label, labelElement, worthy });
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('aColor', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new Float32BufferAttribute(sizes, 1));

  const material = new ShaderMaterial({
    uniforms: { uPixelsPerUnit: { value: 500 } },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });

  const points = new Points(geometry, material);
  // Points are billboards drawn from a fixed vertex, so Three's automatic bounding sphere
  // underestimates their screen extent and can cull the cloud at close range.
  points.frustumCulled = false;
  group.add(points);

  // "You are here" ring around the Sun, so the origin reads as special even when zoomed out.
  const sunMarker = new Mesh(
    new OctahedronGeometry(0.75, 0),
    new MeshBasicMaterial({ color: new Color('#ffdf8a'), wireframe: true, transparent: true, opacity: 0.5 }),
  );
  group.add(sunMarker);

  // Keep the world-space-to-pixels factor in sync with the viewport and FOV.
  const viewportSize = new Vector2();
  viewer.onFrame(() => {
    viewer.renderer.getSize(viewportSize);
    const halfFov = MathUtils.degToRad(viewer.camera.fov) * 0.5;
    material.uniforms.uPixelsPerUnit.value =
      (viewportSize.y * 0.5) / Math.tan(halfFov) * viewer.renderer.getPixelRatio();
    sunMarker.rotation.y += 0.0015;
  });

  // ---------- Picking ----------

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const listeners: ((star: Star | null) => void)[] = [];

  let selectedIndex: number | null = null;
  let hoveredIndex: number | null = null;
  const canvas = viewer.renderer.domElement;

  /** Index of the star under the given client coordinates, or null. */
  function pick(clientX: number, clientY: number): number | null {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    // Scale the pick radius with viewing distance so distant, visually tiny dots stay clickable.
    const distance = viewer.camera.position.distanceTo(viewer.controls.target);
    raycaster.params.Points = { threshold: MathUtils.clamp(distance * 0.014, 0.2, 1.6) };
    raycaster.setFromCamera(pointer, viewer.camera);

    const hits = raycaster.intersectObject(points, false);
    const index = hits[0]?.index;
    return index === undefined ? null : index;
  }

  function applyLabelState(index: number): void {
    const entry = entries[index];
    entry.label.visible = labelAll || entry.worthy || index === selectedIndex || index === hoveredIndex;
    entry.labelElement.classList.toggle('star-label--selected', index === selectedIndex);
  }

  let labelAll = false;

  function setHovered(index: number | null): void {
    if (index === hoveredIndex) return;
    const previous = hoveredIndex;
    hoveredIndex = index;
    if (previous !== null) applyLabelState(previous);
    if (index !== null) applyLabelState(index);
    canvas.style.cursor = index === null ? '' : 'pointer';
  }

  function setSelected(index: number | null): void {
    if (index === selectedIndex) return;
    const previous = selectedIndex;
    selectedIndex = index;
    if (previous !== null) applyLabelState(previous);
    if (index !== null) applyLabelState(index);

    const star = index === null ? null : entries[index].star;
    for (const listener of listeners) listener(star);
  }

  canvas.addEventListener('pointermove', (event) => {
    setHovered(pick(event.clientX, event.clientY));
  });
  canvas.addEventListener('pointerleave', () => setHovered(null));

  // Distinguish a click from the end of an orbit drag: OrbitControls consumes the drag, but
  // the browser still fires `click`, which would otherwise reselect on every camera move.
  let downX = 0;
  let downY = 0;
  canvas.addEventListener('pointerdown', (event) => {
    downX = event.clientX;
    downY = event.clientY;
  });
  canvas.addEventListener('click', (event) => {
    const moved = Math.hypot(event.clientX - downX, event.clientY - downY);
    if (moved > CLICK_SLOP_PX) return;
    setSelected(pick(event.clientX, event.clientY));
  });

  return {
    positions,
    setLabelAll(all) {
      labelAll = all;
      for (let i = 0; i < entries.length; i += 1) applyLabelState(i);
    },
    select(id) {
      if (id === null) {
        setSelected(null);
        return;
      }
      const index = entries.findIndex((entry) => entry.star.id === id);
      setSelected(index === -1 ? null : index);
    },
    onSelect(callback) {
      listeners.push(callback);
    },
  };
}
