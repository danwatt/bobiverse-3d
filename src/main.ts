import './style.css';

import { spectralColor } from './astro';
import { createBackgroundStars } from './backgroundStars';
import { bobs, systemIds as bookSystemIds } from './data/bobiverse';
import starsJson from './data/stars.json';
import voyagesJson from './data/voyages.json';
import { createFamilyTree } from './familyTree';
import { createFleet } from './fleet';
import { createGalacticCenter } from './galacticCenter';
import { createRefGrid } from './refGrid';
import { createViewer } from './scene';
import { createStarfield } from './starfield';
import { createTimeline } from './timeline';
import type { LabelMode, ShipState, Star, StarCatalog, VoyageCatalog } from './types';
import { byId, queryAll } from './ui/dom';

const catalog = starsJson as StarCatalog;
const voyages = (voyagesJson as VoyageCatalog).voyages;

const viewer = createViewer(byId('app'));

// ---------- Scene contents ----------

viewer.scene.add(createBackgroundStars());

const refGrid = createRefGrid();
viewer.scene.add(refGrid);

// Sagittarius A* at its real distance, 26,700 ly out. It is the one landmark everything else in
// the Galaxy is arranged around, so it hangs outside the display toggles and the label modes and
// stays on screen at all times.
viewer.scene.add(createGalacticCenter());

// Every system the books reach, for the "In books" label mode. The imported timeline covers the
// ones the fleet flies to, and the catalogue's own `inBooks` flag covers the rest: the story
// reaches places no voyage leg ends at, and Eta Leporis — the Quinlan home system — is one.
const bookIds = new Set([
  ...bookSystemIds,
  ...catalog.systems.filter((star) => star.inBooks).map((star) => star.id),
]);

const starfield = createStarfield(viewer, catalog.systems, bookIds);

// Ships share their name with the Bob flying them, so the replicant table doubles as the record
// of where each one was built and when it stopped existing.
const lostYears = new Map<string, number>();
const origins = new Map<string, { systemId: string; year: number }>();
for (const bob of bobs) {
  if (bob.destroyed !== null) lostYears.set(bob.name, bob.destroyed);
  origins.set(bob.name, { systemId: bob.atId, year: bob.created });
}

const fleet = createFleet(viewer, {
  positions: starfield.positions,
  voyages,
  lostYears,
  origins,
});

byId('star-count').textContent = String(catalog.systems.length);
// The catalogue reaches past its own build horizon wherever the overlay carries a system in by
// hand — Eta Leporis sits at 48.5 ly — so the header reports the real extent rather than
// `meta.horizonLy`, which only describes the HYG cut.
const furthestLy = catalog.systems.reduce((far, star) => Math.max(far, star.distanceLy), 0);
byId('horizon-ly').textContent = String(Math.ceil(furthestLy));

// ---------- Display toggles ----------

const labelModeButtons = queryAll<HTMLButtonElement>('#label-mode .btn--seg');
for (const button of labelModeButtons) {
  button.addEventListener('click', () => {
    starfield.setLabelMode(button.dataset.labelMode as LabelMode);
    for (const other of labelModeButtons) other.classList.toggle('is-active', other === button);
  });
}

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
const infoPlanets = byId('info-planets');
const infoWorlds = byId<HTMLUListElement>('info-worlds');
const infoPresence = byId('info-presence');
const infoBobs = byId<HTMLUListElement>('info-bobs');
const infoInbound = byId('info-inbound');
const infoArrivals = byId<HTMLUListElement>('info-arrivals');

/** The system whose details are on screen, so the panel can follow the year. */
let selectedStar: Star | null = null;

/** Every voyage as of the year on the timeline, shared by the info panel and the fleet row. */
let latestStates: ShipState[] = [];

// The note has no slot in the markup because most systems don't have one.
const infoNote = document.createElement('p');
infoNote.className = 'info-note';
infoPanel.append(infoNote);

/** Who is sitting in the selected system right now. Redrawn whenever the year moves. */
function renderPresence(): void {
  const here = selectedStar ? fleet.residents().get(selectedStar.id) : undefined;
  if (!here || here.length === 0) {
    infoPresence.hidden = true;
    return;
  }

  infoBobs.replaceChildren();
  for (const resident of here) {
    const name = document.createElement('span');
    name.textContent = resident.shipName;

    const since = document.createElement('span');
    since.className = 'comp-meta';
    // Arrival years are fractional; the whole year is as precise as this reads.
    since.textContent = `since ${Math.floor(resident.sinceYear)}`;

    const item = document.createElement('li');
    item.append(name, since);
    infoBobs.append(item);
  }
  infoPresence.hidden = false;
}

/**
 * Ships currently flying towards the selected system.
 *
 * Their markers are out in the middle of nowhere, so without this the panel says a system is
 * empty right up to the year a fleet lands in it.
 */
