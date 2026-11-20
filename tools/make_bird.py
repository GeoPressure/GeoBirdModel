#!/usr/bin/env python3
"""Make a flapping 3D bird for GeoLocator Explorer, one step at a time (run from the repo root).

  python3 -I tools/make_bird.py image "Oenanthe oenanthe" [--ref photo.jpg] [--model gpt-image-2-5-sunburst (default) | nano-banana-pro]
      sticker -> in-flight image (Meshy image-to-image). Check work/<Genus_species>/flight.png before going on.
  python3 -I tools/make_bird.py views "Oenanthe oenanthe" [--nosticker]
      flight image -> underside view (1024 px), no legs or feet. Check work/<Genus_species>/views.png.
  python3 -I tools/make_bird.py model "Oenanthe oenanthe" [--single [--from IMAGE_TASK_ID] [--type smart]]
      flight image + underside view -> untextured shape (Meshy multi-image-to-3d)
  python3 -I tools/make_bird.py texture "Oenanthe oenanthe"
      shape -> textured from the flight image + underside view (Meshy retexture) -> raw/<Genus_species>.glb
  python3 -I tools/make_bird.py orient "Oenanthe oenanthe"
      check which way it points (head from geometry, back from colours); must agree with -Y,+Z
  python3 -I tools/make_bird.py rig "Oenanthe oenanthe" [-- extra rig_flap.py options]
      raw model -> flapping GLB, static GLB, preview and close-up sheets in work/<Genus_species>/
  python3 -I tools/make_bird.py options "Oenanthe oenanthe"
      free: every belly (B) x wing beat (W) option as a GLB for the picker (tools/picker.html#Genus_species)
  python3 -I tools/make_bird.py choose "Oenanthe oenanthe" B0 W1
      save the user's pick as rig_args in prompts/species_notes.csv; then rig again
  python3 -I tools/make_bird.py publish "Oenanthe oenanthe"
      copy to models/ (flapping), static/, images/ (flight image), posters/, and rebuild models.json
  python3 -I tools/make_bird.py site all
      rebuild models.json (and missing posters) for every species marked done in status.csv

Every Meshy task id, setting and credit cost is appended to work/<Genus_species>/log.jsonl.
Needs the Meshy CLI (npm exec meshy-cli@0.4.0, signed in) and Blender on the PATH.
"""
import csv
import re
import json
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent          # repository root
MESHY = ["npm", "exec", "--yes", "--package=meshy-cli@0.4.0", "--", "meshy"]
COMMON = ["--output-schema", "v1", "--format", "json", "--no-update-check"]


def meshy(*args, write=False):
    cmd = MESHY + list(args) + COMMON + (["--workspace", str(HERE)] if write else [])
    out = subprocess.run(cmd, capture_output=True, text=True, cwd=HERE)
    try:
        res = json.loads(out.stdout)
    except json.JSONDecodeError:
        sys.exit(f"meshy {' '.join(args[:2])} failed:\n{out.stdout[-800:]}\n{out.stderr[-800:]}")
    if not res.get("ok", True):
        sys.exit(f"meshy {' '.join(args[:2])}: {json.dumps(res.get('error'), indent=1)[:1500]}")
    return res.get("result", res)


def pending_task(sp, kind):
    """A paid Meshy task that was submitted but never finished here (wait or download failed):
    resumed on the next run instead of paying for a new one (Meadow Pipit texture, 2026-11-20)."""
    p = workdir(sp) / "log.jsonl"
    entries = [json.loads(l) for l in open(p)] if p.exists() else []
    done = {e.get("task_id") for e in entries if e.get("step") != "pending"}
    pend = [e["task_id"] for e in entries if e.get("step") == "pending" and e.get("kind") == kind and e["task_id"] not in done]
    return pend[-1] if pend else None


def species_row(sp):
    rows = {r["scientific_name"]: r for r in csv.DictReader(open(HERE / "species.csv"))}
    notes = {r["scientific_name"]: r for r in csv.DictReader(open(HERE / "prompts/species_notes.csv"))}
    if sp not in rows:
        sys.exit(f"{sp} is not in species.csv (run tools/species.py)")
    return rows[sp], notes.get(sp, {})


def workdir(sp):
    d = HERE / "work" / sp.replace(" ", "_")
    d.mkdir(parents=True, exist_ok=True)
    return d


def log(sp, **entry):
    entry["time"] = time.strftime("%Y-%m-%d %H:%M")
    with open(workdir(sp) / "log.jsonl", "a") as f:
        f.write(json.dumps(entry) + "\n")


