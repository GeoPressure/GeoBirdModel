# Turn a static bird GLB (wings spread, from Meshy) into a small, flapping GLB for GeoLocator Explorer.
#
#   blender -b --python rig_flap.py -- in.glb out.glb [--key=value ...]
#
# Input orientation (Blender frame after glTF import): --forward / --up give the head and back
# directions (Meshy models: --forward=-Y --up=+Z). Wings lie along the remaining axis.
# Output frame: standard glTF, back up (+Y), head forward (+Z), wings along X, origin at the
# centre of the body, wingspan --wingspan units (0.5), one looping clip "Fly". Any glTF viewer
# then orbits around the bird; GeoLocator Explorer (Z-up map) rotates it when loading.
#
# Options (defaults in brackets):
#   --faces [20000]     decimate to this many triangles after welding UV seams (0 = keep)
#   --tex [2048]        base-colour texture size   --normal [1024] normal map size (0 = drop)
#   --imgfmt [WEBP]     texture format in the GLB (WEBP or JPEG), --q [85] quality
#   --legs [delete]     delete | fold | keep : remove the legs below the belly line (Meshy adds
#                       them even when the image has none); never touches head/bill or tail
#   --static [0]       1 = export the levelled Meshy model as made (legs kept, no rig); use
#                       with --faces=100000 for the gallery's static model
#   --belly [0.30]      max body depth/length; plumper bodies are slimmed below the mid-line
#   --amp [32]          inner-wing half amplitude (deg)     --bias [0] mean wing angle (deg); --levelwings=1 levels them
#   --outer [0.6]       outer-wing amplitude relative to inner, lagging by --lag [0.9] rad
#   --sweep [12]        wing-tip sweep back on the upstroke (deg)
#   --bob [0.006]       body rise on the downstroke (fraction of wingspan x2)
#   --pitch [1.5]         body pitch with the beat (deg)
#   --head [stable]     stable : head counter-moves so it stays still while the body bobs
#                       follow : head moves with the body
#   --frames [24] --fps [24]   loop length (1 s)
#   --shoulder [0.18] --elbow [0.55]   joint positions as fractions of the half-span
import bpy, sys, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]
opt = dict(a[2:].split("=", 1) for a in argv[2:] if a.startswith("--"))
num = lambda k, d: float(opt.get(k, d))
AX = {"X": Vector((1, 0, 0)), "Y": Vector((0, 1, 0)), "Z": Vector((0, 0, 1))}
def axis(s):
    v = AX[s[-1].upper()].copy()
    return -v if s.startswith("-") else v
# Meshy's output orientation: single image, or multi-view with the top view first: head -Y,
# back +Z. Another first view gives another orientation: pass --forward/--up (make_bird.py
# reads them from the model's log entry).
fwd_opt, up_opt = opt.get("forward", "-Y"), opt.get("up", "+Z")
shoulder, elbow = num("shoulder", 0.18), num("elbow", 0.55)  # shoulder: measured unless given
amp, bias, outer, lag = num("amp", 32), num("bias", 0), num("outer", 0.6), num("lag", 0.9)
sweep, bob, pitch = num("sweep", 12), num("bob", 0.006), num("pitch", 1.5)  # halved 2026-11-19: belly motion too visible
fps, nfr = int(num("fps", 24)), int(num("frames", 24))
wingspan = num("wingspan", 0.5)
smooth = lambda t: (lambda u: u * u * (3 - 2 * u))(min(1.0, max(0.0, t)))


def orient_glb(path, quat=(0.0, 1.0, 0.0, 0.0)):
    """Put the scene's root nodes under one node rotated by quat (x, y, z, w): 180 deg about Y."""
    import json, struct
    data = open(path, "rb").read()
    jlen = struct.unpack("<I", data[12:16])[0]
    j = json.loads(data[20:20 + jlen])
    rest = data[20 + jlen:]
    sc0 = j["scenes"][j.get("scene", 0)]
    j["nodes"].append({"name": "orient", "rotation": list(quat), "children": sc0["nodes"]})
    sc0["nodes"] = [len(j["nodes"]) - 1]
    js = json.dumps(j, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + len(rest)) + struct.pack("<II", len(js), 0x4E4F534A) + js + rest
    open(path, "wb").write(out)

# --- import, join, clean -------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
meshes = [o for o in sc.objects if o.type == "MESH"]
for o in sc.objects: o.select_set(False)
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1: bpy.ops.object.join()
bird = bpy.context.view_layer.objects.active
mw = bird.matrix_world.copy(); bird.parent = None; bird.matrix_world = mw
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(sc.objects):
    if o.type != "MESH": bpy.data.objects.remove(o)

