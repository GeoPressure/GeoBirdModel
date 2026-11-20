// Habitat map for the gallery (../index.html): one track of a species over the RESOLVE habitat
// layer (../habitats/, made by tools/species_habitats.R), with its key places (breeding and
// wintering sites, long stopovers: habitats/places.json, tools/name_places.R). Zoom (wheel, pinch,
// double click, buttons) and pan (drag). A click on a place, a landmark, a point of the track or a
// habitat area calls onPick({ kind, scene, ... }); highlight(scene) brings out the habitats of that
// scene and fades the others (cross-fade). Plain 2D canvas: no WebGL context.
// The raster is decoded, indexed by habitat and faded in a worker (habitat-worker.js), so the main thread
// stays free while the page loads; ready resolves with the JSON indexes, before the raster.

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const FADE_MS = 380;
const KEEP_FADED = 4;   // faded rasters kept (each is 3600 x 1800 px, 26 MB)

export class HabitatMap {
  constructor(canvas, { base = 'habitats/', onPick = () => {} } = {}) {
    this.cv = canvas; this.base = base; this.onPick = onPick;
    this.sp = null; this.sel = null; this.view = null; this.fit = null;
    this.pad = { top: 0, bottom: 0 };   // px kept free above and below the track (floating panels)
    this.hl = null; this.hlFrom = null; this.hlT = 1; this.want = null; this.faded = new Map(); this.fading = new Map(); this.ripples = [];
    // tooltip: the habitat or place under the cursor
    this.tip = document.createElement('div'); this.tip.className = 'tip'; this.tip.setAttribute('aria-hidden', 'true');
    canvas.parentElement.appendChild(this.tip);
    this.ready = this.load();
    this.bind();
    new ResizeObserver(() => { this.refit(false); this.draw(); }).observe(canvas);
  }

  async load() {
    const [index, places] = await Promise.all([
      fetch(this.base + 'geo/index.json').then((r) => r.json()),
      fetch(this.base + 'places.json').then((r) => r.json()).catch(() => ({})),
    ]);
    this.index = index; this.places = places;
    this.indexed = this.loadRaster();
    this.indexed.catch((e) => console.error(e));
  }
  // the raster (this.img) and the habitat index of every pixel (this.idx)
  loadRaster() {
    const url = new URL(this.base + 'habitats.png', location.href).href, colours = this.index.habitats.map((h) => h.colour);
    let w = null;
    try { if (typeof OffscreenCanvas !== 'undefined') w = new Worker(new URL('./habitat-worker.js', import.meta.url)); } catch (e) { w = null; }
    if (!w) return this.loadRasterHere(url, colours);
    this.worker = w;
    return new Promise((res, rej) => {
      w.onerror = (e) => { e.preventDefault?.(); this.worker = null; w.terminate(); this.loadRasterHere(url, colours).then(res, rej); };
      w.onmessage = ({ data: m }) => {
        if (m.type === 'image') { this.img = m.bitmap; this.refit(false); this.draw(); }
        else if (m.type === 'index') { this.idx = m.idx; res(); }
        else if (m.type === 'faded') this.fading.get(m.scene)?.res(m.bitmap);
      };
      w.postMessage({ type: 'load', url, colours });
    });
  }
  // without a worker (no OffscreenCanvas): the same, on the main thread
  async loadRasterHere(url, colours) {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    this.img = img; this.refit(false); this.draw();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    this.pixData = g.getImageData(0, 0, img.width, img.height);
    const P = this.pixData.data, rgb = colours.map(hex);
    // habitat index of every pixel (255: none), colours matched once per distinct colour
    const cache = new Map(), idx = new Uint8Array(img.width * img.height);
    for (let i = 0, o = 0; i < idx.length; i++, o += 4) {
      const key = (P[o] << 16) | (P[o + 1] << 8) | P[o + 2];
      let v = cache.get(key);
      if (v === undefined) {
        v = rgb.findIndex((c) => Math.abs(c[0] - P[o]) + Math.abs(c[1] - P[o + 1]) + Math.abs(c[2] - P[o + 2]) < 6);
        if (v < 0) v = 255; cache.set(key, v);
      }
      idx[i] = v;
    }
    this.idx = idx;
  }

