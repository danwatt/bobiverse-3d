/**
 * Look up an element declared in `index.html`.
 *
 * The markup is a fixed part of the app, so a missing id is a build mistake rather than a
 * runtime condition worth handling — failing loudly here beats a cascade of null checks.
 */
export function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id} in index.html`);
  return element as T;
}

/** All elements matching a selector, typed. */
export function queryAll<T extends HTMLElement>(selector: string): T[] {
  return Array.from(document.querySelectorAll<T>(selector));
}
