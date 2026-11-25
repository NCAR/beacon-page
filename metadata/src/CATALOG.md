# BEACON Data Catalog

The datasets BEACON can use, and the ones it could use next. The catalog holds
metadata and locations, not data: the files stay where their providers put
them (GDEX and GLADE, NOAA's and ECMWF's open-data services). The portal's
Metadata page shows the same dashboard, with a filterable list of every
candidate.

<!-- dashboard: written by `python -m beacon_metadata catalog` from datasets/ and catalog/; don't edit -->

## Dashboard

- **Ready to use:** 9 datasets have a BEACON record in [`datasets/`](datasets/): 6 forecasts, 2 analyses and 1 observation dataset.
- **Candidates:** 595 datasets from 1 source in [`catalog/`](catalog/): 28 forecasts, 147 analyses, 66 reanalyses and 354 observation datasets.
  - **GDEX** publishes 1,691 datasets. [`catalog/gdex.yaml`](catalog/gdex.yaml) lists the 595 BEACON could plausibly use: 28 forecasts, 147 analyses, 66 reanalyses and 354 observation datasets. 3 already have a BEACON record; 62 come with terms of use.

### Sources

| Source | Data on | Published | Listed | Forecast | Analysis | Reanalysis | Observation | In BEACON | With terms | Refreshed |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| [GDEX](https://gdex.ucar.edu/) | GLADE, internet | 1,691 | 595 | 28 | 147 | 66 | 354 | 3 | 62 | 2026-11-20 |

- GDEX: 868 other and 228 simulation datasets aren't listed.
- GDEX: refresh with `python -m beacon_metadata gdex-index`.

### Ready to use

| Record | Kind | Data on | Providers | In the catalog as |
|---|---|---|---|---|
| [aifs-single](datasets/aifs-single.yaml) | forecast (ai) | internet | ecmwf-gcs, ecmwf-aws, ecmwf | – |
| [aigfs](datasets/aigfs.yaml) | forecast (ai) | internet | nodd, nomads | – |
| [credit-nrt](datasets/credit-nrt.yaml) | forecast (ai) | GLADE | ncar | – |
| [gdas-prepbufr](datasets/gdas-prepbufr.yaml) | observation | GLADE, internet | gdex, nomads | GDEX d337000 |
| [gfs-0p25](datasets/gfs-0p25.yaml) | forecast (nwp) | GLADE, internet | gdex, nodd, nomads | GDEX d084001 |
| [graphcastgfs](datasets/graphcastgfs.yaml) | forecast (ai) | internet | nodd | – |
| [hrrr](datasets/hrrr.yaml) | forecast (nwp) | internet | nodd | – |
| [stage-iv](datasets/stage-iv.yaml) | analysis | GLADE, internet | gdex, nomads | GDEX d507005 |
| [urma-2p5](datasets/urma-2p5.yaml) | analysis | internet | nodd, nomads | – |

Data on: GLADE is NCAR's file system, read in place where it is mounted; local is another disk; internet means downloaded.

<!-- end of dashboard -->

## How it's organized

| Tier | Files | What each holds | Written |
|---|---|---|---|
| Ready | `datasets/<id>.yaml` | One dataset cases can use: file templates for each copy, cycles and leads, variables as MET reads them, quality notes ([FORMAT.md](FORMAT.md)) | by hand |
| Candidates | `catalog/<source>.yaml` | What one source offers, one dataset per line: kind, dates, the kinds of variable it has, terms of use | by a command, or by hand |
| GDEX snapshots | `gdex/<dsid>.yaml` | GDEX's parameter inventory for a ready dataset, to check its record against | `gdex-sync` |

- **A source** is anywhere BEACON could read data from: a data service
  (GDEX), an open-data program (NOAA's, ECMWF's), or a collection on GLADE or
  another disk. Every source file has the same shape
  ([`schema/catalog.schema.json`](schema/catalog.schema.json)): a `source`
  block saying where its files are, then `datasets`.
- **Data on** says where the files are:
  - GLADE: NCAR's file system. The compute service reads files there in place
    when it runs where GLADE is mounted (`DATA_ACCESS=glade`,
    [`../compute/README.md`](../compute/README.md)).
  - local: another file system.
  - internet: https, s3 or Globus, downloaded before use.
- **Kind** is forecast, analysis, reanalysis, observation, simulation or
  other. A generated file may guess it; its `source.notes` says how.
- **A candidate becomes ready** when someone writes its record in `datasets/`.
  A record names its catalog entry in `identifiers` (`{scheme: gdex, value:
  d084001}`), so the dashboard links the two. For GDEX, see "GDEX index" in
  [FORMAT.md](FORMAT.md).

## Adding a source

1. Write `catalog/<source>.yaml`, by hand or with a command modeled on
   `beacon_metadata/gdex_index.py`. A hand-written one for a local disk might
   look like this:

   ```yaml
   schema_version: 0.2.0
   source:
     id: lab-runs                     # must match the file name
     name: Lab runs
     title: Our group's WRF runs
     locations: [{access: posix, path: '/data/wrf/{id}/'}]   # {id} is each entry's id
   retrieved: 2026-11-20
   datasets:
   - {id: conus-3km, kind: forecast, title: WRF 3 km CONUS daily runs, start: '2025-06-01', updates: daily,
      variables: [temperature, wind, precipitation], access: open}
   ```

   An entry whose files are elsewhere gives its own `locations`. Without an
   `identifier_scheme` in `source`, an entry lists the records that use it
   in `beacon`.
2. Run `python -m beacon_metadata catalog` to update the dashboard, then
   `python -m beacon_metadata validate`. The validator warns when the
   dashboard is out of date.

Sources worth adding next:

- **NOAA's open data on AWS:** the AWS Open Data Registry keeps one YAML file
  per dataset in a public GitHub repository, so a generator could read it.
  BEACON's GFS, HRRR, URMA and AIGFS records already download from these buckets.
- **ECMWF open data:** a few products (IFS and AIFS), better written by hand.
- **Other collections on GLADE:** needs a scan run on Casper.

## Commands

Run from this directory:

```bash
python -m beacon_metadata catalog            # rewrite the dashboard above
python -m beacon_metadata catalog --check    # exit 1 if it's out of date
python -m beacon_metadata gdex-index         # refresh catalog/gdex.yaml (about 10 minutes) and the dashboard
```