# Weld vertices duplicated along UV seams (UVs are per face corner, so they survive). Without
# this, decimation moves each side of a seam on its own and opens cracks that show the sky.
import bmesh
bm = bmesh.new(); bm.from_mesh(bird.data)
size = max(bird.dimensions)
nv = len(bm.verts)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5 * size)
print(f"welded {nv - len(bm.verts)} seam vertices")
bm.to_mesh(bird.data); bm.free()


tex = int(num("tex", 2048))
ntex = int(num("normal", 1024))  # normal map size, 0 = drop (keeps the feather relief)
for m in bird.data.materials:
    if not (m and m.use_nodes): continue
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    for n in list(nt.nodes):
        feeds_normal = n.type == "TEX_IMAGE" and any(l.to_node.type == "NORMAL_MAP" for l in n.outputs[0].links)
        if ntex and (n.type == "NORMAL_MAP" or feeds_normal):
            if feeds_normal and n.image and n.image.size[0] > ntex: n.image.scale(ntex, ntex)
            continue
        if n.type in ("NORMAL_MAP", "SEPARATE_COLOR", "SEPRGB", "SEPARATE_RGB") or (
                n.type == "TEX_IMAGE" and n.image and n.image.colorspace_settings.name != "sRGB"):
            nt.nodes.remove(n)
    # Meshy's metallic/roughness texture, once unlinked, would otherwise export as metallic 1 (renders black).
    for name in ("Metallic", "Roughness"):
        for l in list(bsdf.inputs[name].links): nt.links.remove(l)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.85
for im in bpy.data.images:
    if tex and im.colorspace_settings.name == "sRGB" and im.size[0] > tex: im.scale(tex, tex)

# --- working frame: span X, head +Y, back +Z, centred, wingspan scaled ---------------------
# Orientation. Meshy's output orientation depends on the input (single image: head -Y, back +Z;
# multi-view: the first view is taken as the front), so it is read from the geometry:
# wingspan = longest axis; body = longer remaining axis near the middle; up = the side the wings
# are on (they attach to the back); head = the round end, tail = the flat, wide end.
def detect_orientation(obj):
    import numpy as np
    c = np.empty(len(obj.data.vertices) * 3); obj.data.vertices.foreach_get("co", c); c = c.reshape(-1, 3)
    c = c - (c.min(0) + c.max(0)) / 2
    ext = c.max(0) - c.min(0)
    s_ax = int(np.argmax(ext)); half_s = ext[s_ax] / 2
    rest = [a for a in range(3) if a != s_ax]
    core = c[np.abs(c[:, s_ax]) < 0.12 * half_s]
    ce = core.max(0) - core.min(0)
    b_ax = rest[0] if ce[rest[0]] >= ce[rest[1]] else rest[1]
    u_ax = rest[1] if b_ax == rest[0] else rest[0]
    # wing roots (not tips, which can droop) sit at the back, above the middle of the body
    roots = c[(np.abs(c[:, s_ax]) > 0.2 * half_s) & (np.abs(c[:, s_ax]) < 0.4 * half_s)]
    up_sign = 1 if np.median(roots[:, u_ax]) >= np.median(core[:, u_ax]) else -1
    lo, hi = core[:, b_ax].min(), core[:, b_ax].max(); L = hi - lo
    def flatness(end):
        sel = core[(core[:, b_ax] > hi - 0.15 * L)] if end > 0 else core[(core[:, b_ax] < lo + 0.15 * L)]
        w = np.ptp(sel[:, s_ax]) if len(sel) else 0.0
        t = np.ptp(sel[:, u_ax]) if len(sel) else 0.0
        return t / max(w, 1e-9)  # thickness / width: round head ~1, flat tail << 1
    head_sign = 1 if flatness(+1) >= flatness(-1) else -1
    v = lambda a, sgn: Vector([sgn if i == a else 0 for i in range(3)])
    return v(b_ax, head_sign), v(u_ax, up_sign)
fwd, up = axis(fwd_opt), axis(up_opt)
# Cross-check the head direction from the geometry (round head vs flat tail; reliable on all
# models so far). "Up" can't be read reliably (wings may droop below the body), so not checked.
_df, _du = detect_orientation(bird)
if abs(_df.dot(fwd)) < 0.5 or _df.dot(fwd) < 0:
    print(f"CHECK WARNING orientation: the geometry suggests the head points {tuple(_df)}, not {tuple(fwd)}; "
          "check that the top view was first in views/ or pass --forward/--up")
