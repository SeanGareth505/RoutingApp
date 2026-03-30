# Route Planner

Production-style Angular route planning app with local persistence, map editing, CSV workflows, intake links, and GTFS export.

## Local Development

- Install dependencies: `npm install`
- Start web + API proxy: `npm start`
- App URL: `http://localhost:4301`

`npm start` runs:
- Angular web app on port `4301`
- local proxy server for geocoding/routing at `/api`

## Build Commands

- Standard production build: `npm run build`
- GitHub Pages build (static-safe): `npm run build:gh-pages`

## GitHub Pages Ready Setup

This project is pre-configured for GitHub Pages:

- Uses hash-based routing for SPA-safe links (`#/...`)
- Uses static-safe build base href (`./`)
- Defaults to direct provider mode (`apiBaseUrl` is blank)
- Includes CI workflow at `.github/workflows/deploy-gh-pages.yml`

### Deploy with GitHub Actions (recommended)

1. Push this repo to GitHub.
2. In GitHub, open **Settings -> Pages**.
3. Set **Source** to **GitHub Actions**.
4. Push to `main` (or run the workflow manually).
5. GitHub will publish from the generated Pages artifact.

### Deploy manually from CLI

Run:

```bash
npm run deploy:gh-pages
```

This builds and publishes `dist/route-planner` using `angular-cli-ghpages`.

## Connection Modes

- **Direct mode** (GitHub Pages friendly): leave `API base URL` blank in Settings.
- **Proxy mode** (local/server backend): set `API base URL` to `/api` or your backend URL.

The top bar badge shows `Direct` or `Proxy` based on your current setting.
