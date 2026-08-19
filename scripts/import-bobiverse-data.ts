/**
 * Import the Bobiverse timeline from the bobiverse-map project.
 *
 * Source: https://github.com/thunfischtoast/bobiverse-map by Chris (thunfischtoast),
 * licensed CC BY-SA 4.0. That project is a single self-contained HTML file with its data
 * held in four JavaScript object literals; this script lifts them out and re-emits them as
 * typed TypeScript plus a voyage file this app can render.
 *
 * Their timeline was in turn compiled from community sources — see the attribution block
 * written into the generated files.
 *
 * Usage:
 *   curl -sL -o data-src/bobiverse-map.html \
 *     https://raw.githubusercontent.com/thunfischtoast/bobiverse-map/main/index.html
 *   node --experimental-strip-types scripts/import-bobiverse-data.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import type { BobReplicant, Star, TimelineEvent, Voyage } from '../src/types.ts';

const SOURCE_URL = 'https://github.com/thunfischtoast/bobiverse-map';

interface Options {
  html: string;
  stars: string;
  outData: string;
  outVoyages: string;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    html: 'data-src/bobiverse-map.html',
    stars: 'src/data/stars.json',
    outData: 'src/data/bobiverse.ts',
    outVoyages: 'src/data/voyages.json',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i + 1];
    switch (argv[i]) {
      case '--html': options.html = value; i += 1; break;
      case '--stars': options.stars = value; i += 1; break;
      case '--out-data': options.outData = value; i += 1; break;
      case '--out-voyages': options.outVoyages = value; i += 1; break;
      default: throw new Error(`Unknown argument "${argv[i]}"`);
    }
  }
  return options;
}

// ---------- Extraction ----------

/**
 * Pull one `const NAME = <literal>;` out of the source file.
 *
 * The literal is converted to JSON and parsed rather than evaluated: this is third-party
 * markup fetched over the network, and there is no reason to hand it the Node runtime.
 */
function extractLiteral(source: string, name: string): unknown {
  const marker = `const ${name} = `;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`Could not find "${name}" in the source file`);

  const open = start + marker.length;
  const closer = source[open] === '[' ? ']' : '}';
  const opener = source[open];

  let depth = 0;
  let end = -1;
  let inString: string | null = null;

  for (let i = open; i < source.length; i += 1) {
    const char = source[i];

    if (inString) {
      if (char === '\\') i += 1;
      else if (char === inString) inString = null;
      continue;
    }

    // Comments have to be skipped before quotes are counted: the source has section headers
    // like "// Khan's 82 Eridani strike force", whose apostrophe would otherwise open a string.
    if (char === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }

    if (char === '"' || char === "'") inString = char;
    else if (char === opener) depth += 1;
    else if (char === closer) {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end === -1) throw new Error(`Unterminated literal for "${name}"`);

  return JSON.parse(literalToJson(source.slice(open, end)));
}

/** Strip `//` comments, quote bare keys, drop trailing commas — enough for these literals. */
function literalToJson(literal: string): string {
  let stripped = '';
  let inString: string | null = null;

  for (let i = 0; i < literal.length; i += 1) {
    const char = literal[i];

    if (inString) {
      stripped += char;
      if (char === '\\') { stripped += literal[i + 1]; i += 1; }
      else if (char === inString) inString = null;
      continue;
    }

    // Comments first, for the same reason as in extractLiteral: an apostrophe in a section
    // header would otherwise be read as the start of a string.
    if (char === '/' && literal[i + 1] === '/') {
      while (i < literal.length && literal[i] !== '\n') i += 1;
      stripped += '\n';
      continue;
    }
    if (char === '"' || char === "'") { inString = char; stripped += char; continue; }
    stripped += char;
  }

  // Only bare keys and trailing commas separate these literals from JSON. Single-quoted
  // strings are deliberately *not* converted: the source uses double quotes throughout, and a
  // quote-swapping pass would mangle every apostrophe inside an event's text.
  return stripped
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/,(\s*[}\]])/g, '$1');
}

