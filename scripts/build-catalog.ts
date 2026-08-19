/**
 * Rebuild `src/data/stars.json` from the HYG database.
 *
 * HYG (Hipparcos-Yale-Gliese, https://codeberg.org/astronexus/hyg, CC BY-SA 4.0) is a merged
 * star catalogue whose rows are individual *stars*. This map wants *systems*, so the bulk of
 * the work here is grouping components back together and picking a display name for each group.
 *
 * HYG is not the whole story inside 25 ly: it inherits Gliese-Jahreiss, so the brown dwarfs
 * discovered by WISE/2MASS are simply absent. Those live in `src/data/catalog-overlay.json`,
 * which also supplies curated system names, stable ids (voyages reference them) and notes.
 *
 * Run with Node's built-in TypeScript stripping — no build step, no extra dependency:
 *   node --experimental-strip-types scripts/build-catalog.ts --csv path/to/hygdata_v41.csv
 *
 * Not covered by `npm run typecheck`: tsconfig only includes `src`, and typechecking this
 * would drag in @types/node for a single build tool.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import type { Star, StarComponent } from '../src/types.ts';

const LY_PER_PC = 3.2615637769;
/** Two catalogue rows closer than this are treated as one system. */
const MERGE_RADIUS_LY = 0.3;

// ---------- Arguments ----------

interface Options {
  csv: string;
  overlay: string;
  out: string;
  horizonLy: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    csv: '',
    overlay: 'src/data/catalog-overlay.json',
    out: 'src/data/stars.json',
    // Wide enough to hold every system the Bobiverse fleet actually visits — the furthest,
    // HIP 84051, sits at 33 ly. Vega (25.04) and Fomalhaut (25.13) come along for free.
    horizonLy: 35,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--csv': options.csv = value; i += 1; break;
      case '--overlay': options.overlay = value; i += 1; break;
      case '--out': options.out = value; i += 1; break;
      case '--horizon': options.horizonLy = Number(value); i += 1; break;
      case '--dry-run': options.dryRun = true; break;
      default:
        throw new Error(`Unknown argument "${flag}"`);
    }
  }

  if (!options.csv) {
    throw new Error('Usage: build-catalog.ts --csv <hygdata.csv> [--out <file>] [--horizon <ly>] [--dry-run]');
  }
  return options;
}

// ---------- CSV ----------

/** Minimal RFC 4180 reader — HYG quotes any field containing a comma, e.g. some `bf` values. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (char !== '\r') field += char;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  const header = rows.shift();
  if (!header) throw new Error('CSV is empty');

  const required = ['id', 'hip', 'hd', 'gl', 'bf', 'proper', 'ra', 'dec', 'dist', 'absmag', 'spect', 'comp_primary', 'base'];
  for (const column of required) {
    if (!header.includes(column)) throw new Error(`CSV is missing the "${column}" column — is this an HYG file?`);
  }

  return rows
    .filter((cells) => cells.length === header.length)
    .map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index]])));
}

// ---------- Grouping ----------

interface Row {
  id: string;
  hip: string;
  hd: string;
  gl: string;
  bf: string;
  proper: string;
  ra: number;
  dec: number;
  distLy: number;
  absMag: number | undefined;
  spectral: string;
  compPrimary: string;
  base: string;
  x: number;
  y: number;
  z: number;
}

/** Union-find over row indices; systems are whatever ends up in the same set. */
function makeUnionFind(size: number) {
  const parent = Array.from({ length: size }, (_, i) => i);

  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }

  return {
    find,
    union(a: number, b: number): void {
      const rootA = find(a);
      const rootB = find(b);
      if (rootA !== rootB) parent[rootB] = rootA;
    },
  };
}

/**
 * HYG pads Bayer/Flamsteed fields to fixed width ("61    Cyg"), runs the Flamsteed number
 * into the Bayer letter ("30Mu Cas"), and abbreviates Gliese.
 */
