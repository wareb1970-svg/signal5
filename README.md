# Signal 5

Signal 5 is a deployable public-risk intelligence MVP. It turns named public indicators into explainable category scores without presenting predictions as facts.

## What is complete

- Responsive risk dashboard
- Search, level filtering, watchlists and local alert preferences
- Expandable explanations and direct source links
- Source-health reporting and reduced-confidence behavior
- Historical score storage
- Automated GitHub Actions data refresh every six hours
- Automated GitHub Pages deployment
- No runtime framework or paid hosting dependency

## Public sources

- National Weather Service active alerts
- USGS significant-earthquake feed
- FRED economic series when `FRED_API_KEY` is configured
- GDELT Cloud conflict events when `GDELT_CLOUD_API_KEY` is configured

Signal 5 preserves existing values when an optional keyed source is unavailable and lists the failure in `data.json`. It never silently invents a replacement measurement.

## Required repository setup

GitHub Pages: **Settings → Pages → Source: GitHub Actions**

Optional repository secrets:

- `FRED_API_KEY`
- `GDELT_CLOUD_API_KEY`

Without those secrets, NWS and USGS still refresh and the dashboard identifies unavailable source groups.

## Run locally

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`.

## Refresh data locally

```bash
node scripts/update-data.mjs
```

## Method

Each category uses an explicitly disclosed indicator or proxy. Time-series sources are standardized against their recent baseline. Event-count sources use bounded transformations. Scores are clamped to 0–100 and mapped to Normal, Monitor, Watch, Elevated and Severe. These are indicators, not forecasts or emergency instructions.
