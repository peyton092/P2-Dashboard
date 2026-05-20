# Tauri app icons

These are generated, not hand-authored. Drop a square source PNG (1024×1024
recommended) at `public/p2-mark.png` (or anywhere) and run:

```bash
npx tauri icon path/to/source.png
```

That produces `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`
(macOS), and `icon.ico` (Windows) in this directory — the exact set referenced
by `src-tauri/tauri.conf.json` under `bundle.icon`. Until you generate them,
`npm run desktop:dev` works but `npm run desktop:build` will fail with a
missing-icon error.