// ---------- Star mapping ----------

/**
 * Their star keys against ids in `src/data/stars.json`.
 *
 * Most are a rename away from the catalogue's own label — the books use the Bayer or Flamsteed
 * form where HYG carries the IAU proper name (Rana for δ Eridani, Tabit for π³ Orionis, Keid
 * for o² Eridani, which the books call 40 Eridani). Two of the source's entries are planets
 * rather than systems and resolve to the star they orbit.
 */
const STAR_IDS: Record<string, string> = {
  'Sol': 'sol',
  'Epsilon Eridani': 'epsilon-eridani',
  'Delta Eridani': 'delta-eridani',
  'Omicron2 Eridani': '40-eridani',
  'Alpha Centauri': 'alpha-centauri',
  '82 Eridani': '82-eridani',
  'Beta Hydri': 'beta-hydri',
  'Epsilon Indi': 'epsilon-indi',
  'Eta Cassiopeiae': 'eta-cassiopeiae',
  'Kappa Ceti': 'kappa-ceti',
  'Gamma Leporis A': 'gamma-leporis',
  'GL 877': 'gliese-877',
  'Gliese 54': 'gliese-54',
  'Delta Pavonis': 'delta-pavonis',
  'Gamma Pavonis': 'gamma-pavonis',
  'HIP 14101': 'hip-14101',
  'HIP 84051': 'hip-84051',
  // The source map plots these two as systems of their own, but they are planets: Ragnarok is
  // the terraformed world at Epsilon Eridani and Odin the gas giant at HIP 14101. They map to
  // their host stars, and `catalog-overlay.json` carries them as that system's named worlds.
  'Ragnarok': 'epsilon-eridani',
  'Odin': 'hip-14101',
  'Zeta Tucanae': 'zeta-tucanae',
  'Pi3 Orionis': 'pi3-orionis',
};

// ---------- Source shapes ----------

interface SourceBob {
  gen: number;
  parent: string | null;
  created: number;
  at: string;
  destroyed: number | null;
  book: number;
}

interface SourceTravel {
  bob: string;
  from: string;
  depart: number;
  to: string;
  arrive: number;
  book: number;
}

interface SourceEvent {
  year: number;
  text: string;
  bob?: string;
  book: number;
}

// ---------- Build ----------

const options = parseArgs(process.argv.slice(2));
const html = readFileSync(options.html, 'utf8');

const sourceStars = extractLiteral(html, 'ALL_STARS') as Record<string, { name: string }>;
const sourceBobs = extractLiteral(html, 'ALL_BOBS') as Record<string, SourceBob>;
const sourceTravels = extractLiteral(html, 'ALL_TRAVELS') as SourceTravel[];
const sourceEvents = extractLiteral(html, 'ALL_EVENTS') as SourceEvent[];

const catalogIds = new Set<string>(
  (JSON.parse(readFileSync(options.stars, 'utf8')).systems as Star[]).map((system) => system.id),
);

const unmapped = Object.keys(sourceStars).filter((key) => !STAR_IDS[key]);
if (unmapped.length > 0) {
  throw new Error(
    `The source has systems this importer does not know: ${unmapped.join(', ')}. ` +
      `Add them to STAR_IDS, and to catalog-overlay.json if the catalogue lacks them.`,
  );
}

const dangling = Object.entries(STAR_IDS).filter(([, id]) => !catalogIds.has(id));
if (dangling.length > 0) {
  throw new Error(
    `These systems are mapped to catalogue ids that do not exist:\n` +
      dangling.map(([key, id]) => `  ${key} -> ${id}`).join('\n'),
  );
}

function systemId(key: string): string {
  const id = STAR_IDS[key];
  if (!id) throw new Error(`No catalogue id for system "${key}"`);
  return id;
}

const slugify = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Voyage ids flown without a deceleration burn. The source timeline has no notion of a flight
 * profile, so this stays here to survive a re-import.
 */
