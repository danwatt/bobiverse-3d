# Bobiverse

A 3D map of the star systems within ~25 light-years of the Sun, with a timeline that flies named
ships between them.

Drag to orbit, scroll to zoom, right-drag to pan. Click a star for its components and distance.
Scrub or play the timeline at the bottom to watch each ship move along a straight line between its
origin and destination at constant speed. Click a ship's chip in the fleet row to centre the view
on it.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Typecheck, then bundle to `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
| `npm run typecheck` | `tsc --noEmit` over `src/` |
| `npm run catalog` | Regenerate `src/data/stars.json` from the HYG catalogue (see below) |

`npm run build` output in `dist/` is a set of static files — any static host will serve it, no
server-side anything.

## Data and attribution

Star positions come from the **HYG database** (v4.4) by David Nash / astronexus:

- <https://codeberg.org/astronexus/hyg>
- Licensed **CC BY-SA 4.0**

HYG itself merges the Hipparcos catalogue, the Yale Bright Star Catalogue (5th ed.), and the
Gliese-Jahreiss Catalogue of Nearby Stars (3rd ed.).

Because `src/data/stars.json` is generated from HYG, **it is a derivative work and carries the same
CC BY-SA 4.0 licence**. Keep this attribution with it if you redistribute the data or a build that
embeds it.

`src/data/catalog-overlay.json` is hand-authored from published values. It supplies display names,
stable ids, notes, and the ten systems HYG's Gliese-Jahreiss lineage predates — the WISE, 2MASS,
DENIS, UGPS and SCR brown dwarfs (Luhman 16, WISE 0855−0714, Teegarden's Star, and so on). Those
ten entries carry hand-entered coordinates; everything else in the map is HYG's astrometry.

## Rebuilding the star catalogue

The source CSV is ~32 MB, so it lives in the gitignored `data-src/` rather than in the repo:

```bash
mkdir -p data-src
curl -sL -o data-src/hyg_v44.csv.gz \
  https://codeberg.org/astronexus/hyg/media/branch/main/data/hyg/CURRENT/hyg_v44.csv.gz
gunzip data-src/hyg_v44.csv.gz

npm run catalog -- --dry-run   # report only, writes nothing
npm run catalog                # writes src/data/stars.json
```

Needs Node 22+ (the script runs through Node's built-in TypeScript stripping, so there is no build
step and no extra dependency). Flags: `--csv`, `--overlay`, `--out`, `--horizon`, `--dry-run`.

### What the script does

1. Filters HYG rows to those within the horizon (25.2 ly by default — Vega at 25.05 and Fomalhaut
   at 25.13 sit just outside a strict 25, and a nearby-stars map missing Vega reads as broken).
2. Groups rows into *systems*: HYG rows are individual stars, so components are united by their
   declared primary, then by physical separation under 0.3 ly. That second pass is what puts
   Proxima in the same system as α Cen A/B, since HYG catalogues them independently.
3. Applies the overlay, matching each entry to a HYG system **by designation first, position
   second**. Designation wins because the overlay's own coordinates are exactly what the rebuild
   replaces. Entries with no HYG counterpart are carried through as-is.
4. Fails the build on duplicate ids, or if any voyage in `src/data/voyages.json` would lose an
   endpoint.

### Reading the report

Every run prints the identifications it made. Two sections deserve a human eye:

- **Overlay matched on position** — these were resolved by proximity alone, so each line is an
  assertion that two records are the same star. Check them after editing the overlay.
- **Carried from overlay (not in HYG)** — each line names the nearest system HYG *does* have. A
  neighbour under about 1 ly usually means a naming mismatch rather than a missing star, and
  leaving it alone would put the same object on the map twice. Fix by adding a `hygMatch` field
  naming the HYG designation, or by dropping the overlay entry and letting HYG's record stand.

## Conventions

- One world unit is one light-year; the Sun is at the origin.
- Catalogue positions are stored as equatorial RA (hours), Dec (degrees) and distance, and
  converted in `src/astro.ts` — not pre-baked as cartesian — so the values stay diffable against a
  published catalogue.
- Three.js is Y-up, so the equatorial frame `(x, y, z)` is remapped to `(x, z, -y)`. Celestial
  north points at +Y and the reference grid lies in the equatorial plane.

## Layout

```
index.html                    markup and every DOM id the app queries
src/main.ts                   bootstrap and UI wiring
src/scene.ts                  renderer, camera, controls, label overlay, render loop
src/starfield.ts              star point cloud, labels, hover/click picking
src/refGrid.ts                equatorial grid, distance rings, polar axis
src/fleet.ts                  voyage routes and ship markers
src/timeline.ts               year state and transport controls
src/astro.ts                  coordinate, colour and magnitude conversions
src/data/stars.json           generated — do not hand-edit
src/data/catalog-overlay.json hand-authored names, ids, notes, non-HYG systems
src/data/voyages.json         the fleet
scripts/build-catalog.ts      catalogue generator
```

## Editing the fleet

Voyages live in `src/data/voyages.json` and are read at load — there is no in-app editor. Each
entry is a ship flying a straight line at constant speed:

```json
{
  "id": "bob-1",
  "shipName": "Bob-1",
  "originId": "sol",
  "destinationId": "epsilon-eridani",
  "departYear": 2133,
  "arriveYear": 2145
}
```

`originId` and `destinationId` are `id` values from `src/data/stars.json`; `npm run catalog` fails
loudly if a rebuild would leave one dangling. The timeline's range is derived from the fleet — five
years either side of the earliest departure and latest arrival — so adding a voyage widens it
automatically. Nothing stops a ship exceeding light speed; the seed fleet stays between 0.3c and
0.9c by hand.

## Limits

- Travel is linear and non-relativistic — constant speed along a straight line, no time dilation.
- Coverage thins out for very faint late-M, L, T and Y dwarfs. The ten in the overlay are the known
  ones, not a complete census.