function renderInbound(): void {
  const star = selectedStar;
  const heading = star
    ? latestStates.filter(
        (state) => state.phase === 'transit' && state.voyage.destinationId === star.id,
      )
    : [];

  if (heading.length === 0) {
    infoInbound.hidden = true;
    return;
  }

  // Soonest arrival first, so the list reads as the order they turn up in.
  heading.sort((a, b) => a.voyage.arriveYear - b.voyage.arriveYear);

  infoArrivals.replaceChildren();
  for (const state of heading) {
    const name = document.createElement('span');
    name.textContent = state.voyage.shipName;

    const eta = document.createElement('span');
    eta.className = 'comp-meta';
    eta.textContent = `ETA ${Math.floor(state.voyage.arriveYear)} · ${Math.round(state.progress * 100)}%`;

    const item = document.createElement('li');
    item.append(name, eta);
    infoArrivals.append(item);
  }
  infoInbound.hidden = false;
}

function showStar(star: Star | null): void {
  selectedStar = star;

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
      // "Mv" rather than "M", which would read as the spectral class of the same name.
      component.absMag === undefined ? spectral : `${spectral} · Mv ${component.absMag.toFixed(1)}`;

    const item = document.createElement('li');
    item.append(swatch, name, meta);
    infoComponents.append(item);
  }

  // Named worlds rather than stars — Ragnarok and Odin are places the books spend chapters in,
  // and without this they vanish from the map entirely once they stop being fake systems.
  infoWorlds.replaceChildren();
  for (const planet of star.planets ?? []) {
    const name = document.createElement('span');
    name.textContent = planet.name;

    const meta = document.createElement('span');
    meta.className = 'comp-meta';
    meta.textContent = planet.note ?? '';

    const item = document.createElement('li');
    item.append(name, meta);
    infoWorlds.append(item);
  }
  infoPlanets.hidden = (star.planets?.length ?? 0) === 0;

  infoNote.textContent = star.note ?? '';
  infoNote.hidden = star.note === undefined;
  renderPresence();
  renderInbound();
  infoPanel.hidden = false;
}

starfield.onSelect(showStar);
byId('info-close').addEventListener('click', () => starfield.select(null));

// ---------- Fleet list ----------

const fleetList = byId<HTMLUListElement>('fleet-list');
const systemsById = new Map(catalog.systems.map((star) => [star.id, star]));
/** Chips are reused across frames so scrubbing doesn't rebuild the DOM sixty times a second. */
const chips = new Map<string, { item: HTMLLIElement; status: HTMLSpanElement }>();

// The fleet runs to dozens of ships, so the row lists only the ones under way and keeps a
// running tally of the rest. Listing all of them would wallpaper the bottom of the screen.
const fleetSummary = document.createElement('li');
fleetSummary.className = 'fleet-item fleet-item--summary';
fleetList.append(fleetSummary);

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
    chip.item.hidden = state.phase !== 'transit';
    chip.status.textContent = `${Math.round(state.progress * 100)}%`;
  }

  const underWay = states.filter((state) => state.phase === 'transit').length;
  let inSystem = 0;
  for (const here of fleet.residents().values()) inSystem += here.length;

  const lost = new Set(
    states.filter((state) => state.phase === 'lost').map((state) => state.voyage.shipName),
  ).size;

  fleetSummary.textContent =
    `${underWay} under way · ${inSystem} in system` + (lost > 0 ? ` · ${lost} lost` : '');
}

// Clicking a chip flies the orbit centre to that ship — the only way to find one
// mid-transit without hunting for it.
fleetList.addEventListener('click', (event) => {
  const item = (event.target as HTMLElement).closest<HTMLLIElement>('.fleet-item');
  const id = item?.dataset.voyage;
  if (!id) return;

  const state = latestStates.find((candidate) => candidate.voyage.id === id);
  if (!state) return;

  const target = state.phase === 'pending' ? starfield.positions.get(state.voyage.originId) : state.position;
  if (target) viewer.focusOn(target);
});

// ---------- Family tree ----------

const treeYear = byId('tree-year');
const familyTree = createFamilyTree(bobs, {
  host: byId('tree-body'),
  panel: byId('tree-panel'),
  systemName,
});

byId('tree-count').textContent = String(bobs.length);
byId('tree-open').addEventListener('click', () => familyTree.toggle());
byId('tree-close').addEventListener('click', () => familyTree.close());

// Picking a Bob shows the system it was built in and flies there, which is the only link
// between a name in the tree and a point on the map.
familyTree.onSelect((bob) => {
  const star = systemsById.get(bob.atId);
  if (!star) return;
  starfield.select(bob.atId);
  const position = starfield.positions.get(bob.atId);
  if (position) viewer.focusOn(position);
  familyTree.close();
});

// ---------- Timeline ----------

const timeline = createTimeline(viewer, voyages);

function showYear(year: number): void {
  familyTree.setYear(year);
  treeYear.textContent = String(Math.floor(year));
}

timeline.onChange((year) => {
  latestStates = fleet.update(year);
  renderFleetList(latestStates);
  renderPresence();
  renderInbound();
  showYear(year);
});

// The timeline only emits on change, so paint the opening year explicitly.
latestStates = fleet.update(timeline.getYear());
renderFleetList(latestStates);
showYear(timeline.getYear());

viewer.start();
