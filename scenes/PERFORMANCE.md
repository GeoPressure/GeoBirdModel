# Gallery performance

Performance pass on the gallery (2026-11-20), with no visible change to the design. Measured in Chrome
(ANGLE/Metal) on an Apple M3 Pro, with the gallery served by vite and driven by Playwright. One
WebGL context before and after.

## What changed

| Change | Where | Why |
|---|---|---|
| The composer's second render target is no longer multisampled | `main.js` | The scenes are drawn into `renderTarget1` only; `renderTarget2` was 4× MSAA HalfFloat but never drawn into, and it still cost about 3.5 ms per frame at 1600×950 |
| Canvas created with `antialias: false` | `main.js` | Only the composer's last full-screen pass reaches the canvas, so a multisampled canvas just added a resolve. The antialiasing is still done in the composer's MSAA target |
| Terrain clipmap holes are cut in the index buffer, not with a fragment-shader `discard` | `main.js`, `shaders.js` | A `discard` disables the GPU's hidden-surface removal, so hidden terrain was shaded too. There are 9 index buffers, because the finer level is offset by −1, 0 or +1 cell; they cut exactly the cells the `discard` removed before |
| Shaders compile in the background (`compileAsync` with `KHR_parallel_shader_compile`) | `main.js`, `gallery.js` | Scene switches and new birds no longer freeze the page while shaders compile. No frame is drawn while the fade covers the canvas. Without the extension, compilation happens at once, as before |
| The habitat raster is decoded, indexed (6.5 M pixels) and faded in a worker | `habitat-map.js`, `habitat-worker.js` (new) | This work is off the main thread. The first bird no longer waits for the map index (`map.ready` now covers only the JSON). Only 4 faded rasters are kept, at 26 MB each. There is a main-thread fallback when `OffscreenCanvas` is missing |
| Minified three.js, `modulepreload` of the whole three.js module graph, `gallery.js` loaded `async` | `index.html`, `main.js` | The download is 138 kB instead of 205 kB (brotli), with half as much JS to parse. The CDN modules load in one round instead of three levels. The species data, map indexes and GLB start loading while three.js is still loading |

## Before / after

**GPU+CPU time per frame** at a fixed pixel ratio of 1 (1600×950), in ms. Each value is the median of 5×15 frames
rendered back to back and then synchronised with `readPixels`, so it is not capped by vsync.

| scene | before | after | | scene | before | after |
|---|---|---|---|---|---|---|
| none | 3.0 | 1.5 | | none_night | 3.0 | 1.5 |
| sahara | 7.3 | 4.3 | | sahara_night | 9.5 | 6.5 |
| kenya | 12.5 | 10.0 | | kenya_night | 14.2 | 10.4 |
| wetland | 11.3 | 8.0 | | wetland_night | 12.6 | 9.7 |
| congo | 10.4 | 8.3 | | congo_night | 12.6 | 9.7 |
| mediterranean | 12.2 | 10.2 | | mediterranean_night | 14.7 | 11.8 |
| sea | 10.7 | 7.1 | | sea_night | 11.1 | 8.0 |
| alps | 8.1 | 5.5 | | alps_night | 10.8 | 8.1 |
| farmland | 14.5 | 11.5 | | farmland_night | 17.1 | 13.4 |
| steppe | 11.4 | 8.9 | | steppe_night | 13.7 | 13.4 |
| taiga | 12.8 | 12.4 | | taiga_night | 15.2 | 14.9 |
| tundra | 10.9 | 10.0 | | tundra_night | 13.6 | 12.0 |
| city | 18.2 | 16.9 | | city_night | 17.8 | 15.1 |

**Live frame rate** on a 120 Hz screen at 1600×950, visiting the scenes in order (4 s each), with the
gallery's adaptive pixel ratio (it starts at 1.25 and drops by 0.25 after 2 s below 40 fps, never going back up). Before, the
ratio fell to **0.75** in the third scene and stayed there, so the image was blurrier. After, it settles at **1.0**.
Even at that higher resolution the frame rate is higher in most scenes: sahara 48 → 81 fps, congo 58 → 105,
sea 48 → 98, tundra 59 → 98, mediterranean 54 → 86. At phone size (375×812) both versions run at 120 fps
on this machine, which says nothing about phone GPUs. The GPU time per pixel saved above applies there too.

**Load**, median of 5 cold loads (local server, so network time is close to zero):

| | desktop before | desktop after | phone before | phone after |
|---|---|---|---|---|
| time to first scene (fade lifted), ms | 1224 | 1160 | 1164 | 976 |
| main-thread long tasks, total ms | 466 | 289 | 278 | 171 |
| JS heap, MB | 59 | 30 | 85 | 34 |
| requests / MB | 58 / 3.94 | 60 / 3.92 | 55 / 3.87 | 57 / 3.84 |

Scene switches: before, the page froze for 50–86 ms per switch while shaders compiled; after, most switches
have no long task. The 50–80 ms freezes that remain on a few scenes come from the driver creating pipelines
on the first draw.

**Look**: deterministic screenshots of all 26 scenes (time frozen, seeded randomness, desktop and phone)
differ from the originals by no more than two runs of the original code differ from each other: about 1–2.5 % of pixels,
mostly the bird's pose and the twinkling city lights. The interactions were checked on desktop and phone with no console
error or warning: map open/close, Day/Night/As flown, ▶ play, map click, No background, the All species grid and
the hover loop.

## Not changed, and why

- **Pixel-ratio policy** (start at 1.25, drop to 0.75 below 40 fps, no recovery): changing it would change how
  sharp the image is. With the faster frames it now drops less often. Letting it recover after a light scene would be the next step.
- **Bloom**: it costs only about 2.5 ms in `city_night`. Adding it into a non-multisampled copy instead of the MSAA target was slower.
- **Terrain, sky, cloud and city-light shaders** (fbm octaves, clipmap levels, the 512×512×2 city lattices): their
  cost is the look itself. The far four clipmap levels cost only about 3 ms. Any cheaper version would look different.
- **Cumulus sorting and other per-frame JS**: about 0.4 ms of CPU per frame in total, not worth the risk.
- **PMREM regeneration per preset**: a one-off cost behind the fade.
- **`backdrop-filter` panels**: this is compositor work Chrome does not expose to page timing. Removing it changes the design.
- **Pausing when the stage scrolls away on phones**: the canvas still shows through the blurred filmstrip,
  so pausing would freeze it. The renderer already pauses behind the open species grid.
- **Hover loops and posters**: already lazy (`loading="lazy"`, loop fetched on hover).