function tidyName(name: string): string {
  return name
    .replace(/\s+/g, ' ')
    .replace(/^(\d+)([A-Za-z])/, '$1 $2')
    .replace(/^Gl (?=\d)/, 'Gliese ')
    .trim();
}

function componentName(row: Row): string {
  if (row.proper) return tidyName(row.proper);
  if (row.bf) return tidyName(row.bf);
  if (row.gl) return tidyName(row.gl);
  if (row.hd) return `HD ${row.hd}`;
  if (row.hip) return `HIP ${row.hip}`;
  return `HYG ${row.id}`;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'system';
}

const round = (value: number, places: number): number => Number(value.toFixed(places));

// ---------- Build ----------

const options = parseArgs(process.argv.slice(2));

const rows: Row[] = parseCsv(readFileSync(options.csv, 'utf8'))
  .map((record) => ({
    id: record.id,
    hip: record.hip,
    hd: record.hd,
    gl: record.gl,
    bf: record.bf.trim(),
    proper: record.proper.trim(),
    ra: Number(record.ra),
    dec: Number(record.dec),
    distLy: Number(record.dist) * LY_PER_PC,
    absMag: record.absmag === '' ? undefined : Number(record.absmag),
    spectral: record.spect.trim(),
    compPrimary: record.comp_primary,
    base: record.base.trim(),
    x: Number(record.x) * LY_PER_PC,
    y: Number(record.y) * LY_PER_PC,
    z: Number(record.z) * LY_PER_PC,
  }))
  // HYG parks stars with no usable parallax at 100000 pc; anything past the horizon goes too.
  .filter((row) => Number.isFinite(row.distLy) && row.distLy <= options.horizonLy);

const byRowId = new Map(rows.map((row, index) => [row.id, index]));
const union = makeUnionFind(rows.length);

for (let i = 0; i < rows.length; i += 1) {
  const row = rows[i];

  // Declared multiples: HYG points every component at its primary's row id.
  const primaryIndex = byRowId.get(row.compPrimary);
  if (primaryIndex !== undefined && primaryIndex !== i) union.union(primaryIndex, i);
}

// Wide pairs catalogued independently (Proxima against α Cen A/B is the notable one inside
// 25 ly) share no primary, so fall back to physical separation. At this radius nothing
// unrelated comes within a third of a light-year.
for (let i = 0; i < rows.length; i += 1) {
  for (let j = i + 1; j < rows.length; j += 1) {
    const dx = rows[i].x - rows[j].x;
    const dy = rows[i].y - rows[j].y;
    const dz = rows[i].z - rows[j].z;
    if (dx * dx + dy * dy + dz * dz < MERGE_RADIUS_LY * MERGE_RADIUS_LY) union.union(i, j);
  }
}

const groups = new Map<number, number[]>();
for (let i = 0; i < rows.length; i += 1) {
  const root = union.find(i);
  const members = groups.get(root);
  if (members) members.push(i);
  else groups.set(root, [i]);
}

/** Brightest member drives the system's name, colour and catalogue position. */
function primaryOf(members: number[]): Row {
  return members
    .map((index) => rows[index])
    .reduce((best, row) => ((row.absMag ?? Infinity) < (best.absMag ?? Infinity) ? row : best));
}

const systems: Star[] = [];
const usedIds = new Set<string>();

for (const members of groups.values()) {
  const primary = primaryOf(members);

  let id = slugify(componentName(primary));
  let suffix = 2;
  while (usedIds.has(id)) { id = `${slugify(componentName(primary))}-${suffix}`; suffix += 1; }
  usedIds.add(id);

  const components: StarComponent[] = members
    .map((index) => rows[index])
    .sort((a, b) => (a.absMag ?? Infinity) - (b.absMag ?? Infinity))
    .map((row) => {
      const component: StarComponent = { name: componentName(row), spectral: row.spectral };
      if (row.absMag !== undefined) component.absMag = round(row.absMag, 2);
      return component;
    });

  systems.push({
    id,
    name: componentName(primary),
    ra: round(primary.ra, 4),
    dec: round(primary.dec, 4),
    distanceLy: round(primary.distLy, 3),
    components,
  });
}