def last(sp, step):
    p = workdir(sp) / "log.jsonl"
    entries = [json.loads(l) for l in open(p)] if p.exists() else []
    found = [e for e in entries if e.get("step") == step and e.get("task_id")]
    return found[-1] if found else None


def last_any(sp, step):
    p = workdir(sp) / "log.jsonl"
    entries = [json.loads(l) for l in open(p)] if p.exists() else []
    found = [e for e in entries if e.get("step") == step]
    return found[-1] if found else None


def opt(args, name, default=None):
    return args[args.index(name) + 1] if name in args else default


def step_image(sp, args):
    row, note = species_row(sp)
    d = workdir(sp)
    sticker = d / "sticker.webp"
    if not sticker.exists():
        urllib.request.urlretrieve(row["sticker"], sticker)
    feats = note.get("flight_features", "")
    prompt = (HERE / "prompts/flight.txt").read_text().strip().format(
        english=row["english_name"], scientific=sp, features=(": " + feats + ".") if feats else ".")
    refs = [str(sticker)] + ([str(Path(opt(args, "--ref")).resolve())] if "--ref" in args else [])
    if len(refs) > 1:
        prompt += " The first image is the species illustration to redraw; the second is a real photo of the species in flight, use it for the wing and tail pattern and the flight posture."
    model = opt(args, "--model", "gpt-image-2-5-sunburst")
    sub = meshy("image-to-image", "create", "--ai-model", model, "--prompt", prompt,
                "--reference-image-urls", ",".join(refs), "--async")
    tid = sub["submission"]["task_id"]
    print("image task", tid, "- waiting")
    meshy("image-to-image", "wait", tid, "--timeout", "600")
    meshy("download", "--resource", "image-to-image", "--task-id", tid, "--kind", "image",
          "--output-dir", str(d / f"img_{tid[:8]}"), write=True)
    img = next((d / f"img_{tid[:8]}").glob("*"))
    shutil.copy(img, d / "flight.png")
    shutil.copy(img, d / f"flight_{tid[:8]}.png")
    task = meshy("image-to-image", "get", tid)
    credits = (task.get("task") or {}).get("consumed_credits")
    log(sp, step="image", task_id=tid, model=model, refs=refs, prompt=prompt, credits=credits)
    print(f"-> {d / 'flight.png'} (credits {credits})")


def step_model(sp, args):
    """views (default) or a single image -> textured 3D model (Meshy, 30 credits) -> raw/<sp>.glb"""
    d = workdir(sp)
    _, note = species_row(sp)
    single = "--single" in args or "--from" in args
    kind = opt(args, "--type", "standard")
    tprompt = opt(args, "--texture-prompt", note.get("underside", ""))
    if single:
        img = {"task_id": opt(args, "--from")} if "--from" in args else last(sp, "image")
        resource = "image-to-3d"
        cmd = [resource, "create", "--input-task-id", img["task_id"]]
        if kind == "smart":
            cmd += ["--model-type", "smart-topology", "--target-polycount", opt(args, "--polycount", "8000")]
    else:
        views = last(sp, "views")
        if not views:
            sys.exit("run the views step first (or --single for the single-image route)")
        resource = "multi-image-to-3d"
        # the local view files, so a corrected view (e.g. feet painted out) is what gets used
        # flight image FIRST (Meshy takes the first image as the front: the model then comes out like
        # single-image ones, head -Y, back +Z) and the underside view (no legs to invent)
        files = [d / "flight.png", d / "views" / "image_1.png"]
        cmd = [resource, "create", "--image-urls", ",".join(str(f) for f in files)]
    shape_only = not single and "--textured" not in args  # default: shape here, colours in `texture`
    if shape_only:
        cmd += ["--should-texture", "false", "--async"]
    else:
        cmd += ["--should-texture", "true", "--enable-pbr", "false", "--texture-resolution", "2k", "--async"]
        if tprompt:
            cmd += ["--texture-prompt", ("Underside: " + tprompt)[:600]]
    tid = pending_task(sp, "model") if "--new" not in args else None
    if tid:
        print(f"resuming the unfinished 3d task {tid} (paid already; --new for a new one)")
    else:
        sub = meshy(*cmd)
        tid = sub["submission"]["task_id"]
        log(sp, step="pending", kind="model", task_id=tid)
    print("3d task", tid, "- waiting (1-3 min)")
    meshy(resource, "wait", tid, "--timeout", "900")
    out = HERE / "raw" / (f"{sp.replace(' ', '_')}__shape.glb" if shape_only else f"{sp.replace(' ', '_')}.glb")
    if out.exists():
        out.rename(out.with_name(out.stem + f"__old{time.strftime('%Y%m%d%H%M')}.glb"))
    meshy("download", "--resource", resource, "--task-id", tid, "--model-format", "glb",
          "--output", str(out), "--overwrite", write=True)
    task = meshy(resource, "get", tid)
    credits = (task.get("task") or {}).get("consumed_credits")
    log(sp, step="model", task_id=tid, type="single" if single else ("views_shape" if shape_only else "views"),
        inputs=None if single else "flight + underside", orientation=None if single else "-Y,+Z",
        texture_prompt=tprompt, file=str(out.relative_to(HERE)), credits=credits)
    print(f"-> {out} (credits {credits})")