right = fwd.cross(up)
bird.data.transform(Matrix((right, fwd, up)).to_4x4())
# Roll: a banked pose in the image gives a model with one wing up and one down. Level the
# span: main axis (x-z plane) of the vertices far out on the wings, rotated about the body axis.
if opt.get("roll", "1") == "1":
    import numpy as _np
    _c = _np.empty(len(bird.data.vertices) * 3); bird.data.vertices.foreach_get("co", _c); _c = _c.reshape(-1, 3)
    _c = _c - _c.mean(axis=0)
    _r = _np.hypot(_c[:, 0], _c[:, 2])
    _w = _c[_r > 0.5 * _r.max()]
    sxx = (_w[:, 0] ** 2).sum(); szz = (_w[:, 2] ** 2).sum(); sxz = (_w[:, 0] * _w[:, 2]).sum()
    roll = 0.5 * math.atan2(2 * sxz, sxx - szz)
    if abs(math.degrees(roll)) > 3:
        bird.data.transform(Matrix.Rotation(roll, 4, "Y"))
        print(f"CHECK rolled wings level by {math.degrees(roll):.1f} deg")
vs = [v.co for v in bird.data.vertices]
xs = [v.x for v in vs]
half = (max(xs) - min(xs)) / 2; cx = (max(xs) + min(xs)) / 2
core = [v for v in vs if abs(v.x - cx) < 0.15 * half] or vs
cy = sum(v.y for v in core) / len(core); cz = sum(v.z for v in core) / len(core)
bird.data.transform(Matrix.Translation((-cx, -cy, -cz)))
bird.data.transform(Matrix.Scale((wingspan / 2) / half, 4))
half = wingspan / 2

# Level the body: models made from a three-quarter view come out pitched (head up, tail down).
# Rotate about X so the main axis of the body (in the y-z plane, wings excluded) is horizontal.
if opt.get("level", "1") == "1":
    core = [v.co for v in bird.data.vertices if abs(v.co.x) < 0.12 * half]
    my = sum(v.y for v in core) / len(core); mz = sum(v.z for v in core) / len(core)
    syy = sum((v.y - my) ** 2 for v in core); szz = sum((v.z - mz) ** 2 for v in core)
    syz = sum((v.y - my) * (v.z - mz) for v in core)
    ang = 0.5 * math.atan2(2 * syz, syy - szz)  # angle of the main axis above +Y
    bird.data.transform(Matrix.Rotation(-ang, 4, "X"))
    print(f"levelled body by {math.degrees(-ang):.1f} deg")
vs = [v.co for v in bird.data.vertices]
core = [v for v in vs if abs(v.x) < 0.12 * half]