  async species(sci) {
    await this.ready;
    const e = this.index.species.find((s) => s.scientific_name === sci);
    if (!e) return null;
    const sp = await fetch(this.base + e.file).then((r) => r.json());
    sp.places = this.places[sci] || [];
    return sp;
  }

  set(sp) { this.sp = sp; this.sel = null; this.head = null; this.refit(true); this.draw(); }
  // migration playback: a marker at (lon, lat) after path point i (float); the map follows it
  setPlayhead(h) {
    this.head = h;
    if (h && this.view) {
      const x = this.X(h.lon), y = this.Y(h.lat), W = this.cv.clientWidth, H = this.cv.clientHeight, m = 40;
      if (x < m || x > W - m || y < this.pad.top + m || y > H - this.pad.bottom - m) {
        this.view.cx = h.lon; this.view.cy = h.lat + ((this.pad.top - this.pad.bottom) / 2) * this.view.k / this.view.s; this.clamp();
      }
    }
    this.draw();
  }
  select(sel) { this.sel = sel; this.draw(); }

  // ---------------------------------------------------------------- habitat highlight
  // the cross-fade starts once the faded raster of the new scene is ready (made in the worker)
  highlight(scene) {
    this.want = scene;
    if (scene === this.hl) return;
    this.fadedReady(scene).then(() => {
      if (this.want !== scene || scene === this.hl) return;
      this.hlFrom = this.hl; this.hl = scene; this.hlT = 0;
      const t0 = performance.now();
      const step = (t) => { this.hlT = Math.min(1, (t - t0) / FADE_MS); this.draw(); if (this.hlT < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }).catch(() => {});
  }
  // the habitat raster with every habitat but those of `scene` faded (a few kept), or the raster itself
  fadedImage(scene) { return (scene && this.faded.get(scene)) || this.img; }
  async fadedReady(scene) {
    if (!scene) return;
    await this.ready; await this.indexed;
    if (this.faded.has(scene)) return;
    const on = this.index.habitats.map((h) => h.scene === scene);
    if (!on.some(Boolean)) return;
    let img;
    if (this.worker) {
      if (!this.fading.has(scene)) {   // one request per scene; { p: its promise, res: resolved by onmessage }
        const f = {}; f.p = new Promise((res) => { f.res = res; });
        this.fading.set(scene, f);
        this.worker.postMessage({ type: 'fade', scene, on });
      }
      img = await this.fading.get(scene).p;
      this.fading.delete(scene);
      if (this.faded.has(scene)) return;
    } else {
      const src = this.pixData.data, out = new ImageData(this.img.width, this.img.height), D = out.data;
      const bg = [246, 244, 238], k = 0.68;
      for (let i = 0, o = 0; i < this.idx.length; i++, o += 4) {
        const v = this.idx[i];
        if (v !== 255 && on[v]) { D[o] = src[o]; D[o + 1] = src[o + 1]; D[o + 2] = src[o + 2]; }
        else { D[o] = src[o] + (bg[0] - src[o]) * k; D[o + 1] = src[o + 1] + (bg[1] - src[o + 1]) * k; D[o + 2] = src[o + 2] + (bg[2] - src[o + 2]) * k; }
        D[o + 3] = 255;
      }
      img = document.createElement('canvas'); img.width = this.img.width; img.height = this.img.height;
      img.getContext('2d').putImageData(out, 0, 0);
    }
    this.faded.set(scene, img);
    // keep a few: drop the oldest that is not on screen
    for (const key of this.faded.keys()) {
      if (this.faded.size <= KEEP_FADED) break;
      if (key !== this.hl && key !== this.hlFrom && key !== this.want && key !== scene) { this.faded.get(key).close?.(); this.faded.delete(key); }
    }
  }

  // ---------------------------------------------------------------- view
  // equirectangular, x scaled by cos(mid latitude) of the track; view = centre + px per degree
  refit(reset) {
    const W = this.cv.clientWidth, H = this.cv.clientHeight;
    if (!W || !H) return;
    let x0 = -20, y0 = -35, x1 = 60, y1 = 70;                    // no track: Africa and Europe
    if (this.sp) {
      [x0, y0, x1, y1] = this.sp.bbox;
      const pad = Math.max(2.5, 0.1 * Math.max(x1 - x0, y1 - y0));
      x0 -= pad; x1 += pad; y0 = Math.max(-80, y0 - pad); y1 = Math.min(80, y1 + pad);
    }
    const k = Math.cos(((y0 + y1) / 2) * Math.PI / 180);
    const pt = this.pad.top, pb = Math.min(this.pad.bottom, H * 0.45), Hf = Math.max(80, H - pt - pb);
    const s = Math.min(W / (x1 - x0), (Hf * k) / (y1 - y0));
    const fit = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 + ((pt - pb) / 2) * k / s, s, k };
    if (reset || !this.view || !this.fit) this.view = { ...fit };
    else this.view.s *= fit.s / this.fit.s;                        // keep the zoom level on resize
    this.fit = fit;
    this.clamp();
  }
  clamp() {
    const v = this.view, f = this.fit;
    v.s = Math.min(Math.max(v.s, f.s * 0.6), f.s * 16);
    v.cx = Math.min(Math.max(v.cx, -180), 180); v.cy = Math.min(Math.max(v.cy, -80), 80);
  }
  X(lon) { return (lon - this.view.cx) * this.view.s + this.cv.clientWidth / 2; }
  Y(lat) { return (this.view.cy - lat) * this.view.s / this.view.k + this.cv.clientHeight / 2; }
  lonlat(x, y) {
    const v = this.view;
    return [v.cx + (x - this.cv.clientWidth / 2) / v.s, v.cy - (y - this.cv.clientHeight / 2) * v.k / v.s];
  }
  zoom(f, x = this.cv.clientWidth / 2, y = this.cv.clientHeight / 2) {
    if (!this.view) return;
    const [lon, lat] = this.lonlat(x, y);
    this.view.s *= f; this.clamp();
    const v = this.view;   // keep (lon, lat) under (x, y)
    v.cx = lon - (x - this.cv.clientWidth / 2) / v.s;
    v.cy = lat + (y - this.cv.clientHeight / 2) * v.k / v.s;
    this.clamp(); this.draw();
  }
  reset() { this.refit(true); this.draw(); }

  // ---------------------------------------------------------------- input
  bind() {
    const cv = this.cv, pts = new Map();
    let drag = null, pinch = null, moved = false;
    const xy = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(Math.exp(-e.deltaY * 0.0018), ...xy(e)); }, { passive: false });
    cv.addEventListener('dblclick', (e) => { e.preventDefault(); this.zoom(e.shiftKey ? 0.5 : 2, ...xy(e)); });
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, xy(e)); moved = false;
      if (pts.size === 1) drag = { p: xy(e), cx: this.view?.cx, cy: this.view?.cy };
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: this.view?.s }; drag = null;
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) { const [x, y] = xy(e), h = this.hit(x, y, true); cv.style.cursor = h ? 'pointer' : 'grab'; this.showTip(h, x, y); return; }
      pts.set(e.pointerId, xy(e));
      this.showTip(null);
      if (!this.view) return;
      if (pinch && pts.size === 2) {
        const [a, b] = [...pts.values()];
        const f = (pinch.s * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d) / this.view.s;
        this.zoom(f, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); moved = true;
      } else if (drag) {
        const [x, y] = xy(e), dx = x - drag.p[0], dy = y - drag.p[1];
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        if (!moved) return;
        cv.style.cursor = 'grabbing';
        this.view.cx = drag.cx - dx / this.view.s; this.view.cy = drag.cy + dy * this.view.k / this.view.s;
        this.clamp(); this.draw();
      }
    });
    const up = (e) => {
      if (!pts.has(e.pointerId)) return;
      const p = pts.get(e.pointerId); pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 0) {
        if (!moved && e.type === 'pointerup') { const h = this.hit(...p, true); this.ripple(...p); if (h) { this.sel = h; this.draw(); this.onPick(h); } }
        drag = null; cv.style.cursor = 'grab';
      }
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => this.showTip(null));
  }
  showTip(h, x, y) {
    const t = this.tip;
    if (!h) { t.classList.remove('on'); return; }
    const p = h.pl, KIND = { breeding: 'breeding site', wintering: 'wintering site', stopover: 'stopover' };
    t.textContent = h.kind === 'place' ? `${p.town || p.country || ''} · ${KIND[p.kind]}, ${Math.round(p.days)} days`
      : h.kind === 'landmark' ? h.lm.name : h.h?.label || '';
    t.style.left = x + 'px'; t.style.top = y + 'px';
    t.classList.toggle('on', !!t.textContent);
  }
  // feedback on click: a ring that widens and fades where the map was clicked
  ripple(x, y) {
    const [lon, lat] = this.lonlat(x, y);
    this.ripples.push({ lon, lat, t0: performance.now() });
    if (this.ripples.length > 1) return;
    const step = () => { this.draw(); if (this.ripples.length) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  // what is under (x, y): place, landmark, stopover, flight point, or (area) the habitat
  hit(x, y, area = false) {
    const sp = this.sp; if (!this.view || !this.index) return null;
    const d2 = (lon, lat) => (this.X(lon) - x) ** 2 + (this.Y(lat) - y) ** 2;
    const H = this.index.habitats;
    let best = null, bd = 14 ** 2;
    if (sp) {
      for (const p of sp.places) { const d = d2(p.lon, p.lat); if (d < bd) { bd = d; best = { kind: 'place', pl: p, h: H[p.habitat], scene: H[p.habitat]?.scene }; } }
      for (const l of sp.landmarks) { const d = d2(l.lon, l.lat); if (d < bd) { bd = d; best = { kind: 'landmark', lm: l, scene: l.scene }; } }
      if (!best) {
        bd = 9 ** 2;
        for (const s of sp.stops) { if (s[2] < 1) continue; const d = d2(s[0], s[1]); if (d < bd) { bd = d; best = { kind: 'stop', s, h: H[s[3]], scene: H[s[3]].scene }; } }
        for (const p of sp.path) { const d = d2(p[0], p[1]); if (d < bd) { bd = d; best = { kind: 'flight', p, h: H[p[2]], scene: H[p[2]].scene }; } }
      }
    }
    if (!best && area && this.idx) {
      const [lon, lat] = this.lonlat(x, y), w = this.img.width, ppd = w / 360;
      const px = Math.floor((lon + 180) * ppd), py = Math.floor((90 - lat) * ppd);
      if (px >= 0 && py >= 0 && px < w && py < this.img.height) {
        const i = this.idx[py * w + px];
        if (i !== 255) best = { kind: 'area', h: H[i], scene: H[i].scene, lon, lat };
      }
    }
    return best?.scene ? best : null;
  }

  // ---------------------------------------------------------------- drawing
  raster(g, img, W, H) {
    const ppd = this.img.width / 360;
    const [lon0, lat1] = this.lonlat(0, 0), [lon1, lat0] = this.lonlat(W, H);
    const sx0 = Math.max(0, (lon0 + 180) * ppd), sx1 = Math.min(this.img.width, (lon1 + 180) * ppd);
    const sy0 = Math.max(0, (90 - lat1) * ppd), sy1 = Math.min(this.img.height, (90 - lat0) * ppd);
    if (sx1 <= sx0 || sy1 <= sy0) return;
    const dx0 = this.X(sx0 / ppd - 180), dx1 = this.X(sx1 / ppd - 180), dy0 = this.Y(90 - sy0 / ppd), dy1 = this.Y(90 - sy1 / ppd);
    g.imageSmoothingEnabled = this.view.s / ppd < 3;   // crisp habitat cells when zoomed far in
    g.drawImage(img, sx0, sy0, sx1 - sx0, sy1 - sy0, dx0, dy0, dx1 - dx0, dy1 - dy0);
  }
  draw() {
    const cv = this.cv, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#a9c9e6'; g.fillRect(0, 0, W, H);
    if (!this.img || !this.view) return;
    if (!this.fit) this.refit(true);
    // habitats: cross-fade from the previous highlight to the new one
    this.raster(g, this.fadedImage(this.hlFrom), W, H);
    if (this.hlT > 0) { g.globalAlpha = this.hlT; this.raster(g, this.fadedImage(this.hl), W, H); g.globalAlpha = 1; }
    const sp = this.sp; if (!sp) { this.drawRipples(g); return; }

    const X = (l) => this.X(l), Y = (l) => this.Y(l), v = this.view;
    const NIGHT = '#22305a', DAY = '#e08a1e', CASE = 'rgba(255,255,255,.92)', INK = '#1b1d22', TRAVEL = '#c0392b';
    g.lineJoin = 'round'; g.lineCap = 'round';
    const P = sp.path, S = sp.stops, flights = [];
    for (const p of P) (flights[p[4]] ||= []).push(p);
    const lines = [];
    flights.forEach((f, i) => {
      if (!f) return;
      const from = S[i - 1], to = S[i];
      const pts = [from ? [from[0], from[1], 0, f[0][3]] : f[0], ...f, to ? [to[0], to[1], 0, f[f.length - 1][3]] : f[f.length - 1]];
      for (let j = 1; j < pts.length; j++) lines.push([pts[j - 1], pts[j], pts[j][3]]);
    });
    const seg = (a, b) => { g.beginPath(); g.moveTo(X(a[0]), Y(a[1])); g.lineTo(X(b[0]), Y(b[1])); g.stroke(); };
    const lw = Math.min(1.6, Math.max(1, Math.sqrt(v.s / this.fit.s)));
    g.strokeStyle = CASE; g.lineWidth = 4.5 * lw; lines.forEach(([a, b]) => seg(a, b));
    g.lineWidth = 2.2 * lw;
    for (const [a, b, n] of lines) { g.strokeStyle = n === 1 ? NIGHT : n === 0 ? DAY : '#8a8a8a'; seg(a, b); }
    // playback: the part already flown, drawn over the track
    if (this.head) {
      const n = Math.floor(this.head.i);
      g.strokeStyle = TRAVEL; g.lineWidth = 3.4 * lw;
      g.beginPath(); g.moveTo(X(P[0][0]), Y(P[0][1]));
      for (let j = 1; j <= n && j < P.length; j++) g.lineTo(X(P[j][0]), Y(P[j][1]));
      g.lineTo(X(this.head.lon), Y(this.head.lat)); g.stroke();
    }
    for (const st of S) {
      if (st[2] < 2) continue;
      const r = Math.max(2.2, Math.min(5.5, Math.sqrt(st[2]) * 0.55)) * lw;
      g.beginPath(); g.arc(X(st[0]), Y(st[1]), r, 0, 2 * Math.PI);
      g.fillStyle = '#fff'; g.fill(); g.lineWidth = 1.2; g.strokeStyle = NIGHT; g.stroke();
    }

    // labels: key places (town, upright) first, then landmarks (seas, deserts: italic); overlaps skipped
    const sel = this.sel, boxes = [];
    const isSel = (o) => (sel && (sel.pl === o || sel.lm === o) ? 1 : 0);
    const label = (x, y, text, font, on) => {
      g.font = font; g.textBaseline = 'middle';
      const w = g.measureText(text).width, bw = w + 6, bh = 15, by = y - 7.5;
      const right = y < 118 ? W - 44 : W - 4;   // keep clear of the zoom buttons
      const left = x + 9 + bw > right ? x - 9 - bw : x + 9;
      if (!on && boxes.some((b) => left < b[0] + b[2] && left + bw > b[0] && by < b[1] + b[3] && by + bh > b[1])) return;
      boxes.push([left, by, bw, bh]);
      g.lineWidth = 3.2; g.strokeStyle = CASE; g.strokeText(text, left + 3, y);
      g.fillStyle = INK; g.fillText(text, left + 3, y);
    };
    const pin = (x, y, r, on, fill) => {
      g.beginPath(); g.arc(x, y, on ? r + 1.2 : r, 0, 2 * Math.PI);
      g.fillStyle = fill; g.fill(); g.lineWidth = on ? 2.2 : 1.6; g.strokeStyle = INK; g.stroke();
    };
    const RANK = { breeding: 0, wintering: 1, stopover: 2 };
    const places = [...sp.places].sort((a, b) => (isSel(b) - isSel(a)) || (RANK[a.kind] - RANK[b.kind]) || (b.days - a.days));
    const lms = [...sp.landmarks].sort((a, b) => (isSel(b) - isSel(a)) || (b.km - a.km));
    // pins first (all visible), labels after so the important ones win the space
    for (const p of places) {
      const x = X(p.lon), y = Y(p.lat), on = isSel(p);
      if (p.kind === 'stopover') pin(x, y, 4.5, on, '#fff');
      else {   // breeding: house-like square, wintering: filled circle
        g.save(); g.translate(x, y);
        if (p.kind === 'breeding') { g.beginPath(); g.rect(-5, -5, 10, 10); } else { g.beginPath(); g.arc(0, 0, 6, 0, 2 * Math.PI); }
        if (on) g.scale(1.2, 1.2);
        g.fillStyle = p.kind === 'breeding' ? '#e0565b' : '#2f8fd1'; g.fill();
        g.lineWidth = 1.8; g.strokeStyle = '#fff'; g.stroke(); g.restore();
      }
    }
    for (const l of lms) pin(X(l.lon), Y(l.lat), 3.6, isSel(l), '#fff');
    for (const p of places) {
      const days = p.days >= 1.5 ? ` · ${Math.round(p.days)} d` : '';
      const name = p.town || p.country || (p.kind === 'breeding' ? 'Breeding site' : 'Stopover');
      label(X(p.lon), Y(p.lat), name + (p.kind === 'stopover' ? days : ''), `${p.kind === 'stopover' ? 500 : 600} 11.5px Sora, system-ui, sans-serif`, isSel(p));
    }
    for (const l of lms) label(X(l.lon), Y(l.lat), l.name, 'italic 500 11px Sora, system-ui, sans-serif', isSel(l));

    if (this.head) {
      const x = X(this.head.lon), y = Y(this.head.lat), t = performance.now() / 1000;
      g.beginPath(); g.arc(x, y, 9 + 5 * (0.5 + 0.5 * Math.sin(t * 4)), 0, 2 * Math.PI);
      g.fillStyle = 'rgba(192,57,43,.2)'; g.fill();
      g.beginPath(); g.arc(x, y, 6.5, 0, 2 * Math.PI);
      g.fillStyle = TRAVEL; g.fill(); g.lineWidth = 2; g.strokeStyle = '#fff'; g.stroke();
    }
    this.drawRipples(g);
  }
  drawRipples(g) {
    const now = performance.now(), RIP_MS = 650;
    this.ripples = this.ripples.filter((r) => now - r.t0 < RIP_MS);
    for (const r of this.ripples) {
      const k = (now - r.t0) / RIP_MS, e = 1 - (1 - k) ** 3;
      g.beginPath(); g.arc(this.X(r.lon), this.Y(r.lat), 4 + 22 * e, 0, 2 * Math.PI);
      g.lineWidth = 2.5 * (1 - k) + 0.5; g.strokeStyle = `rgba(27,29,34,${0.8 * (1 - k)})`; g.stroke();
    }
  }
}
