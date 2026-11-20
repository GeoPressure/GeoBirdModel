// Gallery (../index.html). The bird flies over a habitat of its migration (renderer: main.js, driven
// through window.__scenes; the canvas fills the window). The migration map (habitat-map.js) is a card
// on the right, hidden by default: one track, its key places; a click on a place or a habitat flies
// there; ▶ follows the whole track at a uniform speed, the scene changing with the bird; Day / Night /
// As flown sets the scene's light. The filmstrip (bottom, full width) holds all species grouped by family
// and opens into a grid; hovering a species plays its flapping loop over its poster (loops/, boxes.json,
// tools/flap_loops.sh). One WebGL context for the whole page; the page itself is light only.
import { HabitatMap } from './habitat-map.js';

const $ = (id) => document.getElementById(id);
const EXPLORER = 'https://geopressure.org/GeoLocatorExplorer/';
const NO_TRACK_SCENE = 'kenya';
const slug = (sci) => sci.replace(/ /g, '_');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (x) => Math.round(x).toLocaleString('en').replace(/,/g, ' ');
const km = (x) => `${fmt(x)} km`;
const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };

let birds = [], cur = null, sp = null, base = null, lastScene = null, selTok = 0;
const stage = $('stage'), tiles = $('tiles'), strip = $('strip');
const phone = matchMedia('(max-width: 760px)');

// ------------------------------------------------------------------ renderer (main.js)
const whenScenes = new Promise((res) => { const t = () => (window.__scenes ? res(window.__scenes) : setTimeout(t, 40)); t(); });
const P = () => window.__scenes?.PRESETS || {};
const baseOf = (k) => P()[k]?.base || k;
// keep the bird in the free area: left of the map, between the header and the filmstrip. The filmstrip's
// height is read from its CSS size (a probe), not from the strip, which may be open or still animating.
const stripProbe = Object.assign(document.createElement('div'), { style: 'position:fixed;visibility:hidden;pointer-events:none;height:var(--strip-h);width:0' });
document.body.appendChild(stripProbe);
function insets() {
  const S = window.__scenes; if (!S) return;
  if (phone.matches) { S.setFov(innerWidth < innerHeight ? 50 : 34); S.setInsets({ left: 0, right: 0, top: 60, bottom: 150 }); return; }
  S.setFov(34);
  const open = !document.body.classList.contains('map-closed');
  S.setInsets({ left: 0, right: open ? $('side').offsetWidth + 14 : 0, top: 50, bottom: stripProbe.offsetHeight + 70 });
}
whenScenes.then(insets);
addEventListener('resize', insets);

// ------------------------------------------------------------------ the scene: Day (default) / Night / As flown (the tracked bird)
// As flown (auto): night where the bird flew that part mostly at night (autoNight), else day
let tod = ['day', 'night', 'auto'].includes(store.get('bm-scene-time')) ? store.get('bm-scene-time') : 'day', autoNight = null;
const nightNow = () => tod === 'night' || (tod === 'auto' && !!autoNight);
function markTod() { $('tod').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === tod))); }
$('tod').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  tod = b.dataset.m; store.set('bm-scene-time', tod); markTod();
  if (base === 'none') setScene(lastScene || NO_TRACK_SCENE); else setScene(base);
};
markTod();

function setScene(b) {
  base = b;
  if (b !== 'none') lastScene = b;
  map.highlight(b === 'none' ? null : b);
  $('plain').setAttribute('aria-pressed', String(b === 'none'));
  const S = window.__scenes; if (!S) return;
  const k = nightNow() && S.PRESETS[b + '_night'] ? b + '_night' : b;
  if (S.scene === k) $('fade').style.opacity = 0; else S.switchScene(k);
  stage.classList.toggle('plain', !!S.PRESETS[k].plain);
}
// share of this track's flight distance over the habitats of a scene that was flown at night
function nightShare(scene) {
  if (!sp) return null;
  const H = map.index.habitats; let n = 0, k = 0;
  for (const p of sp.path) if (H[p[2]]?.scene === scene && p[3] != null && p[3] >= 0) { n++; k += p[3] === 1 ? 1 : 0; }
  return n ? k / n : null;
}

