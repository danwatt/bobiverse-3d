import {
  Clock,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

export type FrameCallback = (delta: number) => void;

export interface Viewer {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  labelRenderer: CSS2DRenderer;
  controls: OrbitControls;
  /** Register a callback run once per frame with the seconds elapsed since the last one. */
  onFrame(callback: FrameCallback): void;
  /** Begin the render loop. */
  start(): void;
  /** Ease the camera to look at a world position without changing its distance. */
  focusOn(target: Vector3): void;
}

/**
 * Build the renderer, camera, controls and label overlay, and mount them into `host`.
 *
 * Two renderers share the same viewport: a WebGL canvas for the 3D content and a
 * `CSS2DRenderer` that positions real DOM nodes on top of it. DOM labels stay crisp at
 * any zoom and are styleable from CSS, which sprite-based text is not.
 */
export function createViewer(host: HTMLElement): Viewer {
  const scene = new Scene();

  // Far plane reaches past Sagittarius A* at 26,700 ly — the furthest thing drawn, and well past
  // the background starfield's 10,000 ly outer radius. Anything beyond the plane is not merely
  // clipped: CSS2DRenderer drops its label too, which is what makes the marker disappear.
  const camera = new PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.05, 40000);
  camera.position.set(19, 27, 57);

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  host.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.domElement.className = 'label-layer';
  host.appendChild(labelRenderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.9;
  controls.panSpeed = 0.7;
  controls.minDistance = 0.4;
  controls.maxDistance = 400;
  controls.target.set(0, 0, 0);
  controls.update();

  const callbacks: FrameCallback[] = [];
  const clock = new Clock();

  function resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    labelRenderer.setSize(width, height);
  }
  window.addEventListener('resize', resize);

  function tick(): void {
    const delta = clock.getDelta();
    for (const callback of callbacks) callback(delta);
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }

  return {
    scene,
    camera,
    renderer,
    labelRenderer,
    controls,
    onFrame(callback) {
      callbacks.push(callback);
    },
    start() {
      renderer.setAnimationLoop(tick);
    },
    focusOn(target) {
      // Keep the current viewing distance and direction; only slide the orbit centre.
      const offset = camera.position.clone().sub(controls.target);
      controls.target.copy(target);
      camera.position.copy(target).add(offset);
      controls.update();
    },
  };
}
