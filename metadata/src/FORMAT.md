# BEACON input-dataset metadata format (v0.2.0)

This is BEACON's inventory of forecast, analysis and observation datasets. It
records where the data lives and what it contains, so BEACON can work out
which comparisons are possible without downloading anything. It addresses
the "Define metadata format" action item from the
[2026-10-21 architecture meeting](https://github.com/NCAR/beacon-dev/wiki/Meeting-Notes#meeting-notes-from-20261021-architecture-discussion).

## Decisions so far

| # | Decision | Why |
|---|---|---|
| 1 | One record per dataset, holding URL templates and coverage ranges, not one record per file | Matches "store only data locations". Five months of hourly GRIB would be millions of per-file records. |
| 2 | Hand-edited YAML, validated with JSON Schema | Easy to review in pull requests. Field names follow CF, STAC and ACDD where they overlap, so other formats can be exported later. |
| 3 | GDEX datasets carry their GDEX ID and DOI. A tool pulls GDEX metadata into committed snapshots and checks records against them. | GDEX's API is too slow and inconsistent to query live. Snapshots turn GDEX changes into diffs. |
| 4 | Input datasets and use cases | A use case (`cases/`) names the datasets, fields, thresholds and regions of an evaluation. Results and provenance metadata come later. |

## Layout

```
schema/dataset.schema.json      rules for dataset records
schema/case.schema.json         rules for use cases
schema/vocabulary.schema.json   rules for the two vocabulary files
vocabulary/quantities.yaml      canonical quantities (CF names) and their crosswalk
vocabulary/levels.yaml          level types and how MET, wgrib2, GRIB2 and GDEX spell them
datasets/<id>.yaml              one record per dataset (hand-written)
cases/<id>.yaml                 one use case per file (hand-written)
gdex/<dsid>.yaml                snapshots generated from the GDEX API (do not edit)
beacon_metadata/                validate, gdex-sync, gdex-check, pairs, configs, fetch, downloads
tests/                          pytest suite
```

## A record

This excerpt is from `datasets/gfs-0p25.yaml`:

```yaml
schema_version: 0.2.0
id: gfs-0p25                       # must match the file name
short_name: GFS                    # optional; menus and chart legends
kind: forecast                     # forecast | analysis | observation
model_type: nwp                    # forecasts only: nwp | ai | hybrid
identifiers:
  - {scheme: gdex, value: d084001}
  - {scheme: doi, value: 10.5065/D65D8PWK}
time:
  coverage: {start: 2015-01-15T00:00Z, end: null}   # init times; null = ongoing
  cycles: [0, 6, 12, 18]
  leads: [{start: 0, end: 120, step: 1}, {start: 123, end: 384, step: 3}]
locations:                         # in order of preference
  - id: gdex-glade
    provider: gdex
    access: posix
    retention: permanent           # ISO 8601 duration, permanent, or unknown
    leads: [...]                   # this copy keeps fewer leads
    files:
      pgrb2:
        template: "/glade/.../gfs.0p25.{init?fmt=%Y%m%d%H}.f{lead?fmt=%3H}.grib2"
  - id: nomads
    retention: P10D
    ...
variables:
  - {quantity: air_temperature, level: {type: height_above_ground, value: 2}, native: {name: TMP}}
  - quantity: precipitation_amount
    level: {type: surface}
    statistic: {method: sum, period: PT6H}
    native: {name: APCP}            # MET level A06 is derived from the period
quality:
  flag: unknown
```

## Fields

`dataset.schema.json` is the authoritative definition; every field there has
a description. The points below are the ones that matter most.

**Time**
- `time.coverage` holds init times for forecasts and valid times for
  analyses and observations.
- Forecasts need `cycles` and `leads`. Analyses and observations need
  `frequency`.
- A location may override `coverage` and `leads`, because copies differ:
  - GDEX keeps fewer GFS leads than NOMADS.
  - NODD's GFS paths only work from 2021-03-22 12Z.

**Templates**
- Templates use METplus filename syntax, the same syntax as beacon-vx's
  `parm/*.conf`, so they can be pasted into a METplus config.
- Forecast templates must use `init`. Analysis and observation templates use
  `valid` only.
- `members` lists files inside archives, outermost first. Stage IV on GDEX
  is a monthly tar, holding daily tars, holding GRIB2 files.
- `index` says whether a `.idx` (wgrib2) or `.index` (ECMWF) inventory sits
  next to each file, which allows byte-range downloads.

**Files**
- A location can serve several file streams (`files`), such as AIGFS's `sfc`
  and `pres`.
- When it does, each variable names its stream with `file`.
- A stream that exists only at some hours lists `valid_hours`, for example
  Stage IV 24 h totals at 12Z.

**Variables**
- A variable is a `quantity` plus a `level`, with an optional `statistic`.
  This mirrors CF's standard name, vertical coordinate and `cell_methods`.
- `level` takes `value` or `values` (for example several pressure levels).
- `native` is how MET addresses the field: the GRIB short name, or the netCDF
  variable name with an index string such as `(0,*,*)`.
- `native.level` can be left out when MET's level is derivable:
  - from the level type, e.g. `Z2` or `P500`;
  - from the statistic period, e.g. `A06`.
- Model-level and netCDF fields must give `native.level`.
- `approximates` marks a stand-in, such as CREDIT's lowest model level used
  as 10 m wind. The validator warns unless a quality note covers it.
- `variables` lists what BEACON can use, not everything in the files. The
  GDEX snapshots hold the full parameter lists.

## Vocabulary

**Quantities**
- Each quantity is keyed by its CF standard name. A quantity CF lacks would
  use a `beacon_` prefix.
- Each one maps to:
  - the WMO GRIB2 discipline/category/number and NCEP short name, which MET
    writes to `FCST_VAR`;
  - aliases in systems that put the level in the name, such as ESCOMP
    ESMStandardNames (`air_temperature_at_2m`), the ECMWF parameter database
    (`2t`, 167) and Earth2Studio (`t2m`).
- `derive` records how to compute a quantity from others. For example,
  `geopotential_height` is `geopotential / 9.80665`. This is the hook for
  the meeting's derived-fields question.
- `level` pins quantities whose names imply a level, such as
  `air_pressure_at_mean_sea_level`.

**Levels**
- Level types give the GRIB2 Code Table 4.5 surface type and the spellings
  used by MET (`Z{value}`), wgrib2 (`{value} m above ground`) and GDEX
  (`HTGL`).
- Isobaric values are in hPa, as MET and wgrib2 use them. GRIB2 itself
  stores Pa.

All CF, ESMStandardNames, Earth2Studio and ECMWF names in v0.1.0 were checked
against their sources on 2026-10-22.

## Quality

The meeting asked for a quality flag. The format separates three things:

- **`quality.flag`** is a curated overall judgment: `good`, `caution`,
  `do_not_use` or `unknown`.
- **`quality.notes`** are scoped statements. Each has its own flag, a
  summary, and an optional scope (quantities, locations, time range), plus
  evidence links and the date recorded.
  - This follows GDEX's `gdex-fitness-graph` prototype (statement, scope,
    evidence), so the two could later align.