# --- legs ----------------------------------------------------------------------------------
# Meshy adds legs even when the image has none. Legs and toes are found by their thickness:
# from each vertex of the lower body a ray is cast inward (against its normal) to the opposite
# surface. Legs and toes are a few mm thick, the belly is a whole body thick, whatever the
# bird's shape or pose. Only the part under the body is searched: never the head and bill
# (a long down-curved bill is thin too: hoopoe), the tail, or the wings.
from mathutils.bvhtree import BVHTree
ymin_c, ymax_c = min(v.y for v in core), max(v.y for v in core)
ylo, yhi = num("rear", 0.45) * ymin_c, 0.4 * ymax_c  # not the undertail coverts (thin feather sheets)
static = opt.get("static", "0") == "1"  # static: the Meshy model as made (legs kept), no rig
clean = opt.get("clean", "0") == "1"    # clean: levelled, legs removed, slimmed, centred; untextured, for Meshy retexture
legs_mode = "keep" if static else opt.get("legs", "delete")
thin = num("thin", 0.05) * half
if legs_mode != "keep":
    bm = bmesh.new(); bm.from_mesh(bird.data)
    bm.normal_update()
    tree = BVHTree.FromBMesh(bm)
    cand = [v for v in bm.verts if abs(v.co.x) < 0.22 * half and ylo <= v.co.y < yhi and v.co.z < 0]
    dead = set()
    for v in cand:
        n = v.normal
        if n.length < 0.5: continue
        hit = tree.ray_cast(v.co - n * 1e-4 * half, -n, 0.5 * half)
        if hit[0] is not None and hit[3] < thin:
            dead.add(v)
    # grow a little so the cut is clean, but stay under the body mid-line
    for _ in range(2):
        dead |= {e.other_vert(v) for v in list(dead) for e in v.link_edges if e.other_vert(v).co.z < 0}
    span = (max(v.co.y for v in dead) - min(v.co.y for v in dead)) / half if dead else 0
    if dead:
        bmesh.ops.delete(bm, geom=list(dead), context="VERTS")
    # drop loose bits and small islands (toe tips cut off from the leg)
    seen, islands = set(), []
    for v in bm.verts:
        if v in seen: continue
        stack, isl = [v], []
        seen.add(v)
        while stack:
            u = stack.pop(); isl.append(u)
            for e in u.link_edges:
                w = e.other_vert(u)
                if w not in seen: seen.add(w); stack.append(w)
        islands.append(isl)
    big = max(len(i) for i in islands)
    small = [u for isl in islands if len(isl) < 0.01 * big for u in isl]
    if small: bmesh.ops.delete(bm, geom=small, context="VERTS")
    # Close each opening by pulling its rim together into one point just inside the body: the
    # belly around it stretches over the hole with its own texture (a filled patch has no
    # texture coordinates and shows a wrong colour). Openings are small: only leg roots.
    rim = {v for e in bm.edges if e.is_boundary for v in e.verts}
    holes, seen = [], set()
    for v in rim:
        if v in seen: continue
        stack, loop = [v], []
        seen.add(v)
        while stack:
            u = stack.pop(); loop.append(u)
            for e in u.link_edges:
                if e.is_boundary:
                    w = e.other_vert(u)
                    if w not in seen: seen.add(w); stack.append(w)
        holes.append(loop)
    widest = 0.0
    centres = []
    for loop in holes:
        c = sum((u.co for u in loop), Vector()) / len(loop)
        widest = max(widest, max((u.co - c).length for u in loop) / half)
        bmesh.ops.pointmerge(bm, verts=loop, merge_co=c + Vector((0, 0, 0.005 * half)))
        centres.append(c)
    # Smooth the belly around each closed leg root: removes the remaining stubs and lumps
    # (the thick, feathered top of the leg) that would otherwise get painted as legs.
    r = 0.07 * half
    near = [v for v in bm.verts if v.co.z < 0 and any((v.co - c).length < r for c in centres)]
    if near:
        for _ in range(30):
            bmesh.ops.smooth_vert(bm, verts=near, factor=0.6, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.to_mesh(bird.data); bm.free()
    print(f"legs deleted: {len(dead)} thin vertices over {span:.2f} half-span, {len(holes)} openings closed (widest {widest:.2f} half-span)")
    if span > 0.7 or widest > 0.15:  # clean results so far: span <= 0.6, openings <= 0.12
        print("CHECK WARNING legs: large region or opening; look at the side and close-up previews")
    if not dead:
        print("CHECK legs: none found (Meshy may have modelled them tucked against the belly)")

# --- per-species clean-ups (rig_args in prompts/species_notes.csv; free, no Meshy) ----------
# --smoothvent=N: N passes of volume-preserving smoothing on the lower body and vent, where the
#   cut-off legs of older single-image models left lumps (Black-eared Wheatear, Thrush Nightingale).
# --cleanbelly=1: repaint dark spots on the lower body's texture (leg stumps and claws Meshy
#   painted on the belly: White-chested Alethe, Lesser Grey Shrike) with the surrounding colour.
#   Only for plain bellies: streaks and bars are dark spots too.
_sv = int(num("smoothvent", 0))
if _sv > 0:
    vg = bird.vertex_groups.new(name="_vent")
    for v in bird.data.vertices:
        w = (smooth((-v.co.z - 0.02 * half) / (0.06 * half)) * (1 - smooth((abs(v.co.x) - 0.15 * half) / (0.08 * half)))
             * smooth((v.co.y - 0.9 * ymin_c) / (0.1 * abs(ymin_c))) * (1 - smooth((v.co.y - 0.4 * ymax_c) / (0.15 * ymax_c))))
        if w > 1e-3: vg.add([v.index], w, "REPLACE")
    mod = bird.modifiers.new("_ls", "LAPLACIANSMOOTH")
    mod.vertex_group = vg.name; mod.iterations = _sv; mod.lambda_factor = 1.0; mod.use_volume_preserve = False
    bpy.context.view_layer.objects.active = bird
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bird.vertex_groups.remove(bird.vertex_groups["_vent"])
    print(f"CHECK smoothed the lower body and vent ({_sv} passes)")
if opt.get("cleanbelly", "0") == "1":
    import numpy as np
    me = bird.data; uvl = me.uv_layers.active.data
    imgs = {n.image for m in me.materials if m and m.use_nodes for n in m.node_tree.nodes
            if n.type == "TEX_IMAGE" and n.image and n.image.colorspace_settings.name == "sRGB"}
    for img in imgs:
        W, H = img.size
        px = np.empty(W * H * 4, np.float32); img.pixels.foreach_get(px); px = px.reshape(H, W, 4)
        mask = np.zeros((H, W), bool)
        for poly in me.polygons:
            c = poly.center
            if c.z < -0.03 * half and abs(c.x) < 0.2 * half and 0.85 * ymin_c < c.y < 0.5 * ymax_c:
                us = [uvl[i].uv.x for i in poly.loop_indices]; vs = [uvl[i].uv.y for i in poly.loop_indices]
                x0, x1 = int(min(us) * W), int(max(us) * W) + 1; y0, y1 = int(min(vs) * H), int(max(vs) * H) + 1
                if x1 - x0 < 64 and y1 - y0 < 64:
                    mask[max(y0, 0):y1, max(x0, 0):x1] = True
        def box(a, r):  # mean filter (2r+1)^2 by summed-area table
            c = np.pad(a, ((r + 1, r), (r + 1, r)), mode="edge").cumsum(0).cumsum(1)
            return c[2 * r + 1:, 2 * r + 1:] - c[:-2 * r - 1, 2 * r + 1:] - c[2 * r + 1:, :-2 * r - 1] + c[:-2 * r - 1, :-2 * r - 1]
        L = px[..., :3] @ np.array([0.299, 0.587, 0.114], np.float32)
        r = max(6, W // 100); m = mask.astype(np.float32)
        mean = box(L * m, r) / np.maximum(box(m, r), 1e-6)
        spot = mask & (L < 0.75 * mean)
        spot = box(spot.astype(np.float32), 2) > 0  # grow by 2 px: soft dark rims
        spot &= mask
        keep = m * (~spot)
        R = 3 * r
        for ch in range(3):
            fill = box(px[..., ch] * keep, R) / np.maximum(box(keep, R), 1e-6)
            px[..., ch][spot] = fill[spot]
        img.pixels.foreach_set(px.ravel()); img.update(); img.pack()
        print(f"CHECK repainted {100 * spot.sum() / max(mask.sum(), 1):.1f}% of the lower body's texture (dark spots)")

# --- belly ---------------------------------------------------------------------------------
# Meshy often builds a plump, perched-looking body; in flight the plumage is sleek. Body depth
# (back to belly, in the middle third of the body, legs already removed) relative to body
# length; above the target, the lower body is squeezed towards the mid-line.
mid = [v.co for v in bird.data.vertices if abs(v.co.x) < 0.12 * half and abs(v.co.y) < 0.15 * (ymax_c - ymin_c)]
zt = max(v.z for v in mid); zb = min(v.z for v in mid)
ratio = (zt - zb) / (ymax_c - ymin_c)
target = num("belly", 0.30)
print(f"CHECK body depth/length {ratio:.3f} (target <= {target:.3f})")
if ratio > target and not static:
    s = target / ratio
    zc = zt - (zt - zb) * 0.5
    x0b = shoulder * half
    for v in bird.data.vertices:
        w = 1 - smooth((abs(v.co.x) - x0b) / (0.25 * half))
        if w > 0 and v.co.z < zc:
            v.co.z = zc + (v.co.z - zc) * (1 - 2 * (1 - s) * w)
    print(f"CHECK slimmed the lower body (depth -{100 * (1 - s):.0f}%)")

# --- centre on the body: the model rotates and is placed around this point (viewer, Explorer).
# Mean of the body (core, behind the neck and in front of the tail), not of the bounding box,
# which raised wings, a long bill or tail pull away from the bird.
_b = [v.co for v in bird.data.vertices if abs(v.co.x) < 0.12 * half and ylo <= v.co.y < yhi]
if _b:
    _my = sum(v.y for v in _b) / len(_b); _mz = sum(v.z for v in _b) / len(_b)
    bird.data.transform(Matrix.Translation((0, -_my, -_mz)))
    print(f"centred on the body (moved {_my / half:.3f}, {_mz / half:.3f} half-span)")

# --- decimate (after the leg and belly steps, which need the dense mesh) ---------------
faces = int(num("faces", 20000))
if faces and len(bird.data.polygons) > faces:
    dec = bird.modifiers.new("Decimate", "DECIMATE")
    dec.decimate_type = "COLLAPSE"; dec.ratio = faces / len(bird.data.polygons); dec.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=dec.name)
print("faces", len(bird.data.polygons))

if clean:
    # Untextured cleaned mesh for Meshy retexture (texture painted after the legs are gone).
    bird.data.materials.clear()
    bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_animations=False, export_yup=True,
                              export_materials="NONE")
    orient_glb(dst)  # same as the flapping model: head +Z, back +Y in glTF
    print("EXPORTED", dst)
    sys.exit(0)