// ---------- Overlay ----------

/**
 * An overlay entry.
 *
 * Astrometry is optional: an entry that resolves to a HYG system only contributes identity, and
 * HYG supplies the numbers. Carrying an entry HYG has never heard of does need coordinates, and
 * the build fails if they are missing. Keeping them optional stops stale hand-authored positions
 * from lingering next to the catalogue values that replaced them.
 */
type OverlayStar = Pick<Star, 'id' | 'name'> &
  Partial<Star> & {
    /** HYG designation to match on, when neither the id nor the name resolves it. */
    hygMatch?: string;
  };

interface Overlay {
  /** Hand-authored systems, matched to HYG by designation then position, else carried as-is. */
  systems: OverlayStar[];
}

const overlay: Overlay = JSON.parse(readFileSync(options.overlay, 'utf8'));

/** Cartesian position of a catalogue record, matching `src/astro.ts`. */
function cartesian(star: Star): [number, number, number] {
  const ra = star.ra * (Math.PI / 12);
  const dec = star.dec * (Math.PI / 180);
  const cosDec = Math.cos(dec);
  return [
    star.distanceLy * cosDec * Math.cos(ra),
    star.distanceLy * cosDec * Math.sin(ra),
    star.distanceLy * Math.sin(dec),
  ];
}

const builtPositions = systems.map(cartesian);

/**
 * Index every designation a built system answers to: its generated id, its display name, and
 * each component name. Designation beats geometry for matching because the overlay's
 * coordinates are exactly what this rebuild exists to replace — several were off by an hour
 * of right ascension or a couple of light-years, far outside any sane match radius.
 */
const byDesignation = new Map<string, number>();
for (let i = 0; i < systems.length; i += 1) {
  const keys = [systems[i].id, slugify(systems[i].name), ...systems[i].components.map((c) => slugify(c.name))];
  for (const key of keys) if (!byDesignation.has(key)) byDesignation.set(key, i);
}

const claimed = new Set<number>();
const renamed: string[] = [];
const carried: string[] = [];
const matchedByPosition: string[] = [];

for (const entry of overlay.systems) {
  const positioned =
    entry.ra !== undefined && entry.dec !== undefined && entry.distanceLy !== undefined;
  const [ox, oy, oz] = positioned ? cartesian(entry as Star) : [NaN, NaN, NaN];

  let match = -1;
  for (const key of [entry.hygMatch ? slugify(tidyName(entry.hygMatch)) : '', entry.id, slugify(entry.name)]) {
    if (!key) continue;
    const candidate = byDesignation.get(key);
    if (candidate !== undefined && !claimed.has(candidate)) { match = candidate; break; }
  }

  // Systems HYG names differently (Gliese numbers where the overlay uses a proper name) still
  // resolve on position, which is what the match radius is for.
  if (match === -1 && positioned) {
    let nearestDistance = MERGE_RADIUS_LY;
    for (let i = 0; i < systems.length; i += 1) {
      if (claimed.has(i)) continue;
      const [x, y, z] = builtPositions[i];
      const distance = Math.hypot(x - ox, y - oy, z - oz);
      if (distance < nearestDistance) { nearestDistance = distance; match = i; }
    }
    if (match !== -1) matchedByPosition.push(`${entry.name} -> ${systems[match].name} (${nearestDistance.toFixed(3)} ly apart)`);
  }

  if (match === -1) {
    const { hygMatch: _ignored, ...carriedStar } = entry;
    systems.push(carriedStar as Star);
    builtPositions.push([ox, oy, oz]);
    // Report the closest thing HYG does have, so a "missing" dwarf that is really a naming
    // mismatch shows up as a suspiciously close neighbour instead of silently duplicating.
    let nearestName = 'nothing';
    let nearestGap = Infinity;
    for (let i = 0; i < systems.length; i += 1) {
      const [x, y, z] = builtPositions[i];
      const gap = Math.hypot(x - ox, y - oy, z - oz);
      if (gap < nearestGap && systems[i].id !== entry.id) { nearestGap = gap; nearestName = systems[i].name; }
    }
    carried.push(`${entry.name} (${entry.distanceLy} ly) — nearest HYG system: ${nearestName} at ${nearestGap.toFixed(2)} ly`);
    continue;
  }

  // HYG owns the astrometry; the overlay owns identity and prose.
  claimed.add(match);
  const system = systems[match];
  if (system.id !== entry.id) renamed.push(`${system.name} (${system.id}) -> ${entry.name} (${entry.id})`);
  system.id = entry.id;
  system.name = entry.name;
  if (entry.note) system.note = entry.note;
}