// ------------------------------------------------------------------ map
const map = new HabitatMap($('map'), {
  base: 'habitats/',
  onPick(h) {
    pause();
    const sc = baseOf(h.scene);
    autoNight = h.kind === 'landmark' ? (h.lm.night ?? 0) >= 0.5
      : h.kind === 'flight' ? (h.p[3] === 1 ? true : h.p[3] === 0 ? false : autoNight)
      : h.kind === 'place' || h.kind === 'stop' ? false                          // on the ground: by day
      : (() => { const s = nightShare(sc); return s == null ? null : s >= 0.5; })();
    setScene(sc);
  },
});
// fit the track between the map's floating header and its info box
const mapPad = () => { map.pad = { top: 50, bottom: document.querySelector('.mapinfo').offsetHeight + 20 }; };
new ResizeObserver(() => { mapPad(); map.refit(false); map.draw(); }).observe(document.querySelector('.mapinfo'));
mapPad();
$('zin').onclick = () => map.zoom(1.6);
$('zout').onclick = () => map.zoom(1 / 1.6);
$('zfit').onclick = () => map.reset();
$('plain').onclick = () => setScene(base === 'none' ? (lastScene || NO_TRACK_SCENE) : 'none');
// collapsible map: open by default on large screens, the choice is remembered
function setMap(open) {
  document.body.classList.toggle('map-closed', !open);
  store.set('bm-map-open', open ? '1' : '0');
  insets(); setTimeout(() => { map.refit(false); map.draw(); }, 320);
}
setMap(store.get('bm-map-open') === '1');   // hidden by default
$('mapclose').onclick = () => setMap(false);
$('mapopen').onclick = () => setMap(true);


// ------------------------------------------------------------------ play the migration
// uniform speed along the track's path points; the whole track takes 45–150 s
let cum = null, total = 0, speed = 0, playD = 0, playing = false, lastT = 0, lastSwitch = 0;
const gc = (a, b) => {
  const r = Math.PI / 180, s = Math.sin((b[1] - a[1]) * r / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin((b[0] - a[0]) * r / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(s)));
};
function setupPlay() {
  pause(); playD = 0; cum = null;
  $('play').style.display = sp?.path?.length > 1 ? '' : 'none';
  if (!sp?.path?.length) return;
  const Pp = sp.path; cum = [0];
  for (let i = 1; i < Pp.length; i++) cum.push(cum[i - 1] + gc(Pp[i - 1], Pp[i]));
  total = cum[cum.length - 1];
  speed = total / Math.min(150, Math.max(45, total / 160));   // km per second
  $('prog').value = 0; $('progtxt').textContent = km(total);
  map.setPlayhead(null);
}
function posAt(d) {
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m; }
  const a = sp.path[lo], b = sp.path[hi], f = cum[hi] > cum[lo] ? (d - cum[lo]) / (cum[hi] - cum[lo]) : 0;
  return { i: lo + f, idx: lo, lon: a[0] + (b[0] - a[0]) * f, lat: a[1] + (b[1] - a[1]) * f };
}
function updatePlay(force) {
  if (!cum) return;
  const h = posAt(playD), H = map.index.habitats;
  map.setPlayhead(h);
  $('prog').value = Math.round(1000 * playD / total);
  $('progtxt').textContent = `${fmt(playD)} / ${km(total)}`;
  // the habitat and day/night of the next ~250 km (majority), so the scene does not flicker
  const votes = new Map(); let n = 0, k = 0;
  for (let j = h.idx; j < sp.path.length && cum[j] <= playD + 250; j++) {
    const p = sp.path[j], sc = H[p[2]]?.scene; if (sc) votes.set(sc, (votes.get(sc) || 0) + 1);
    if (p[3] === 0 || p[3] === 1) { n++; k += p[3]; }
  }
  const sc = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] || base;
  const now = performance.now();
  if (base === 'none' || !(force || now - lastSwitch > 3500)) return;
  const nightWas = autoNight;
  if (n) autoNight = k / n >= 0.5;
  if (sc !== base || autoNight !== nightWas || force) {
    map.select(null);
    setScene(sc); lastSwitch = now;
  }
}
function tick(t) {
  if (!playing) return;
  const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
  playD = Math.min(total, playD + speed * dt);
  updatePlay(false);
  if (playD >= total) { pause(); return; }
  requestAnimationFrame(tick);
}
function play() {
  if (!cum) return;
  if (playD >= total) playD = 0;
  playing = true; $('play').classList.add('on'); $('playbtn').setAttribute('aria-label', 'Pause');
  lastT = performance.now(); lastSwitch = 0; updatePlay(true);
  requestAnimationFrame(tick);
}
function pause() { playing = false; $('play').classList.remove('on'); $('playbtn').setAttribute('aria-label', 'Play the migration'); }
$('playbtn').onclick = () => (playing ? pause() : play());
$('prog').oninput = () => { if (!cum) return; playD = total * $('prog').value / 1000; updatePlay(true); };