VIEW_PROMPTS = [
    ("top", "seen from directly above: the whole back, both upper wings and the upper tail are visible, "
            "the head points to the top of the image"),
    ("underside", "seen from directly below: the whole belly, the undersides of both wings and the "
                  "undertail are visible, the head points to the top of the image. The belly and vent are "
                  "one continuous area of smooth feathers in the belly colour: no feet, toes, claws or dark "
                  "marks anywhere on the underside (the feet are fully hidden inside the feathers)"),
    ("side", "in a pure side profile, the camera level with the bird, like a flight profile in a field "
             "guide: the bird points to the left of the image, we see the side of the head with one eye, "
             "the body from the side, and the near wing raised above the back; no feet or legs visible"),
]


def step_views(sp, args):
    """flight image -> three separate 1024 px views of the same bird: top, underside, side
    (3 x 9 credits; `--only underside` redoes one). Generated one by one so each view has a
    precise prompt, full resolution and a fixed order (image_0 = top: Meshy takes the first
    image as the front, the rig assumes top-first)."""
    row, note = species_row(sp)
    d = workdir(sp)
    (d / "views").mkdir(exist_ok=True)
    # v4 default: only the underside view (image_1). The shape is built from the flight image +
    # underside: more views disagreed on the eye position and gave two eyes (Robin-Chat).
    only = opt(args, "--only", "underside")
    for i, (name, view) in enumerate(VIEW_PROMPTS):
        if only != "all" and only != name:
            continue
        # The flight image shows the back: for the underside, the notes' underside text and the sticker
        # (which shows breast and belly) are given too. With the flight image alone, Meshy drew the
        # back again for Swainson's and Barred Warbler (2026-11-20, 18 credits lost).
        under = name == "underside"
        plum = (f" The underside plumage is: {note['underside']}; it is NOT the colour of the back."
                if under and note.get("underside") else "")
        # --nosticker: notes text only (the Song Thrush sticker, a standing bird with long pink legs,
        # made Meshy draw tucked feet twice)
        use_st = under and (d / "sticker.webp").exists() and "--nosticker" not in args
        refs = [d / "flight.png"] + ([d / "sticker.webp"] if use_st else [])
        prompt = (f"Redraw this exact {row['english_name']} ({sp}) in flight, {view}.{plum} Gliding with both wings "
                  "fully spread and held straight out level with the body, tail slightly fanned. Keep the same "
                  "bird, proportions and realistic illustration style"
                  + (" (the first image shows its back, the second its breast and belly)" if use_st else "")
                  + (". The legs and feet are fully retracted and hidden in the belly feathers, not visible at all" if under else "")
                  + ". Whole bird in frame, centred, filling most of the image. Plain pure white background (#FFFFFF), no vignette, no gradient, "
                  "no shadow, no text.")
        sub = meshy("image-to-image", "create", "--ai-model", opt(args, "--model", "gpt-image-2-5-sunburst"), "--prompt", prompt,
                    "--reference-image-urls", ",".join(str(r) for r in refs), "--async")
        tid = sub["submission"]["task_id"]
        meshy("image-to-image", "wait", tid, "--timeout", "600")
        tmp = d / f"view_{tid[:8]}"
        meshy("download", "--resource", "image-to-image", "--task-id", tid, "--kind", "image",
              "--output-dir", str(tmp), write=True)
        shutil.copy(next(tmp.glob("*")), d / "views" / f"image_{i}.png")
        task = meshy("image-to-image", "get", tid)
        credits = (task.get("task") or {}).get("consumed_credits")
        log(sp, step="views", view=name, task_id=tid, prompt=prompt, credits=credits)
        print(f"  {name}: image_{i}.png (credits {credits})")
    files = [str(d / "flight.png")] + [str(d / "views" / f"image_{i}.png") for i in range(3)
                                         if (d / "views" / f"image_{i}.png").exists() and (only == "all" or i == 1)]
    subprocess.run(["magick"] + files + ["-resize", "400x400", "+append", str(d / "views.png")], check=True)
    print(f"-> {d / 'views.png'}; check: no legs or feet in any view (above all the underside), same bird and pose")