systems.sort((a, b) => a.distanceLy - b.distanceLy);

// ---------- Validation ----------

const duplicateIds = systems.map((s) => s.id).filter((id, index, all) => all.indexOf(id) !== index);
if (duplicateIds.length > 0) {
  for (const id of new Set(duplicateIds)) {
    console.error(`id "${id}" claimed by:`);
    for (const system of systems.filter((s) => s.id === id)) {
      console.error(`   ${system.name} @ ${system.distanceLy} ly ra=${system.ra} dec=${system.dec} [${system.components.map((c) => c.name).join(', ')}]`);
    }
  }
  throw new Error(`Duplicate system ids: ${[...new Set(duplicateIds)].join(', ')}`);
}

const ids = new Set(systems.map((system) => system.id));
const voyages: { shipName: string; originId: string; destinationId: string }[] =
  JSON.parse(readFileSync('src/data/voyages.json', 'utf8')).voyages;

const dangling = voyages.filter((v) => !ids.has(v.originId) || !ids.has(v.destinationId));
if (dangling.length > 0) {
  throw new Error(
    `These voyages would break — add the missing systems to the overlay so their ids survive:\n` +
      dangling.map((v) => `  ${v.shipName}: ${v.originId} -> ${v.destinationId}`).join('\n'),
  );
}

// ---------- Report and write ----------

let previous: Star[] = [];
try {
  previous = JSON.parse(readFileSync(options.out, 'utf8')).systems;
} catch { /* first run */ }

const previousIds = new Set(previous.map((system) => system.id));
const added = systems.filter((system) => !previousIds.has(system.id));
const removed = previous.filter((system) => !ids.has(system.id));

console.log(`HYG rows within ${options.horizonLy} ly: ${rows.length}`);
console.log(`Systems after grouping:      ${groups.size}`);
console.log(`Overlay matched on position:  ${matchedByPosition.length}`);
for (const line of matchedByPosition) console.log(`  ~ ${line}`);
console.log(`Carried from overlay (not in HYG): ${carried.length}`);
for (const name of carried) console.log(`  + ${name}`);
console.log(`Renamed by overlay:          ${renamed.length}`);
console.log(`Total systems:               ${systems.length}`);
console.log(`New since last build:        ${added.length}`);
for (const system of added) console.log(`  + ${system.name} (${system.distanceLy} ly)`);
console.log(`Gone since last build:       ${removed.length}`);
for (const system of removed) console.log(`  - ${system.name} (${system.distanceLy} ly)`);

const catalog = {
  meta: {
    horizonLy: options.horizonLy,
    epoch: 'J2000',
    provenance:
      `Generated by scripts/build-catalog.ts on ${new Date().toISOString().slice(0, 10)} from the HYG database ` +
      `(https://codeberg.org/astronexus/hyg, CC BY-SA 4.0), merged with src/data/catalog-overlay.json for ` +
      `system names, stable ids, notes, and the WISE/2MASS brown dwarfs that HYG's Gliese-Jahreiss lineage ` +
      `predates. Components within ${MERGE_RADIUS_LY} ly of one another are grouped into a single system. ` +
      `Do not hand-edit: rerun the script instead.`,
  },
  systems,
};

if (options.dryRun) {
  console.log('\n--dry-run: nothing written.');
} else {
  writeFileSync(options.out, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`\nWrote ${options.out}`);
}
