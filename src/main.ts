import './style.css';

import { spectralColor } from './astro';
import starsJson from './data/stars.json';
import voyagesJson from './data/voyages.json';
import { createFleet } from './fleet';
import { createRefGrid } from './refGrid';
import { createViewer } from './scene';
import { createStarfield } from './starfield';
import { createTimeline } from './timeline';
import type { ShipState, Star, StarCatalog, Voyage } from './types';
import { byId } from './ui/dom';

const catalog = starsJson as StarCatalog;
const voyages = voyagesJson as Voyage[];

const viewer = createViewer(byId('app'));

// ---------- Scene contents ----------

const refGrid = createRefGrid();
viewer.scene.add(refGrid);

const starfield = createStarfield(viewer, catalog.systems);
const fleet = createFleet(viewer, starfield.positions, voyages);

byId('star-count').textContent = String(catalog.systems.length);
byId('horizon-ly').textContent = String(catalog.meta.horizonLy);

// ---------- Display toggles ----------

byId<HTMLInputElement>('toggle-all-labels').addEventListener('change', (event) => {
  starfield.setLabelAll((event.currentTarget as HTMLInputElement).checked);
});

byId<HTMLInputElement>('toggle-grid').addEventListener('change', (event) => {
  refGrid.visible = (event.currentTarget as HTMLInputElement).checked;
});

byId<HTMLInputElement>('toggle-routes').addEventListener('change', (event) => {
  fleet.setRoutesVisible((event.currentTarget as HTMLInputElement).checked);
});

// ---------- Selected-system panel ----------

const infoPanel = byId('info-panel');
const infoName = byId('info-name');
const infoDistance = byId('info-distance');
const infoComponents = byId<HTMLUListElement>('info-components');

// The note has no slot in the markup because most systems don't have one.
const infoNote = document.createElement('p');
infoNote.className = 'info-note';
infoPanel.append(infoNote);

function showStar(star: Star | null): void {
  if (!star) {
    infoPanel.hidden = true;
    return;
  }

  infoName.textContent = star.name;
  const count = star.components.length;
  infoDistance.textContent =
    star.distanceLy === 0
      ? 'Home system'
      : `${star.distanceLy.toFixed(2)} ly · ${count} ${count === 1 ? 'component' : 'components'}`;

  infoComponents.replaceChildren();
  for (const component of star.components) {
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    const hex = `#${spectralColor(component.spectral).getHexString()}`;
    // `.swatch` throws its glow from currentColor, so both properties have to be set.
    swatch.style.color = hex;
    swatch.style.background = hex;

    const name = document.createElement('span');
    name.className = 'comp-name';
    name.textContent = component.name;

    const meta = document.createElement('span');
    meta.className = 'comp-meta';
    // A handful of catalogue rows carry no spectral type at all.
    const spectral = component.spectral || 'type unknown';
    meta.textContent =
      component.absMag === undefined ? spectral : `${spectral} · M${component.absMag.toFixed(1)}`;

    const item = document.createElement('li');
    item.append(swatch, name, meta);
    infoComponents.append(item);
  }

  infoNote.textContent = star.note ?? '';
  infoNote.hidden = star.note === undefined;
  infoPanel.hidden = false;
}

starfield.onSelect(showStar);
byId('info-close').addEventListener('click', () => starfield.select(null));

// ---------- Fleet list ----------

const fleetList = byId<HTMLUListElement>('fleet-list');
const systemsById = new Map(catalog.systems.map((star) => [star.id, star]));
/** Chips are reused across frames so scrubbing doesn't rebuild the DOM sixty times a second. */
const chips = new Map<string, { item: HTMLLIElement; status: HTMLSpanElement }>();

function systemName(id: string): string {
  return systemsById.get(id)?.name ?? id;
}

function renderFleetList(states: ShipState[]): void {
  for (const state of states) {
    let chip = chips.get(state.voyage.id);

    if (!chip) {
      const item = document.createElement('li');
      item.className = 'fleet-item';
      item.dataset.voyage = state.voyage.id;
      item.title = 'Centre the view on this ship';
      item.style.cursor = 'pointer';

      const dot = document.createElement('span');
      dot.className = 'dot';

      const name = document.createElement('span');
      name.textContent = state.voyage.shipName;

      const route = document.createElement('span');
      route.className = 'route';
      route.textContent = `${systemName(state.voyage.originId)} → ${systemName(state.voyage.destinationId)}`;

      const status = document.createElement('span');
      status.className = 'route';

      item.append(dot, name, route, status);
      fleetList.append(item);

      chip = { item, status };
      chips.set(state.voyage.id, chip);
    }

    chip.item.dataset.phase = state.phase;
    chip.status.textContent =
      state.phase === 'pending'
        ? `departs ${state.voyage.departYear}`
        : state.phase === 'arrived'
          ? `arrived ${state.voyage.arriveYear}`
          : `${Math.round(state.progress * 100)}%`;
  }
}

// Clicking a chip flies the orbit centre to that ship — the only way to find one
// mid-transit without hunting for it.
let latestStates: ShipState[] = [];
fleetList.addEventListener('click', (event) => {
  const item = (event.target as HTMLElement).closest<HTMLLIElement>('.fleet-item');
  const id = item?.dataset.voyage;
  if (!id) return;

  const state = latestStates.find((candidate) => candidate.voyage.id === id);
  if (!state) return;

  const target = state.phase === 'pending' ? starfield.positions.get(state.voyage.originId) : state.position;
  if (target) viewer.focusOn(target);
});

// ---------- Timeline ----------

const timeline = createTimeline(viewer, voyages);

timeline.onChange((year) => {
  latestStates = fleet.update(year);
  renderFleetList(latestStates);
});

// The timeline only emits on change, so paint the opening year explicitly.
latestStates = fleet.update(timeline.getYear());
renderFleetList(latestStates);

viewer.start();