const NO_DECELERATION = new Set(['icarus-to-gliese-877', 'daedalus-to-gliese-877']);

const usedIds = new Set<string>();
const voyages: Voyage[] = sourceTravels.map((travel) => {
  let id = `${slugify(travel.bob)}-to-${systemId(travel.to)}`;
  let suffix = 2;
  while (usedIds.has(id)) { id = `${slugify(travel.bob)}-to-${systemId(travel.to)}-${suffix}`; suffix += 1; }
  usedIds.add(id);

  return {
    id,
    shipName: travel.bob,
    originId: systemId(travel.from),
    destinationId: systemId(travel.to),
    departYear: travel.depart,
    arriveYear: travel.arrive,
    ...(NO_DECELERATION.has(id) ? { noDeceleration: true } : {}),
  };
});

const bobs: BobReplicant[] = Object.entries(sourceBobs).map(([name, bob]) => ({
  name,
  gen: bob.gen,
  parent: bob.parent,
  created: bob.created,
  atId: systemId(bob.at),
  destroyed: bob.destroyed,
  book: bob.book,
}));

const events: TimelineEvent[] = sourceEvents.map((event) => ({
  year: event.year,
  text: event.text,
  ...(event.bob ? { bob: event.bob } : {}),
  book: event.book,
}));

// ---------- Write ----------

const today = new Date().toISOString().slice(0, 10);

const ATTRIBUTION = [
  `Imported on ${today} from the bobiverse-map project by Chris (thunfischtoast),`,
  `${SOURCE_URL}, licensed CC BY-SA 4.0 — as is this file and src/data/voyages.json.`,
  '',
  'That project compiled the timeline from community sources: two Bobiverse timeline',
  'pastebins (ZcKub4Fc, qwfY3PMU), the Bobiverse Fandom wiki, and the Bob family trees at',
  'github.com/eneko/Bobiverse and github.com/sbtn/treeofbob. The underlying story is',
  "Dennis E. Taylor's Bobiverse novels.",
].join('\n');

// Every system the source map plots, catalogue-side. This is a superset of the travel
// endpoints: the books reach places no route leg ends at. Deduplicated because two of the
// source's "systems" are planets that resolve to a star already in the list.
const systemIds = [...new Set(Object.keys(sourceStars).map(systemId))].sort();

const dataFile = `/**
 * The Bobiverse timeline: every replicant and every dated event from books 1-3.
 *
 * GENERATED by scripts/import-bobiverse-data.ts — do not edit by hand.
 *
${ATTRIBUTION.split('\n').map((line) => ` * ${line}`.trimEnd()).join('\n')}
 *
 * Years are fractional. \`atId\` values are \`Star.id\` keys from src/data/stars.json.
 */

import type { BobReplicant, TimelineEvent } from '../types';

/** \`Star.id\` of every system the books reach, whether or not a voyage ends there. */
export const systemIds: string[] = ${JSON.stringify(systemIds, null, 2)};

export const bobs: BobReplicant[] = ${JSON.stringify(bobs, null, 2)};

export const events: TimelineEvent[] = ${JSON.stringify(events, null, 2)};
`;

writeFileSync(options.outData, dataFile);

writeFileSync(
  options.outVoyages,
  `${JSON.stringify(
    {
      meta: {
        source: SOURCE_URL,
        license: 'CC BY-SA 4.0',
        generated: today,
        provenance: ATTRIBUTION.replace(/\n/g, ' ').replace(/\s+/g, ' '),
      },
      voyages,
    },
    null,
    2,
  )}\n`,
);

console.log(`Systems referenced:  ${systemIds.length}`);
console.log(`Voyages:             ${voyages.length}`);
console.log(`Bobs:                ${bobs.length}`);
console.log(`Events:              ${events.length}`);
console.log(
  `Timeline span:       ${Math.min(...voyages.map((v) => v.departYear))} - ${Math.max(...voyages.map((v) => v.arriveYear))}`,
);
console.log(`\nWrote ${options.outData} and ${options.outVoyages}`);
