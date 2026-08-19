# Bobiverse

A 3D map of the star systems within 35 light-years of the Sun, with a timeline that flies the
Bobiverse fleet between them.

Drag to orbit, scroll to zoom, right-drag to pan. Click a star for its components and distance.
Routes appear only once a voyage has departed, so the map fills in as the timeline runs rather
than showing every future leg at once. A ship under way is a cone pointing down its route; once it
lands, the cone goes and its destination gains a ring with a count of the Bobs sitting there.
Selecting a system lists them by name in the top-right panel, with the year each arrived. The **Label** control picks which systems show a name: **Major** (bright landmarks and everything
inside 11 ly), **Book** (only the systems the books reach), or **All**. Hovering or selecting a
star names it whatever the mode.
Scrub or play the timeline at the bottom to watch each Bob move along a straight line between its
origin and destination, accelerating to the midpoint and decelerating into the arrival. The fleet
row lists whoever is under way at that moment;
click a chip to centre the view on that ship.

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
| `npm run import-timeline` | Regenerate the fleet and timeline data from the bobiverse-map project |

`npm run build` output in `dist/` is a set of static files — any static host will serve it, no
server-side anything.

## Prior art

The Bobiverse timeline in this map is not original work. It comes from
**[bobiverse-map](https://github.com/thunfischtoast/bobiverse-map)** by Chris (thunfischtoast) —
a 2D canvas star map and timeline viewer for books 1-3, with spoiler gating by chapter, a Bob
lineage tree, and an event log. It is a single self-contained HTML file with no build step, and
worth looking at on its own terms.

This project renders the same events in 3D against a survey catalogue. Where the two disagree on
where a star is, the catalogue wins; where they disagree on when something happened, their
timeline wins.

## Data and attribution

**Timeline, fleet and replicant data** — from
[bobiverse-map](https://github.com/thunfischtoast/bobiverse-map) by Chris (thunfischtoast),
licensed **CC BY-SA 4.0**. That project compiled it from community sources: two Bobiverse
timeline pastebins, the [Bobiverse Fandom wiki](https://bobiverse.fandom.com/wiki/Bobiverse_Wiki),
and the Bob family trees at [eneko/Bobiverse](https://github.com/eneko/Bobiverse) and
[sbtn/treeofbob](https://github.com/sbtn/treeofbob). The underlying story is Dennis E. Taylor's
Bobiverse novels. `src/data/voyages.json` and `src/data/bobiverse.ts` are derived from it and
carry the same CC BY-SA 4.0 licence.

**Star positions** — from the **HYG database** (v4.4) by David Nash / astronexus:

- <https://codeberg.org/astronexus/hyg>
- Licensed **CC BY-SA 4.0**

HYG itself merges the Hipparcos catalogue, the Yale Bright Star Catalogue (5th ed.), and the
Gliese-Jahreiss Catalogue of Nearby Stars (3rd ed.).

Because `src/data/stars.json` is generated from HYG, **it is a derivative work and carries the same
CC BY-SA 4.0 licence**. Keep this attribution with it if you redistribute the data or a build that
embeds it.

`src/data/catalog-overlay.json` is hand-authored. It supplies display names, stable ids, notes,
and the systems the catalogue cannot provide:

- Ten post-Gliese brown dwarfs HYG's lineage predates — the WISE, 2MASS, DENIS, UGPS and SCR
  objects (Luhman 16, WISE 0855−0714, Teegarden's Star, and so on).
- Eta Leporis, a real HYG row carried by hand because 48.5 ly puts it past the build horizon.

Those eleven carry hand-entered coordinates. Everything else on the map is HYG's astrometry.

The overlay also names the two *planets* the books spend time on — Ragnarok at Epsilon Eridani and
Odin at HIP 14101 — under their host system's `planets`. The source map plots both as systems of
their own, which they are not; a system is a single point at this scale, so they show up in the
info panel instead of on the map.

Both data sources are CC BY-SA 4.0, so a build of this app redistributes CC BY-SA material — the
credit line in the top-left panel and the provenance strings inside the data files exist to keep
that attribution attached.

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

1. Filters HYG rows to those within the horizon (45 ly by default — wide enough to reach every
   system the fleet visits, the furthest being HIP 84051 at 40.7 ly; everywhere else fits in 35).
2. Groups rows into *systems*: HYG rows are individual stars, so components are united by their
   declared primary, then by physical separation under 0.3 ly. That second pass is what puts
   Proxima in the same system as α Cen A/B, since HYG catalogues them independently.
   Around 640 systems survive.
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
- Sagittarius A* is drawn at its true position: RA 17h 45m, Dec −29°, 26,700 ly out (GRAVITY
  collaboration, 2019). That is three orders of magnitude beyond the catalogue, so the entire
  50 ly of stars sits in a pixel of the way there — which is the honest picture. Two knock-on
  requirements: the camera's far plane runs to 40,000 ly, because `CSS2DRenderer` drops the label
  of anything outside the clip range, and the marker draws without size attenuation or depth
  testing, since at that range the depth buffer has saturated. It is always on screen: no display
  toggle and no label mode hides it.

## Layout

```
index.html                    markup and every DOM id the app queries
src/main.ts                   bootstrap and UI wiring
src/scene.ts                  renderer, camera, controls, label overlay, render loop
src/starfield.ts              star point cloud, labels, hover/click picking
src/refGrid.ts                equatorial grid, distance rings, polar axis
src/galacticCenter.ts         Sagittarius A* at true distance
src/backgroundStars.ts        backdrop field beyond the catalogue
src/fleet.ts                  voyage routes and ship markers
src/timeline.ts               year state and transport controls
src/astro.ts                  coordinate, colour and magnitude conversions
src/data/stars.json           generated — do not hand-edit
src/data/catalog-overlay.json hand-authored names, ids, notes, non-HYG systems
src/data/voyages.json         generated — the fleet
src/data/bobiverse.ts         generated — replicants and events
scripts/build-catalog.ts      catalogue generator
scripts/import-bobiverse-data.ts  timeline importer
```

## Rebuilding the timeline

`src/data/voyages.json` (58 voyages) and `src/data/bobiverse.ts` (69 replicants, 80 events) are
generated — there is no in-app editor:

```bash
curl -sL -o data-src/bobiverse-map.html \
  https://raw.githubusercontent.com/thunfischtoast/bobiverse-map/main/index.html
npm run import-timeline
```

The importer lifts four object literals out of that HTML, maps its 21 system names onto catalogue
ids, and fails loudly if the source names a system it cannot place. It parses the literals rather
than evaluating them — that file is third-party markup fetched over the network, and it has no
business touching the Node runtime.

Its star-name mapping is worth knowing about: the books use the Bayer or Flamsteed form where the
catalogue carries the IAU proper name. Delta Eridani is Rana, Pi3 Orionis is Tabit, and Omicron2
Eridani is 40 Eridani (Keid). The mapping is an explicit table in
`scripts/import-bobiverse-data.ts`, not fuzzy matching.

`src/data/bobiverse.ts` exports `systemIds`, the 19 systems the imported timeline covers — every
voyage endpoint, plus Epsilon Eridani and HIP 14101, which the story reaches by planet (Ragnarok
and Odin) rather than by a route leg ending there. The `bobs` table supplies each replicant's
`destroyed` year, which is what stops the presence rings from accumulating Bobs the books killed
off. The `events` table is imported but not yet displayed — it is there for a future event log.

The **Book** label mode is that list plus every catalogue system flagged `inBooks` in
`catalog-overlay.json`. That flag exists for places the books go that the imported timeline knows
nothing about, because no ship in the table flies there: Eta Leporis, the Quinlan home system, is
the current example. Adding another is one field in the overlay and a rebuild.

### Faster-than-light voyages

Thirty-four of the 58 legs are superluminal at face value: Khan's strike force covers the 12.4 ly
from Epsilon Eridani to 82 Eridani in 3.3 years. That is not an import bug — 35 legs are
superluminal against the source project's own coordinates too. In the books, Bobs move between
systems by SCUT transmission once it exists, so a "voyage" after ~2151 is often a matter transfer
rather than a journey. The map draws every leg the same way: a straight line between departure and
arrival, flown on the same acceleration profile.

### Flight profile

Ships fly "flip and burn": constant acceleration to the halfway point, flip, then decelerate into
the destination and arrive at rest. Distance goes as ½at² out of the origin and mirrors that coming
in, so a ship is only a quarter of the way along at the halfway year — the marker crawls at both
ends of its route and sprints through the middle.

Two voyages set `noDeceleration` in `src/data/voyages.json` and never flip: Icarus and Daedalus,
which hit Gliese 877 at speed because they are weapons, not travellers. With their departure and
arrival years fixed by the timeline, burning the whole way instead of half of it implies half the
acceleration of a ship that flips — the same order of burn, all of it spent on getting there.

## Limits

- Travel is non-relativistic: a fixed acceleration along a straight line, no time dilation, and
  arrival years come from the timeline rather than from any real thrust figure. See the note on
  faster-than-light legs above.
- Coverage thins out for very faint late-M, L, T and Y dwarfs. The ten in the overlay are the known
  ones inside 25 ly, not a complete census, and nothing hand-fills the gap out to 45 ly.
- Only ships under way are drawn individually — a named cone on its route. Ships that have landed
  are counted, not drawn: dozens of them stack on the same handful of stars, and the labels alone
  would bury the systems underneath.
- Presence comes from both tables: a Bob sits at the system it was built in until its first
  departure, then at wherever it last landed, and drops off the map entirely once the books
  destroy it.
- The event table is imported but unused; there is no event log yet.
