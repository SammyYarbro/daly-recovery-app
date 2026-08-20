# app.dalyrecovery.org — resident PWA + executive dashboard

Single-domain, two entry points:

- `/` — resident mobile app (installable PWA).
- `/dashboard.html` — desktop dashboard for management.

## Deploy to Cloudflare Pages

1. Create a GitHub repo named `daly-recovery-app`.
2. Copy every file in this folder into the repo root.
3. `git add . && git commit -m "initial" && git push`.
4. Cloudflare Pages → **Create → Pages → Connect to Git** → pick the repo.
5. Build command: *(leave blank)*. Build output directory: `.`
6. Deploy. Then Custom domains → add `app.dalyrecovery.org`.
7. Open the URL on iPhone Safari → Share → Add to Home Screen. Confirm it installs.

## Files

- `index.html` — resident PWA (bundled).
- `dashboard.html` — executive dashboard (bundled).
- `manifest.webmanifest` — PWA manifest (name, icons, theme).
- `sw.js` — service worker (offline + cache).
- `_headers` — service-worker scope + security headers.
- `_redirects` — `/dashboard` → `/dashboard.html`, `/manage` → `/dashboard.html`.
- `robots.txt` — disallow indexing (app is private).
- `icons/` — **you provide these**: 192, 512, maskable 192/512, apple-touch 180. See `icons/README.md`.

## PWA install checklist

- [ ] Domain `app.dalyrecovery.org` resolves with HTTPS.
- [ ] `manifest.webmanifest` returns 200 at `/manifest.webmanifest`.
- [ ] Icons return 200 at `/icons/*.png`.
- [ ] Service worker registers on first load (check DevTools → Application → Service Workers).
- [ ] Installed on one iPhone (Safari) and one Android (Chrome).

## Updating

Edit the `.dc.html` source files, re-bundle, replace `index.html` / `dashboard.html`, push. To force residents onto a new build immediately, bump `CACHE_VERSION` in `sw.js`.