def step_orient(sp, args):
    """Which way the textured model points (tools/orient.py): head from the geometry, back from the
    colours of both sides against the flight image. Logged for `rig`. A weak colour margin is
    flagged: then look at work/<sp>/orient_*.png and pass --up yourself (e.g. --up=+Z)."""
    name = sp.replace(" ", "_")
    d = workdir(sp)
    r = subprocess.run(["blender", "-b", "--python", str(HERE / "tools/orient.py"), "--",
                        str(HERE / "raw" / f"{name}.glb"), str(d / "flight.png"), str(d / "orient")],
                       check=True, capture_output=True, text=True)
    line = next(l for l in r.stdout.splitlines() if l.startswith("ORIENT"))
    kv = dict(x.split("=") for x in line.split()[1:])
    fwd, up = kv["forward"], opt(args, "--up", kv["up"])
    margin = float(kv["other_side"]) / max(float(kv["colour_distance_up"]), 1e-6)
    log(sp, step="orient", forward=fwd, up=up, margin=round(margin, 2), manual="--up" in args)
    print(f"  head {fwd}, back {up} (colour margin {margin:.1f}x)")
    if margin < 1.5 and "--up" not in args:
        print(f"CHECK WARNING orient: weak colour margin; look at {d}/orient_*.png (the back should be the "
              f"one matching the flight image) and rerun with --up=<axis> if {up} is wrong")


def step_clean(sp, args):
    """raw Meshy model -> work/<sp>/<sp>_clean.glb: levelled, legs removed, belly slimmed, centred, untextured."""
    name = sp.replace(" ", "_")
    src = HERE / "raw" / f"{name}.glb"
    out = workdir(sp) / f"{name}_clean.glb"
    r = subprocess.run(["blender", "-b", "--python", str(HERE / "tools/rig_flap.py"), "--", str(src), str(out),
                        "--clean=1", "--faces=150000"], check=True, capture_output=True, text=True)
    for line in r.stdout.splitlines():
        if line.startswith(("CHECK", "legs", "levelled", "centred")):
            print("  " + line)
    print(f"-> {out} ({out.stat().st_size // 1024} KB)")


def step_texture(sp, args):
    """Colour the untextured shape (Meshy retexture, 10 credits): references are the sharp 1024 px
    flight image first (head and back pattern) and the underside view (belly), nothing else."""
    name = sp.replace(" ", "_")
    d = workdir(sp)
    p_log = workdir(sp) / "log.jsonl"
    shapes = [json.loads(l) for l in open(p_log)] if p_log.exists() else []
    shapes = [e for e in shapes if e.get("step") == "model" and e.get("type") == "views_shape"]
    shape = shapes[-1] if shapes else None
    if not shape:
        sys.exit("run `model` (shape from the views) first")
    if "--resume" in args:
        tid = opt(args, "--resume")
    elif pending_task(sp, "texture") and "--new" not in args:
        tid = pending_task(sp, "texture")
        print(f"resuming the unfinished texture task {tid} (paid already; --new for a new one)")
    else:
        # Only references that don't see the same surface: the flight image (top and head, sharp)
        # and the underside view. A second view of the head (side or three-quarter) is projected
        # with a small offset and paints a second eye (Robin-Chat).
        refs = [d / "flight.png", d / "views" / "image_1.png"]
        sub = meshy("retexture", "create", "--input-task-id", shape["task_id"],
                    "--multiview-image-urls", ",".join(str(r) for r in refs), "--enable-original-uv", "true",
                    "--enable-pbr", "false", "--texture-resolution", "2k", "--target-formats", "glb", "--async")
        tid = sub["submission"]["task_id"]
        log(sp, step="pending", kind="texture", task_id=tid)
    print("texture task", tid, "- waiting (1-3 min)")
    meshy("retexture", "wait", tid, "--timeout", "900")
    out = HERE / "raw" / f"{name}.glb"
    if out.exists():
        out.rename(out.with_name(out.stem + f"__old{time.strftime('%Y%m%d%H%M')}.glb"))
    meshy("download", "--resource", "retexture", "--task-id", tid, "--model-format", "glb",
          "--output", str(out), "--overwrite", write=True)
    task = meshy("retexture", "get", tid)
    credits = (task.get("task") or {}).get("consumed_credits")
    # logged as the model the rig uses: multi-view, no legs, orientation as the shape (top view first)
    log(sp, step="model", task_id=tid, type="views", source="retexture", shape_task=shape["task_id"],
        orientation=shape.get("orientation") or "-Y,+Z", file=str(out.relative_to(HERE)), credits=credits)
    print(f"-> {out} (credits {credits})")