if static:
    # Static model: same frame and scale as the flapping one, legs and body as Meshy made them.
    bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_animations=False,
                              export_yup=True, export_apply=False, export_image_format=opt.get("imgfmt", "WEBP"),
                              export_image_quality=int(num("q", 85)))
    orient_glb(dst)  # same as the flapping model: head +Z, back +Y in glTF
    print("EXPORTED", dst)
    sys.exit(0)

# --- armature ------------------------------------------------------------------------------
vs = [v.co for v in bird.data.vertices]
core = [v for v in vs if abs(v.x) < 0.12 * half]
ymax = max(v.y for v in core)
neck = num("neck", 0.70) * ymax  # neck joint near the head: further back, the breast stretched as the head stays still (nightjar)
arm_data = bpy.data.armatures.new("BirdRig")
arm = bpy.data.objects.new("BirdRig", arm_data); sc.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
eb = arm_data.edit_bones
root = eb.new("root"); root.head = (0, -0.05, 0); root.tail = (0, 0.05, 0)
head = eb.new("head"); head.head = (0, neck, 0); head.tail = (0, ymax, 0); head.parent = root
# Shoulder joint at the edge of the body (measured on this bird), and the height of the wing
# roots: wings attach at the back, so flanks and belly below that plane must stay with the body
# (a fixed shoulder made the belly of wide-bodied birds move with every wing beat).
import numpy as np
_co = np.array([v.co[:] for v in bird.data.vertices])
# Body edge: across the middle of the bird, the body is where the cross-section is thick;
# wings are thin sheets. Thickness (z range) per x bin; the body runs out from the centre while
# thickness stays above 40% of the centre's. (Taking "everything below the wing roots" counted
# drooping wings as body: Robin-Chat.)
_len = ymax - min(v.y for v in core)
_mid = _co[np.abs(_co[:, 1]) < 0.12 * _len]
_bins = np.linspace(0, half, 41)
_thick = []
for a, b in zip(_bins[:-1], _bins[1:]):
    sel = _mid[(np.abs(_mid[:, 0]) >= a) & (np.abs(_mid[:, 0]) < b)]
    _thick.append(float(np.ptp(sel[:, 2])) if len(sel) > 3 else 0.0)