// ------------------------------------------------------------------ species
async function select(b, { collapse = false } = {}) {
  if (!b) return;
  cur = b;
  const name = slug(b.scientific_name);
  $('en').textContent = b.english_name;
  $('sci').textContent = b.scientific_name;
  $('dl').href = b.model;
  tiles.querySelectorAll('.tile').forEach((t) => t.setAttribute('aria-current', String(t.dataset.sci === b.scientific_name)));
  history.replaceState(null, '', location.search + '#' + name);
  document.title = `${b.english_name} · GeoBirdModel`;
  if (collapse) toggleGrid(false);
  scrollToCurrent();
  pause();

  const tok = ++selTok;
  const S = await whenScenes;
  if (tok !== selTok) return;
  S.loadBird(b.model || null);
  sp = await map.species(b.scientific_name).catch(() => null);
  if (tok !== selTok) return;
  map.set(sp);
  $('mapbox').classList.toggle('notrack', !sp); $('side').classList.toggle('notrack', !sp);
  const tr = $('track');
  if (sp) { tr.textContent = `track ${sp.tag_id} ↗`; tr.href = `${EXPLORER}tag/${encodeURIComponent(sp.tag_id)}`; tr.title = `This ${b.english_name} in GeoLocator Explorer`; }
  else if (b.tag_id) { tr.textContent = `GeoLocator Explorer ↗`; tr.href = `${EXPLORER}tag/${encodeURIComponent(b.tag_id)}`; tr.title = ''; }
  else { tr.textContent = ''; tr.removeAttribute('href'); }
  setupPlay();
  // the default scene: the track's main barrier or habitat; "No background" stays on once chosen
  const def = sp ? baseOf(sp.default_scene) : NO_TRACK_SCENE;
  const lm = sp ? sp.landmarks.find((l) => baseOf(l.scene) === def) : null;
  autoNight = lm ? (lm.night ?? 0) >= 0.5 : (() => { const s = nightShare(def); return s == null ? null : s >= 0.5; })();
  if (base === 'none') { lastScene = def; map.select(null); map.highlight(null); setScene('none'); }
  else { map.select(lm ? { kind: 'landmark', lm, scene: def } : null); setScene(def); }
}

// ------------------------------------------------------------------ filmstrip / grid, grouped
// families in a roughly taxonomic sequence (non-passerines first), with English names
const ORDERS = ['Charadriiformes', 'Strigiformes', 'Caprimulgiformes', 'Bucerotiformes', 'Coraciiformes', 'Piciformes', 'Passeriformes'];
const FAMILIES = ['Scolopacidae', 'Strigidae', 'Caprimulgidae', 'Upupidae', 'Alcedinidae', 'Picidae', 'Tyrannidae', 'Monarchidae', 'Laniidae', 'Alaudidae',
  'Hirundinidae', 'Acrocephalidae', 'Locustellidae', 'Sylviidae', 'Turdidae', 'Muscicapidae', 'Motacillidae', 'Fringillidae', 'Calcariidae', 'Emberizidae',
  'Parulidae', 'Thraupidae'];
const FAMILY_EN = { Scolopacidae: 'sandpipers & snipes', Strigidae: 'owls', Caprimulgidae: 'nightjars', Upupidae: 'hoopoes', Alcedinidae: 'kingfishers',
  Picidae: 'woodpeckers', Tyrannidae: 'tyrant flycatchers', Monarchidae: 'monarchs', Laniidae: 'shrikes', Alaudidae: 'larks', Hirundinidae: 'swallows',
  Acrocephalidae: 'reed warblers', Locustellidae: 'grass warblers', Sylviidae: 'sylviid warblers', Turdidae: 'thrushes', Muscicapidae: 'flycatchers & chats',
  Motacillidae: 'wagtails & pipits', Fringillidae: 'finches', Calcariidae: 'longspurs & snow buntings', Emberizidae: 'buntings', Parulidae: 'New World warblers',
  Thraupidae: 'tanagers' };