def rig_inputs(sp, args, rig_args=None):
    """Source GLB, output path and rig_flap.py options for a species (orientation, flight style,
    per-species `rig_args` from prompts/species_notes.csv, then command-line extras after --)."""
    d = workdir(sp)
    name = sp.replace(" ", "_")
    variant = opt(args, "--variant", "")
    src = HERE / "raw" / f"{name}{variant}.glb"
    _, note = species_row(sp)
    style = note.get("flight_style", "continuous")
    extra = args[args.index("--") + 1:] if "--" in args else []
    # per-species rig settings (prompts/species_notes.csv, column rig_args), before command-line extras
    extra = ((note.get("rig_args") or "") if rig_args is None else rig_args).split() + extra
    style_args = {"continuous": [], "floppy": ["--amp=40"], "bounding": [], "glide": ["--amp=22"]}.get(style, [])
    out = d / f"{name}{variant}.glb"
    m = last(sp, "model")
    o = last_any(sp, "orient")
    if m and m.get("type") == "views":
        # multi-view models have no legs to remove; orientation from `orient` (or as logged)
        fwd_up = [o["forward"], o["up"]] if o else m.get("orientation", "-Y,+Z").split(",")
        # legs kept by default: on leg-free shapes the leg search cut the thin undertail (Tree Pipit,
        # Savi's Warbler, Horned Lark). When the review shows legs (5 of 10 tier-2 shapes had some),
        # set --legs=delete in the species' rig_args (prompts/species_notes.csv). 2026-11-20
        style_args = style_args + [f"--forward={fwd_up[0]}", f"--up={fwd_up[1]}", "--legs=keep"]
    elif o:
        style_args = style_args + [f"--forward={o['forward']}", f"--up={o['up']}"]
    return d, name, variant, src, out, style_args, extra


def step_rig(sp, args):
    d, name, variant, src, out, style_args, extra = rig_inputs(sp, args)
    r = subprocess.run(["blender", "-b", "--python", str(HERE / "tools/rig_flap.py"), "--", str(src), str(out)]
                       + style_args + extra, check=True, capture_output=True, text=True)
    if "Traceback" in r.stdout + r.stderr:  # Blender exits 0 when the script fails: the old GLB would stay
        sys.exit("rig_flap.py failed:\n" + (r.stdout + r.stderr)[-1500:])
    for line in r.stdout.splitlines():
        if line.startswith(("CHECK", "legs", "levelled", "faces", "welded", "wings levelled", "body half-width")):
            print("  " + line)
    # Body deformation over the wing beat (only the wings may move)
    r = subprocess.run(["blender", "-b", "--python", str(HERE / "tools/deform.py"), "--", str(out)],
                       check=True, capture_output=True, text=True)
    body = [float(l.split()[1]) for l in r.stdout.splitlines() if l.startswith("BODY")]
    if body and body[0] > 0.005:
        print(f"  CHECK WARNING body moves with the wing beat: {body[0]:.4f} half-span (limit 0.005); "
              "see `blender -b --python tools/deform.py -- <model>`")
    elif body:
        print(f"  CHECK body steady over the wing beat ({body[0]:.4f} half-span)")
    subprocess.run(["blender", "-b", "--python", str(HERE / "tools/render_bird.py"), "--", str(out),
                    str(d / "r"), "1,7,13,19", "bird,front,side,below"], check=True, capture_output=True)
    rows = [" ".join(str(d / f"r_{v}_{f:02d}.png") for f in (1, 7, 13, 19)) for v in ("bird", "front", "side", "below")]
    subprocess.run("magick " + " ".join(f"\\( {r} +append \\)" for r in rows) + f" -append -resize 60% {d / 'preview.png'}",
                   shell=True, check=True)
    subprocess.run(["blender", "-b", "--python", str(HERE / "tools/render_bird.py"), "--", str(out),
                    str(d / "r"), "1", "closeup,closedown"], check=True, capture_output=True)
    subprocess.run(["magick", str(d / "r_closeup_01.png"), str(d / "r_closedown_01.png"), "+append", str(d / "closeup.png")], check=True)
    static = d / f"{name}{variant}_static.glb"
    subprocess.run(["blender", "-b", "--python", str(HERE / "tools/render_head.py"), "--", str(out), str(d / "h")],
                   check=True, capture_output=True)
    subprocess.run(["magick", str(d / "h_left.png"), str(d / "h_right.png"), str(d / "h_top.png"), str(d / "h_front.png"),
                    "+append", "-resize", "70%", str(d / "head.png")], check=True)
    subprocess.run(["blender", "-b", "--python", str(HERE / "tools/rig_flap.py"), "--", str(src), str(static),
                    "--static=1", "--faces=100000"] + [a for a in style_args if a.startswith(("--forward", "--up"))],
                   check=True, capture_output=True)
    subprocess.run(f"magick \\( {d / 'preview.png'} -resize 1000x \\) \\( {d / 'head.png'} -resize 1000x \\) "
                   f"-gravity center -background white -append {d / 'review.png'}", shell=True, check=True)
    print(f"  REVIEW {d / 'review.png'}: rows bird view / head-on / side / below, then head left/right/top/front")
    print(f"-> {out} ({out.stat().st_size // 1024} KB), static {static.stat().st_size // 1024} KB, "
          f"preview {d / 'preview.png'} (bird view, head-on, side, below), close-up {d / 'closeup.png'}, head {d / 'head.png'}")