- **`quality.observation_qc`** describes per-observation QC carried in the
  data and the setting BEACON uses. For example, PREPBUFR quality markers,
  with beacon-vx's `PB2NC_QUALITY_MARK_THRESH = 9`.

Availability (is this file there right now?) is not stored in records.
It changes hourly and belongs to the monitoring action item. Records only
note availability problems found by people, such as CREDIT producing no
output after 2026-10-01.

## GDEX snapshots

- **`gdex-sync`** reads the GDEX landing page and API and writes
  `gdex/<dsid>.yaml`.
  - The landing page gives the DOI and title.
  - The API gives the licence, formats, volume, temporal and spatial
    coverage, and the parameter inventory.
  - The inventory is condensed to one entry per GDEX parameter and level
    code. GFS goes from 12 MB of JSON to 85 KB.
- **`gdex-check`** compares each record with its snapshot. It checks:
  - DOI and coverage dates;
  - whether each GRIB variable exists at the stated level values;
  - whether the stated leads and accumulation periods exist.

Snapshots record what GDEX reports, including its mistakes. On 2026-10-22,
`gdex-check` found:

- **gfs-0p25:** no differences.
- **stage-iv:** GDEX's own metadata is stale.
  - It lists coverage ending 2025-12, a 1160×880 grid and GRIB1 format.
  - The GLADE files actually run to 2026-09, are 1121×881, and have been
    GRIB2 since 2020-07-29.
- **gdas-prepbufr and stage-iv:** GDEX has no parameter inventory, so their
  variables can't be checked.

GDEX parameter names contain spaces (`A PCP`, `U GRD`). Removing the spaces
gives the NCEP name (`grib_name`).

## Evolving the format

- `schema_version` follows semantic versioning.
  - Adding optional fields or enum values is a minor bump (0.1 → 0.2).
  - Renaming or removing fields, or changing their meaning, is a major bump.
- The validator lists the major.minor versions it accepts.
- When the schema changes, update `beacon_metadata.SCHEMA_VERSION`,
  `SUPPORTED_VERSIONS` in `validate.py`, and the records together, in one
  pull request.

## Commands

Run from this directory:

```bash
conda env create -f ../environment.yml      # once; shared with src/portal
conda activate beacon
python -m beacon_metadata validate          # schema + cross-checks; exit 1 on errors
python -m beacon_metadata gdex-sync         # refresh gdex/*.yaml for all referenced IDs
python -m beacon_metadata gdex-sync d084001 --raw-dir /tmp/gdex-raw   # keep raw responses
python -m beacon_metadata gdex-check        # exit 2 if any record differs from GDEX
python -m beacon_metadata pairs             # forecast/reference pairs and what they share
python -m beacon_metadata gridstat gfs-0p25 urma-2p5   # print a METplus GridStat config
python -m beacon_metadata case wildfire     # print a use case's PB2NC and Point-Stat configs
python -m beacon_metadata fetch gfs-0p25 urma-2p5 --start 2026-10-20 --end 2026-10-20 --input-dir ../../data/input
python -m beacon_metadata fetch --case wildfire --start 2026-10-20 --end 2026-10-20 --input-dir ../../data/input
python -m pytest tests
```