_t0 = max(_thick[:3]) if any(_thick[:3]) else 1.0
body_hw = _bins[1]
for i, t in enumerate(_thick):
    if t < 0.4 * _t0:
        break
    body_hw = _bins[i + 1]
body_hw = float(body_hw)
# The same per slice along the body: the breast in front of the wings is often wider than the
# middle (Mangrove Kingfisher: 0.15 vs 0.125 half-span), and its lower sides followed the wing.
def _edge(sl):
    th = []
    for a, b in zip(_bins[:-1], _bins[1:]):
        sel = sl[(np.abs(sl[:, 0]) >= a) & (np.abs(sl[:, 0]) < b)]
        th.append(float(np.ptp(sel[:, 2])) if len(sel) > 3 else 0.0)
    t0 = max(th[:3]) if any(th[:3]) else 0.0
    hw = 0.0
    for i, t in enumerate(th):
        if t0 == 0 or t < 0.4 * t0:
            break
        hw = _bins[i + 1]
    return float(hw)
_ys = np.linspace(ymax - _len, ymax, 15)
_yc = (_ys[:-1] + _ys[1:]) / 2
_hw_y = [min(max(_edge(_co[(_co[:, 1] >= a) & (_co[:, 1] < b)]), body_hw), 0.32 * half) for a, b in zip(_ys[:-1], _ys[1:])]
hw_at = lambda y: float(np.interp(y, _yc, _hw_y))
print("body half-width along the body (tail -> head):", " ".join(f"{h / half:.2f}" for h in _hw_y))
# wing roots: the wing just outside the body edge
_roots = _co[(np.abs(_co[:, 0]) > body_hw) & (np.abs(_co[:, 0]) < body_hw + 0.15 * half) & (np.abs(_co[:, 1]) < 0.25 * _len)]
z_wing = float(np.median(_roots[:, 2])) if len(_roots) else 0.0
x0 = min(0.9 * body_hw + 0.1 * half, 0.4 * half) if opt.get("shoulder") is None else shoulder * half  # middle of the blend
x1 = max(elbow * half, x0 + 0.2 * half)
# Rest wing angle: Meshy shapes can come with the wings raised in a steep V (Mangrove Kingfisher)
# or drooping; the beat then never goes below (or above) the body. Measure the angle of the wing
# from the shoulder to the outer half and centre the beat on horizontal, unless --bias is given.
_outer = _co[np.abs(_co[:, 0]) > 0.6 * half]
if len(_outer):
    _dx = float(np.median(np.abs(_outer[:, 0]))) - x0
    _dz = float(np.median(_outer[:, 2])) - z_wing
    rest_angle = math.degrees(math.atan2(_dz, _dx))
    # Levelling is opt-in per species (--levelwings=1 in prompts/species_notes.csv rig_args):
    # automatic for all, it made the Mangrove Kingfisher's downstroke sweep below and over the belly.
    if opt.get("levelwings", "0") == "1" and opt.get("bias") is None:
        bias = -rest_angle
    print(f"CHECK wings rest at {rest_angle:+.0f} deg from horizontal; beat centred at {rest_angle + bias:+.0f} deg")