RIG_CHOICE_OPTS = ("--belly=", "--bias=", "--levelwings=", "--amp=")


def step_options(sp, args):
    """Rig alternatives (free) for the interactive picker: every belly depth (B) x wing beat (W)
    combination as a flapping GLB in work/<sp>/options/, listed in options.json. The user picks in
    http://localhost:8091/tools/picker.html#Genus_species (◀ ▶ per setting, speed, views);
    `choose` saves the pick in prompts/species_notes.csv (rig_args)."""
    from concurrent.futures import ThreadPoolExecutor
    d, name, variant, src, out, style_args, extra = rig_inputs(sp, [])
    row, note = species_row(sp)
    cur = (note.get("rig_args") or "").split()
    keep = [a for a in cur if not a.startswith(RIG_CHOICE_OPTS)]
    cur_belly = [a for a in cur if a.startswith("--belly=")]
    cur_wing = [a for a in cur if a.startswith(("--bias=", "--levelwings=", "--amp="))]
    od = d / "options"; od.mkdir(exist_ok=True)
    for f in od.glob("*.glb"):
        f.unlink()
    r = subprocess.run(["blender", "-b", "--python", str(HERE / "tools/rig_flap.py"), "--", str(src), str(od / "base.glb")]
                       + style_args + keep, check=True, capture_output=True, text=True)
    ratio = float(re.search(r"body depth/length ([0-9.]+)", r.stdout).group(1))
    rest = float(re.search(r"wings rest at ([+-][0-9]+) deg", r.stdout).group(1))
    h = round(rest / 2)
    belly = [("B0", "as generated", ["--belly=9"]), ("B1", "10% slimmer", [f"--belly={ratio * 0.9:.3f}"]),
             ("B2", "20% slimmer", [f"--belly={ratio * 0.8:.3f}"]), ("B3", "30% slimmer", [f"--belly={ratio * 0.7:.3f}"])]
    if ratio > 0.30:
        belly.insert(1, ("Bd", f"default ({100 * (1 - 0.30 / ratio):.0f}% slimmer)", []))
    wing = [("W0", f"as generated (wings rest {rest:+.0f} deg)", ["--bias=0"]),
            ("W1", f"half levelled (centre {rest - h:+.0f} deg)", [f"--bias={-h}"]),
            ("W2", "levelled (centre 0 deg)", [f"--bias={-round(rest)}"]),
            ("W3", f"half levelled, smaller beat", [f"--bias={-h}", "--amp=26"])]
    if cur_belly and cur_belly not in [a for _, _, a in belly]:
        belly.append(("Bc", "previous choice", cur_belly))
    if cur_wing and cur_wing not in [a for _, _, a in wing]:
        wing.append(("Wc", "previous choice", cur_wing))
    find = lambda lst, a, dflt: next((c for c, _, x in lst if x == a), dflt)
    cur_b = find(belly, cur_belly, "B0") if cur_belly else ("Bd" if ratio > 0.30 else "B0")
    cur_w = find(wing, cur_wing, "W0") if cur_wing else "W0"

    def build(bw):
        (bc, _, ba), (wc, _, wa) = bw
        subprocess.run(["blender", "-b", "--python", str(HERE / "tools/rig_flap.py"), "--", str(src),
                        str(od / f"{bc}_{wc}.glb")] + style_args + keep + ba + wa, check=True, capture_output=True)
    combos = [(b, w) for b in belly for w in wing]
    print(f"  building {len(combos)} combinations ...", flush=True)
    with ThreadPoolExecutor(3) as ex:
        list(ex.map(build, combos))
    js = {"scientific_name": sp, "english_name": row.get("english_name", ""), "keep": " ".join(keep),
          "belly": [{"code": c, "label": l, "args": " ".join(a)} for c, l, a in belly],
          "wing": [{"code": c, "label": l, "args": " ".join(a)} for c, l, a in wing],
          "current": {"belly": cur_b, "wing": cur_w}}
    (od / "options.json").write_text(json.dumps(js, indent=1))
    (od / "codes.txt").write_text("".join(f"{c}: {' '.join(a) or '(default)'}  {l}\n" for c, l, a in belly + wing))
    print(f"  PICKER http://localhost:8091/tools/picker.html#{name}")
    print(f'  then: python3 -I tools/make_bird.py choose "{sp}" B? W?')