`pairs`, `gridstat`, `case` and `fetch` are steps 1–3 of [`../../STEPS.md`](../../STEPS.md);
the portal's Datasets page and the compute service use the same code.
Configs read downloaded files from
`{INPUT_BASE}/<dataset>/<file>/<time>.<ext>`, which is where `fetch` puts them,
unless `--glade` is given.

## Seed records

| Record | Shows |
|---|---|
| `gfs-0p25` | GDEX-backed forecast; four locations with different leads and start dates; model epochs |
| `aigfs` | AI forecast not in GDEX; two file streams (sfc, pres); NODD from 2026-04-16 |
| `credit-nrt` | AI forecast in netCDF; explicit MET index strings; `approximates`; quality notes |
| `urma-2p5` | Gridded hourly analysis; separate precipitation files at limited hours |
| `gdas-prepbufr` | Point observations; observation QC settings; filename change before 2009 |
| `stage-iv` | Precipitation analysis inside nested archives; 1, 6 and 24 h windows; stale GDEX metadata |
| `aifs-single` | ECMWF AI forecast; ECMWF JSON index; CCSDS packing re-packed after download; humidity derived |
| `hrrr` | 3 km Lambert grid; hourly runs, of which 00/06/12/18Z go to 48 h; WIND is an hourly maximum |

## Use cases

A use case is one end-to-end evaluation from
[`docs/surveyResponse.md`](../../docs/surveyResponse.md): `wildfire`,
`airfield` and `heat` compare AIFS with HRRR against GDAS surface stations.
Each names its forecasts, reference, PREPBUFR message types, lead times,
fields (quantity, level, and event thresholds with everyday-unit labels),
regions (a MET polyline or a list of station IDs), and what it can't evaluate
yet. The validator checks that every forecast and the reference can provide
every field, directly or through a vocabulary `derive` rule: MET derives wind
speed from u and v; BEACON computes relative humidity from temperature and
dewpoint after download (`beacon_metadata.grib`).

`plan_case` turns a case into a PB2NC config (station reports to NetCDF) and a
Point-Stat config with one section per model, so models on different grids are
interpolated to the same stations.

`wildfire-2025-03` is a dated event: the 14 March 2025 Southern Plains
fire-weather outbreak, planned in [`UTILITIES.md`](../../UTILITIES.md). Two
additions make it work:

- `leads.per_forecast: true` scores each forecast at the leads and runs it
  has between `start` and `end`, instead of requiring every forecast to have
  all of them: AIFS every 6 h out to 240 h, HRRR every hour out to 48 h. Each
  model's Point-Stat section gets its own `VALID_INCREMENT` and `LEAD_SEQ`, or
  `INIT_SEQ` when its leads depend on the valid hour. Hourly valid times read
  the 6-hourly PREPBUFR files: PB2NC keeps each whole file, and each hour reads
  the file holding the report just before it (`metplus.obs_timing`).
- `gridded` adds maps: every forecast and a gridded analysis (`reference`,
  e.g. `urma-2p5`) on one latitude-longitude box (`grid`: `lat` [south,
  north], `lon` [west, east], `spacing` in degrees), at valid times and runs
  every `step` hours (default 6). MET Grid-Stat interpolates them all to the
  box, scores them over it (region FULL) and the case's polyline regions, and
  keeps the matched fields, which Show in GUI turns into the GUI's Fields page
  (`metplus.plan_case_grid`, `render_gridstat_case`; `src/compute/maps.py`).
  The analysis files are fetched with the case's other inputs; quantities
  the analysis lacks are derived as for forecasts (URMA's RH from TMP and DPT).
- `event` gives the event window, the station-list region and a name for each
  station, the dangerous conditions (all at the same station and hour; each
  must be one of the case's fields) and when a forecast has called it
  (`min_hours`, `onset_tolerance_h`; the onset is the first hour of the first
  spell of `min_hours` dangerous hours in a row). The event report that uses it comes in
  steps 2 to 4 of `UTILITIES.md`.

## Not covered yet

- **A "find comparisons" query.** Given a quantity, region and time window,
  list matching forecast and observation pairs with locations. This is the
  real test of whether the format holds enough information.
- **Generating METplus options from the crosswalk.** This means `*_NAME`,
  `*_LEVELS`, `set_attr_*` and `convert(x)`, in place of hand-written
  options. That would have prevented the duplicated
  `FCST_POINT_STAT_VAR2_OPTIONS` in the CREDIT configs.
- **Run totals** (`period: from_init`) have no derived MET level yet.
- **File sizes** for estimating request size (GFS 0.25° is about 500 MB per
  lead).
- **Unlisted CREDIT fields:** `*_PRES` and `*_HEIGHT`.
- **More datasets,** which is the next action item.