print(f"shoulder at {x0 / half:.2f} half-span (body half-width {body_hw / half:.2f}), wing roots at z {z_wing / half:.3f}")
# --joint=1: a shoulder helper bone turning half the wing angle carries the skin between body
#   and wing. With a plain body/wing blend, the blended skin collapses towards the hinge on the
#   downstroke and opens a dent or hole in the flank (user, 2026-11-20, almost every bird).
# --pivotz=f: shoulder hinge at f x the wing-root height (0 = mid-body, 1 = where the wing attaches).
joint = num("joint", 0) >= 1
zp = num("pivotz", 0) * z_wing
for side, sg in (("L", -1), ("R", 1)):
    a = eb.new(f"wing_in.{side}"); a.head = (sg * x0, 0, zp); a.tail = (sg * x1, 0, zp); a.parent = root
    b = eb.new(f"wing_out.{side}"); b.head = (sg * x1, 0, zp); b.tail = (sg * half, 0, zp); b.parent = a; b.use_connect = True
    a.roll = b.roll = 0
    if joint:
        c = eb.new(f"shoulder.{side}"); c.head = (sg * x0, 0, zp); c.tail = (sg * (x0 + 0.1 * half), 0, zp); c.parent = root; c.roll = 0
bpy.ops.object.mode_set(mode="OBJECT")

# --wingscale=s: shrink (s < 1) or enlarge the wings from the shoulder, span and chord, for shapes
#   whose wings Meshy made too large (Meadow Pipit). The body is untouched (blend from its edge).
_ws = num("wingscale", 1.0)
if abs(_ws - 1) > 1e-3:
    for v in bird.data.vertices:
        ax = abs(v.co.x); w = smooth((ax - 0.9 * hw_at(v.co.y)) / (0.2 * half)); k = 1 - w * (1 - _ws)
        if ax > x0:
            v.co.x = math.copysign(x0 + (ax - x0) * k, v.co.x)
        v.co.y *= 1 - w * (1 - _ws) * smooth((ax - x0) / (0.1 * half))
    print(f"CHECK wings scaled x{_ws:.2f} from the shoulder")
groups = {n: bird.vertex_groups.new(name=n) for n in ("root", "head", "wing_in.L", "wing_out.L", "wing_in.R", "wing_out.R")
          + (("shoulder.L", "shoulder.R") if joint else ())}
bs, bw, bh = 0.10 * half, 0.12 * half, 0.04 * half
for v in bird.data.vertices:
    ax = abs(v.co.x); side = "L" if v.co.x < 0 else "R"
    # Wing influence: one wide blend (0.2 half-span, as in the first rig, whose wing beat looked
    # right) that starts at this slice's body edge, so belly and breast stay with the body.
    # No cut by height: pinning the skin below the wing root while the skin above it beat tore
    # the flank open on every downstroke (user, 2026-11-20, almost every bird); a narrow blend
    # creased the joint.
    w_wing = smooth((ax - 0.9 * hw_at(v.co.y)) / (0.2 * half))
    w_out = smooth((ax - (x1 - bw)) / (2 * bw))
    if joint:  # body -> shoulder (half angle) -> wing: each step half the rotation
        r_, sh_, wg_ = max(0.0, 1 - 2 * w_wing), 1 - abs(2 * w_wing - 1), max(0.0, 2 * w_wing - 1)
    else:
        r_, sh_, wg_ = 1 - w_wing, 0.0, w_wing
    w_head = smooth((v.co.y - (neck - bh)) / (2 * bh)) * r_
    w = {"root": r_ - w_head, "head": w_head,
         f"wing_in.{side}": wg_ * (1 - w_out), f"wing_out.{side}": wg_ * w_out}
    if joint: w[f"shoulder.{side}"] = sh_
    for name, x in w.items():
        if x > 1e-4: groups[name].add([v.index], x, "REPLACE")
