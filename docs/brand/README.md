# Brand assets

The application icon is the Merge mark. Two overlapping circles, near white and blue, sit on the near black tile. The mark was chosen on 2026-10-23 from ten directions.

## Source

`scripts/build-brand-assets.ts` holds the geometry in a 108 unit square. It writes every shipped surface:

- PWA icons `pwa/public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `icon.svg`, `mask-icon.svg`, `apple-touch-icon.png`
- Site copies `site/icon.svg`, `site/mask-icon.svg`, `site/apple-touch-icon.png`, `site/og.png`, `site/og-en.png`
- Docs favicon `site/doc/public/icon.svg`
- Android launcher, adaptive foreground, legacy icons and splash bitmaps under `mobile/android/app/src/main/res`

Rerun after editing the mark:

```sh
bun scripts/build-brand-assets.ts
```

Raster output needs Chrome. The script uses a Playwright headless shell when it finds one, then Google Chrome. Set `CHROME` to point at another binary. The script also renders `site/og.html` and `site/og-en.html` into the share cards.

The web icons keep their public paths, so HTML, the manifest and the service worker need no path changes. The service worker caches the shell icons. Bump its cache version in `pwa/public/sw.js` and the matching assertion in `pwa/src/service-worker.test.ts` when the mark changes, otherwise installed PWAs keep the old icons.

## Legacy

`docs/brand/legacy/` holds the fob mark that Merge replaced. Files keep their original repository paths so they can be put back if needed. The Android shell was untracked when the swap happened, so this archive is the only copy of the old launcher and splash bitmaps.

## Production

The mark went live on pairfob.com on 2026-10-23 with Worker build 2026-10-23.1 and service worker cache `pairfob-shell-v12`.
