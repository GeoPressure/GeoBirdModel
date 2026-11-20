// bird-models resolver (ES module, no dependencies). Applications load it from the same
// versioned URL as the models, so new birds and better matching need no application release:
//
//   const BASE = "https://cdn.jsdelivr.net/gh/GeoPressure/GeoBirdModel@2/";
//   const bm = await import(/* @vite-ignore */ BASE + "client/bird-models.js");
//   const index = await bm.loadIndex(BASE);
//   const m = bm.resolve(index, "Turdus philomelos");
//   // m = { url, match: "species" | "synonym" | "genus" | "family" | null, bird, attribution,
//   //       animation: "Fly", axes: { up: "+Y", forward: "+Z" }, quaternion: [x, y, z, w] }
//   // m.url === null  -> no model: use your own generic bird.
//
// Contract (schema "bird-models/2"; a breaking change gets a new major tag, e.g. @3):
// - models.json lists released birds (quality good or ok) with `model` relative to BASE, genus,
//   family, order and synonyms, plus `taxonomy` for tracked/planned species without a model.
// - Models are glTF binary, one looping animation "Fly", standard glTF axes (back +Y, head +Z),
//   origin at the body centre, wingspan about 0.5 units.
// - `quaternion` turns the model from its axes into the frame the caller asks for (see `frame`).

export const SCHEMA = "bird-models/2";

/** Fetch and check models.json. Resolves to null (caller uses its generic bird) on any failure. */
export async function loadIndex(base, { fetchImpl = fetch } = {}) {
  try {
    const r = await fetchImpl(new URL("models.json", base).toString());
    if (!r.ok) return null;
    const d = await r.json();
    if (!String(d.schema || "").startsWith("bird-models/2")) return null;
    return { ...d, base };
  } catch {
    return null;
  }
}

const norm = (s) => String(s || "").trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
const genusOf = (s) => norm(s).split(" ")[0];

// Frames a caller may want the model in. "gltf": as stored (back +Y, head +Z).
// "map-y-forward": head +Y, back +Z (e.g. Threebox / Mapbox, where Z is up): a 180 deg turn
// about (0, 1, 1)/sqrt(2), which swaps y and z and flips x.
const FRAMES = {
  gltf: [0, 0, 0, 1],
  "map-y-forward": [0, Math.SQRT1_2, Math.SQRT1_2, 0],
};

/**
 * Best model for a species: exact name, synonym, same genus, same family, else url null.
 * `options.family` may give the family when the species is not in the index's taxonomy.
 * `options.minMatch` ("species" | "genus" | "family") stops the fallback early.
 */
export function resolve(index, scientificName, { family = "", frame = "gltf", minMatch = "family" } = {}) {
  const none = { url: null, match: null, bird: null, attribution: "", animation: "Fly", axes: null, quaternion: FRAMES[frame] };
  if (!index || !Array.isArray(index.birds)) return none;
  const name = norm(scientificName);
  const birds = index.birds;
  const levels = ["species", "synonym", "genus", "family"];
  const stopAt = levels.indexOf(minMatch === "species" ? "synonym" : minMatch);
  const tax = (index.taxonomy || []).find((t) => norm(t.scientific_name) === name || (t.synonyms || []).some((s) => norm(s) === name));
  const fam = norm(family || tax?.family || "");
  const pick = (b, match) => ({
    url: new URL(b.model, index.base).toString(),
    match,
    bird: b,
    attribution: b.attribution || "GeoBirdModel, CC BY 4.0",
    animation: index.animation || "Fly",
    axes: index.axes || null,
    quaternion: FRAMES[frame] || FRAMES.gltf,
  });
  // prefer good over ok among relatives
  const rank = (b) => (b.quality === "good" ? 0 : 1);
  const best = (list) => list.sort((a, b) => rank(a) - rank(b))[0];
  let b = birds.find((x) => norm(x.scientific_name) === name);
  if (b) return pick(b, "species");
  b = birds.find((x) => (x.synonyms || []).some((s) => norm(s) === name) || (tax && (tax.synonyms || []).some((s) => norm(s) === norm(x.scientific_name))));
  if (b) return pick(b, "synonym");
  if (stopAt < 2) return none;
  b = best(birds.filter((x) => norm(x.genus || genusOf(x.scientific_name)) === genusOf(name)));
  if (b) return pick(b, "genus");
  if (stopAt < 3 || !fam) return none;
  b = best(birds.filter((x) => norm(x.family) === fam));
  if (b) return pick(b, "family");
  return none;
}

/** Does the index have a model for this exact species (or a synonym)? */
export function has(index, scientificName) {
  const m = resolve(index, scientificName, { minMatch: "species" });
  return m.match === "species" || m.match === "synonym";
}