bird.parent = arm
bird.modifiers.new("Armature", "ARMATURE").object = arm
if abs(bias) > 0.5:
    # Level the wings in the rest shape (one bend at the shoulder, baked into the mesh), then beat
    # around that. Beating around the raised pose with a bias swung the wing roots through the
    # breast and belly every stroke (Mangrove Kingfisher, wings raised 35 deg: 0.065 half-span).
    # Even baked, a shoulder bend over ~10 deg pushes the wing roots into the flanks (-20 deg: 0.064),
    # so the shoulder takes at most 10 deg and the elbow, away from the body, the rest.
    b_in = max(-10.0, min(10.0, bias)); b_out = bias - b_in
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    for side in ("L", "R"):
        p_ = arm.pose.bones[f"wing_in.{side}"]; p_.rotation_mode = "XYZ"; p_.rotation_euler = (math.radians(b_in), 0, 0)
        if joint:
            p_ = arm.pose.bones[f"shoulder.{side}"]; p_.rotation_mode = "XYZ"; p_.rotation_euler = (math.radians(b_in / 2), 0, 0)
        p_ = arm.pose.bones[f"wing_out.{side}"]; p_.rotation_mode = "XYZ"; p_.rotation_euler = (math.radians(b_out), 0, 0)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.objects.active = bird
    bpy.ops.object.modifier_apply(modifier="Armature")
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT"); bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    bird.modifiers.new("Armature", "ARMATURE").object = arm
    print(f"wings levelled in the rest shape: {b_in:+.0f} deg at the shoulder, {b_out:+.0f} deg at the elbow")
    bias = 0.0

# --- animation -----------------------------------------------------------------------------
# Wing angle a_in = amp*sin(ph): the downstroke is where it falls (cos(ph) < 0). The body is
# pushed up during the downstroke (max at ph = pi) and pitches slightly; with --head=stable the
# head bone cancels both so the head stays still, as birds stabilise their gaze in flight.
sc.render.fps = fps; sc.frame_start = 1; sc.frame_end = nfr
act = bpy.data.actions.new("Fly"); arm.animation_data_create(); arm.animation_data.action = act
stable = opt.get("head", "stable") == "stable"
for f in range(1, nfr + 2):
    ph = 2 * math.pi * (f - 1) / nfr
    a_in = math.radians(amp) * math.sin(ph) + math.radians(bias)
    a_out = math.radians(amp * outer) * math.sin(ph - lag)
    sw = math.radians(sweep) * max(0.0, math.cos(ph))
    for side, sg in (("L", -1), ("R", 1)):
        pi_ = arm.pose.bones[f"wing_in.{side}"]; po = arm.pose.bones[f"wing_out.{side}"]
        pi_.rotation_mode = po.rotation_mode = "XYZ"
        pi_.rotation_euler = (a_in, 0, 0)
        po.rotation_euler = (a_out, 0, -sg * sw)  # local Z = world Z: sweep the tip towards the tail
        pi_.keyframe_insert("rotation_euler", frame=f); po.keyframe_insert("rotation_euler", frame=f)
        if joint:
            ps = arm.pose.bones[f"shoulder.{side}"]; ps.rotation_mode = "XYZ"; ps.rotation_euler = (a_in / 2, 0, 0)
            ps.keyframe_insert("rotation_euler", frame=f)
    zb = -bob * wingspan * math.cos(ph)
    pb = math.radians(pitch) * math.sin(ph)
    rb = arm.pose.bones["root"]; rb.rotation_mode = "XYZ"
    rb.location = (0, 0, zb); rb.rotation_euler = (pb, 0, 0)
    rb.keyframe_insert("location", frame=f); rb.keyframe_insert("rotation_euler", frame=f)
    hb = arm.pose.bones["head"]; hb.rotation_mode = "XYZ"
    hb.location = (0, 0, -zb if stable else 0); hb.rotation_euler = (-pb if stable else 0, 0, 0)
    hb.keyframe_insert("location", frame=f); hb.keyframe_insert("rotation_euler", frame=f)

# The exporter ignores the armature object's rotation for a skinned mesh, so the model is exported
# in the working frame (head -Z, back +Y in glTF) and turned 180 deg about Y afterwards, in the
# file, by a parent node (see orient_glb below).
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_animations=True, export_skins=True,
                          export_yup=True, export_apply=False, export_frame_range=True,
                          export_force_sampling=True, export_image_format=opt.get("imgfmt", "WEBP"),
                          export_image_quality=int(num("q", 85)))
orient_glb(dst)
print("EXPORTED", dst)