def step_choose(sp, args):
    """Save the chosen options rows (e.g. B0 W1) as the species' rig_args."""
    d = workdir(sp)
    codes = {l.split(":")[0]: l.split(":", 1)[1].split("  ")[0].strip()
             for l in (d / "options" / "codes.txt").read_text().splitlines() if l}
    picked = [a for c in args for a in codes[c].replace("(default)", "").split()]
    _, note = species_row(sp)
    keep = [a for a in (note.get("rig_args") or "").split() if not a.startswith(RIG_CHOICE_OPTS)]
    if not any(c.startswith("B") for c in args):  # keep the current belly choice
        keep += [a for a in (note.get("rig_args") or "").split() if a.startswith("--belly=")]
    if not any(c.startswith("W") for c in args):  # keep the current wing choice
        keep += [a for a in (note.get("rig_args") or "").split() if a.startswith(("--bias=", "--amp=", "--levelwings="))]
    new = " ".join(keep + picked)
    path = HERE / "prompts" / "species_notes.csv"
    rows = list(csv.DictReader(open(path)))
    fields = list(rows[0].keys())
    for r in rows:
        if r["scientific_name"] == sp:
            r["rig_args"] = new
    w = csv.DictWriter(open(path, "w", newline=""), fieldnames=fields); w.writeheader(); w.writerows(rows)
    log(sp, step="choose", options=" ".join(args), rig_args=new)
    print(f"  rig_args = {new!r}; now run rig and publish")


def step_publish(sp, args):
    name = sp.replace(" ", "_")
    d = workdir(sp)
    for sub in ("models", "static", "images", "posters"):
        (HERE / sub).mkdir(exist_ok=True)
    shutil.copy(d / f"{name}.glb", HERE / "models" / f"{name}.glb")
    shutil.copy(d / f"{name}_static.glb", HERE / "static" / f"{name}.glb")
    subprocess.run(["magick", str(d / "flight.png"), "-resize", "1024x1024>", "-quality", "85",
                    str(HERE / "images" / f"{name}.webp")], check=True)
    poster(sp, force=True)
    step_site(sp, args)
    print(f"-> models/, static/, images/, posters/ {name}; models.json updated. Check status.csv.")


def poster(sp, force=False):
    name = sp.replace(" ", "_")
    out = HERE / "posters" / f"{name}.webp"
    src = HERE / "models" / f"{name}.glb"
    if out.exists() and not force:
        return
    tmp = workdir(sp) / "poster.png"
    # field-guide three-quarter view, framed on the whole bird (tools/render_poster.py)
    subprocess.run(["blender", "-b", "--python", str(HERE / "tools/render_poster.py"), "--", str(src),
                    str(tmp)], check=True, capture_output=True)
    subprocess.run(["magick", str(tmp), "-trim", "+repage", "-resize", "800x600>",
                    "-quality", "84", str(out)], check=True)


def step_credits(sp, args):
    """Total Meshy credits spent on a species, from its log."""
    p = workdir(sp) / "log.jsonl"
    entries = [json.loads(l) for l in open(p)] if p.exists() else []
    total = sum(e.get("credits") or 0 for e in entries)
    print(f"{sp}: {total} credits over {sum(1 for e in entries if e.get('credits'))} paid tasks")
    return total