const taxon = (b) => { const m = (b.sticker || '').match(/stickers\/([^/]+)\/([^/]+)\//); return m ? { order: m[1], family: m[2] } : { order: '', family: 'Other' }; };
const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
const rank = (arr, v) => { const i = arr.indexOf(v); return i < 0 ? arr.length : i; };
const pad2 = (n) => String(n).padStart(2, '0');
function groupOf(b) {
  const t = taxon(b);
  return { key: `${pad2(rank(ORDERS, t.order))}-${pad2(rank(FAMILIES, t.family))}-${t.family}`, label: `<b>${esc(cap(FAMILY_EN[t.family] || t.family))}</b>`, title: t.family };
}
function shown() {
  const q = $('search').value.trim().toLowerCase();
  return birds.filter((b) => (!q || b.english_name.toLowerCase().includes(q) || b.scientific_name.toLowerCase().includes(q)))
    .map((b) => ({ b, g: groupOf(b) }))
    // families in taxonomic sequence, species by scientific name within a family (genera together)
    .sort((x, y) => (x.g.key < y.g.key ? -1 : x.g.key > y.g.key ? 1 : 0) || x.b.scientific_name.localeCompare(y.b.scientific_name));
}
function render() {
  const q = $('search').value.trim();
  const list = shown();
  let last = null, html = '';
  for (const { b, g } of list) {
    if (g.key !== last) { html += `<div class="grp" title="${esc(g.title)}">${g.label}</div>`; last = g.key; }
    html += `<button class="tile" data-sci="${esc(b.scientific_name)}" title="${esc(b.english_name)} (${esc(b.scientific_name)})" aria-label="${esc(b.english_name)}">
      <span class="pic"><img class="poster" src="${esc(b.poster || b.sticker)}" alt="" loading="lazy" decoding="async"></span>
      <span class="name">${esc(b.english_name)}</span></button>`;
  }
  tiles.innerHTML = html;
  $('empty').style.display = list.length ? 'none' : 'block';
  if (cur) tiles.querySelectorAll('.tile').forEach((t) => t.setAttribute('aria-current', String(t.dataset.sci === cur.scientific_name)));
}
function scrollToCurrent() {
  const t = tiles.querySelector('.tile[aria-current="true"]');
  if (!t || strip.classList.contains('open')) return;
  const r = t.getBoundingClientRect(), R = tiles.getBoundingClientRect();
  if (r.left < R.left || r.right > R.right) tiles.scrollTo({ left: t.offsetLeft - tiles.clientWidth / 2 + t.offsetWidth / 2, behavior: 'smooth' });
}
let pauseTimer = null;
function toggleGrid(open = !strip.classList.contains('open')) {
  strip.classList.toggle('open', open);
  document.body.classList.toggle('grid-open', open);   // the map steps aside while the grid is open
  $('expand').setAttribute('aria-expanded', String(open));
  $('exlabel').textContent = open ? 'Close' : 'All species';
  $('expand').title = open ? 'Close the grid, back to the bird (Esc)' : 'Open all species as a grid';
  hideLoop();
  clearTimeout(pauseTimer);
  // the grid covers the scene: stop rendering it while open
  if (open) pauseTimer = setTimeout(() => window.__scenes?.setPaused(true), 380);
  else { window.__scenes?.setPaused(false); window.__scenes?.recenter(); insets(); setTimeout(scrollToCurrent, 380); }
  if (open) tiles.scrollTop = 0;
}
$('expand').onclick = () => toggleGrid();
$('handle').onclick = () => toggleGrid();
// previous / next species, in the order shown (also ← →)
function step(d) {
  const list = shown().map((x) => x.b), i = list.indexOf(cur);
  const b = list[(i + d + list.length) % list.length];
  if (b) select(b);
}
$('prev').onclick = () => step(-1);
$('next').onclick = () => step(1);
tiles.addEventListener('wheel', (e) => {   // vertical wheel scrolls the filmstrip sideways
  if (strip.classList.contains('open') || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
  e.preventDefault(); tiles.scrollLeft += e.deltaY;
}, { passive: false });
tiles.addEventListener('click', (e) => {
  const t = e.target.closest('.tile');
  if (t) select(birds.find((b) => b.scientific_name === t.dataset.sci), { collapse: true });
});
$('search').oninput = () => { render(); if (!strip.classList.contains('open')) tiles.scrollLeft = 0; };
$('search').onkeydown = (e) => { if (e.key === 'Enter') { const x = shown()[0]; if (x) select(x.b, { collapse: true }); } };
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && strip.classList.contains('open')) { toggleGrid(false); return; }
  if (e.target.closest('input, select, textarea') || strip.classList.contains('open') || e.metaKey || e.ctrlKey || e.altKey || $('about').open) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1); }
  if (e.key === ' ' && cum) { e.preventDefault(); playing ? pause() : play(); }
});

