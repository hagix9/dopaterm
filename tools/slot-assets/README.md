# DOPA SLOT cabinet asset generator

Offline generator for the raster assets in `client/assets/slot/`. It is **not** part of the shipped app.

- 3D parts (chrome bezels, stop-button ring and lenses, lever frames, dome lamps) are rendered with
  three.js physically based materials and a studio environment (`RoomEnvironment`) inside a hidden
  Electron window.
- 2D parts (printed reel symbols, reel cylinder shading and glare, glass reflection, paint grain,
  brushed metal, perforated grille, embossed gold logo) are drawn procedurally in canvas.
- All shapes and symbols are original to Dopaterm. No photos, logos or characters from real machines
  or from Dopa Drill are used.

## Regenerate

```bash
cd tools/slot-assets && npm install        # installs three (devDependency of the tool only)
cd ../..
for j in buttons lever lamps frames flat; do
  env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron \
    tools/slot-assets/render.cjs tools/slot-assets/jobs/$j.mjs client/assets/slot
done
```

Pass job names after the output directory to render only some assets.