def step_site(_sp, _args):
    """Rebuild models.json from status.csv, species.csv and the files present."""
    species = {r["scientific_name"]: r for r in csv.DictReader(open(HERE / "species.csv"))}
    birds = []
    for st in csv.DictReader(open(HERE / "status.csv")):
        sp, name = st["scientific_name"], st["scientific_name"].replace(" ", "_")
        if st["status"] != "done" or not (HERE / "models" / f"{name}.glb").exists():
            continue
        poster(sp)
        row = species.get(sp, {})
        entry = {
            "scientific_name": sp,
            "english_name": row.get("english_name", ""),
            "model": f"models/{name}.glb",
            "poster": f"posters/{name}.webp",
            "size_kb": (HERE / "models" / f"{name}.glb").stat().st_size // 1024,
            "animation": "Fly",
        }
        if (HERE / "static" / f"{name}.glb").exists():
            entry["static"] = f"static/{name}.glb"
            entry["static_size_kb"] = (HERE / "static" / f"{name}.glb").stat().st_size // 1024
        if (HERE / "images" / f"{name}.webp").exists():
            entry["flight_image"] = f"images/{name}.webp"
        entry.update({
            "quality": st.get("quality", "") or "pending",
            "quality_notes": st.get("quality_notes", ""),
            "sticker": row.get("sticker", ""),
            "method": st.get("method", ""),
            "notes": st.get("notes", ""),
            "updated": time.strftime("%Y-%m-%d", time.localtime((HERE / "models" / f"{name}.glb").stat().st_mtime)),
            "license": "CC-BY-4.0",
            "attribution": "GeoBirdModel (Raphaël Nussbaumer), from huashu-bird-sticker illustrations by Huashu (CC BY 4.0)",
        })
        birds.append(entry)
    birds.sort(key=lambda e: e["scientific_name"])
    for e in birds:
        row = species.get(e["scientific_name"], {})
        e["tier"], e["n_tags"], e["tag_id"] = row.get("tier", ""), row.get("n_tags", ""), row.get("tag_id", "")
    # Every species the Explorer needs (species.csv, from the Master GeoLocator Data Package), so the
    # gallery also shows what is still missing.
    have = {e["scientific_name"] for e in birds}
    missing = [{"scientific_name": sp, "english_name": r.get("english_name", ""), "quality": "missing",
                "quality_notes": "no model yet" + (f"; {r['notes']}" if r.get("notes") else ""), "sticker": r.get("sticker", ""), "tier": r.get("tier", ""),
                "n_tags": r.get("n_tags", ""), "tag_id": r.get("tag_id", "")} for sp, r in species.items() if sp not in have]
    # Taxonomy for applications (fallback to a relative when a species has no model): order and
    # family from the huashu sticker path (stickers/<Order>/<Family>/<Genus_species>.webp), genus from
    # the name, and the sticker's own name as a synonym when it differs (genus changes).
    def taxo(sp, sticker):
        parts = (sticker or "").split("/stickers/")[-1].split("/") if "/stickers/" in (sticker or "") else []
        order, family = (parts[0], parts[1]) if len(parts) >= 3 else ("", "")
        syn = parts[-1].rsplit(".", 1)[0].replace("_", " ") if parts else ""
        return {"genus": sp.split()[0], "family": family, "order": order,
                "synonyms": [syn] if syn and syn != sp else []}
    for e in birds + missing:
        e.update(taxo(e["scientific_name"], e.get("sticker", "")))
    head = {
        "schema": "bird-models/2",
        "axes": {"up": "+Y", "forward": "+Z", "origin": "body centre", "units": "wingspan about 0.5"},
        "animation": "Fly",
        "resolver": "client/bird-models.js",
        "fallback_order": ["species", "synonym", "genus", "family", "generic"],
        "description": "Flapping 3D bird models for GeoLocator Explorer's bird view (models/), with the static "
                       "model as generated (static/) and the in-flight source image (images/). glTF binary; "
                       "flapping models have one looping animation 'Fly'; standard glTF axes: back +Y, head +Z, "
                       "origin at the centre of the body.",
        "license": "CC-BY-4.0",
        "source": "https://github.com/GeoPressure/GeoBirdModel",
    }
    # Quality gate: the Explorer (models.json) only gets birds the user marked good or ok; the
    # gallery (gallery.json) shows every bird with its status. Other species keep the generic bird.
    released = [b for b in birds if b["quality"] in ("good", "ok")]
    # taxonomy of every other tracked or planned species (no released model): lets an application
    # pick a relative (same genus, then same family) instead of the generic bird
    rel = {b["scientific_name"] for b in released}
    taxonomy = [{k: e[k] for k in ("scientific_name", "english_name", "genus", "family", "order", "synonyms")}
                for e in birds + missing if e["scientific_name"] not in rel]
    (HERE / "models.json").write_text(json.dumps({**head, "birds": released, "taxonomy": taxonomy},
                                                 indent=1, ensure_ascii=False) + "\n")
    (HERE / "gallery.json").write_text(json.dumps({**head, "birds": birds + missing}, indent=1, ensure_ascii=False) + "\n")
    print(f"models.json: {len(released)} birds released (good/ok); gallery.json: {len(birds)} birds + {len(missing)} missing")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    step, sp, args = sys.argv[1], sys.argv[2], sys.argv[3:]
    {"image": step_image, "views": step_views, "model": step_model, "clean": step_clean, "texture": step_texture,
     "orient": step_orient,
     "rig": step_rig, "options": step_options, "choose": step_choose, "publish": step_publish, "site": step_site, "credits": step_credits}[step](sp, args)