// hover (or keyboard focus): the short flapping loop, floating exactly over the poster. loops/boxes.json
// gives the poster's box inside each loop image (tools/render_flap_loop.py), so the bird does not move.
const noLoop = new Set(), floop = $('floop');
let boxes = {}, hovered = null;
fetch('loops/boxes.json').then((r) => r.json()).then((b) => { boxes = b; }).catch(() => {});
function hideLoop() {
  if (hovered) hovered.classList.remove('play');
  hovered = null; floop.classList.remove('on'); floop.onload = floop.onerror = null; floop.removeAttribute('src');
}
function playLoop(t) {
  if (t === hovered) return;
  hideLoop();
  if (!t) return;
  const sci = t.dataset.sci, name = slug(sci), box = boxes[name], poster = t.querySelector('img.poster');
  if (noLoop.has(sci) || !box || !poster?.naturalWidth) return;
  hovered = t;
  floop.onload = () => {
    if (hovered !== t) return;
    // the poster as drawn (object-fit: contain), then the loop scaled and shifted so its poster box matches it
    const r = poster.getBoundingClientRect(), nw = poster.naturalWidth, nh = poster.naturalHeight;
    const k = Math.min(r.width / nw, r.height / nh), dw = nw * k, dh = nh * k;
    const px = r.left + (r.width - dw) / 2, py = r.top + (r.height - dh) / 2;
    const lw = dw / box[2], lh = dh / box[3];
    Object.assign(floop.style, { left: `${px - box[0] * lw}px`, top: `${py - box[1] * lh}px`, width: `${lw}px`, height: `${lh}px` });
    floop.classList.add('on'); t.classList.add('play');
  };
  floop.onerror = () => { noLoop.add(sci); hideLoop(); };
  floop.src = `loops/${name}.webp`;
}
const leaving = (e, t) => !t.contains(e.relatedTarget);
tiles.addEventListener('mouseover', (e) => { const t = e.target.closest('.tile'); if (t && leaving(e, t)) playLoop(t); });
tiles.addEventListener('mouseout', (e) => { const t = e.target.closest('.tile'); if (t && leaving(e, t) && t === hovered) hideLoop(); });
tiles.addEventListener('focusin', (e) => playLoop(e.target.closest('.tile')));
tiles.addEventListener('focusout', () => hideLoop());
tiles.addEventListener('scroll', hideLoop, { passive: true });

// about & sources
$('about-btn').onclick = () => $('about').showModal();
$('about-close').onclick = () => $('about').close();
$('about').addEventListener('click', (e) => { if (e.target === $('about')) $('about').close(); });   // click outside

// ------------------------------------------------------------------ data
Promise.all([fetch('gallery.json', { cache: 'no-store' }).then((r) => r.json()), map.ready]).then(([d]) => {
  birds = d.birds.filter((b) => b.model);   // the gallery shows the species that have a model
  render();
  const h = decodeURIComponent(location.hash.slice(1)).replace(/_/g, ' ');
  select(birds.find((b) => b.scientific_name === h) || birds[Math.floor(Math.random() * birds.length)]);
  window.addEventListener('hashchange', () => {
    const b = birds.find((x) => x.scientific_name === decodeURIComponent(location.hash.slice(1)).replace(/_/g, ' '));
    if (b && b !== cur) select(b);
  });
}).catch((e) => { $('en').textContent = 'Could not load the gallery'; console.error(e); });
