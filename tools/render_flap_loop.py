# Short flapping loop of a bird for the gallery filmstrip (played on hover): same field-guide
# three-quarter view, lights and auto-framing as render_poster.py, but framed on the whole wing
# beat (union of all frames, so the bird does not jump) and the image cut to that box.
#   blender -b --python render_flap_loop.py -- model.glb outdir [n_frames] [width] [boxonly]
# Writes outdir/f00.png ... (transparent PNG, 2x width for downsampling); tools/flap_loops.sh
# packs them into loops/<Genus_species>.webp. Also writes outdir/box.json: where the gallery poster
# (render_poster.py: frame 3, framed on that frame, trimmed) lies in the loop image, as fractions
# [x, y, w, h], so the page can play the loop exactly over the poster. boxonly: box.json only, no render.
# Imported glTF in Blender: span X, head -Y, back +Z.
import bpy, sys, os
import numpy as np
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:]
src, outdir = a[0], a[1]
nfr = int(a[2]) if len(a) > 2 else 14
width = int(a[3]) if len(a) > 3 else 300
boxonly = len(a) > 4 and a[4] == "boxonly"
os.makedirs(outdir, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
for o in list(sc.objects):
    if o.type == "MESH" and o.name.startswith("Icosphere"):
        o.hide_render = True
eng = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
sc.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in eng else "BLENDER_EEVEE"
sc.render.film_transparent = True
sc.view_settings.view_transform = "Standard"
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGBA"
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.8, 0.82, 0.86, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 0.9
for d, e in (((0.4, -0.5, 1.0), 3.2), ((-0.6, 0.3, -0.4), 0.8)):   # key light from above-front, soft fill
    l = bpy.data.objects.new("l", bpy.data.lights.new("l", "SUN")); l.data.energy = e
    l.rotation_euler = (-Vector(d)).to_track_quat("-Z", "Y").to_euler(); sc.collection.objects.link(l)

# the Fly action: one beat from frame_start to frame_end (the last frame repeats the first)
acts = [ad.action for o in sc.objects if (ad := o.animation_data) and ad.action]
f0, f1 = (min(int(x.frame_range[0]) for x in acts), max(int(x.frame_range[1]) for x in acts)) if acts else (1, 25)
if f1 - f0 < 2: f0, f1 = 1, 25
times = [f0 + (f1 - f0) * i / nfr for i in range(nfr)]

def at(t):
    sc.frame_set(int(t), subframe=t - int(t))

mesh = max((o for o in sc.objects if o.type == "MESH" and not o.hide_render), key=lambda o: len(o.data.vertices))
d = Vector((0.8, -0.45, 0.42)).normalized()     # from the bird to the camera: side, front, above
cam = bpy.data.objects.new("c", bpy.data.cameras.new("c")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = "ORTHO"
cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
R = np.array(cam.rotation_euler.to_matrix())    # columns: camera x (right), y (up), z (back)

# union of the projected vertices over the whole beat
lo, hi, cs = np.full(2, np.inf), np.full(2, -np.inf), []
for t in times:
    at(t)
    dg = bpy.context.evaluated_depsgraph_get()
    me = mesh.evaluated_get(dg).to_mesh()
    P = np.array([(mesh.matrix_world @ v.co)[:] for v in me.vertices])
    mesh.evaluated_get(dg).to_mesh_clear()
    cs.append(P.mean(0))
    Q = P @ R
    lo, hi = np.minimum(lo, Q[:, :2].min(0)), np.maximum(hi, Q[:, :2].max(0))
c = np.mean(cs, axis=0)
ext = (hi - lo) * 1.06
mid = (lo + hi) / 2
# image cut to the beat's box (like a trimmed poster), 2x for a sharper downsample
aspect = ext[0] / ext[1]
sc.render.resolution_x = 2 * width
sc.render.resolution_y = max(2, int(round(2 * width / aspect)))
sc.render.resolution_percentage = 100
cam.data.ortho_scale = max(ext[0], ext[1] * sc.render.resolution_x / sc.render.resolution_y)
# camera centre: the box middle on the image plane, 5 units back along d
pc = Vector((R[:, 0] * mid[0] + R[:, 1] * mid[1]).tolist())
depth = float(np.dot(c, R[:, 2]))
cam.location = pc + Vector(R[:, 2].tolist()) * depth + d * 5

# the poster's box (render_poster.py: frame 3, silhouette bbox = trimmed image) in this image
import json
at(3)
dg = bpy.context.evaluated_depsgraph_get()
P3 = np.array([(mesh.matrix_world @ v.co)[:] for v in mesh.evaluated_get(dg).to_mesh().vertices]) @ R
p0, p1 = P3[:, :2].min(0), P3[:, :2].max(0)
W = cam.data.ortho_scale; Hh = W * sc.render.resolution_y / sc.render.resolution_x
x0, ytop = mid[0] - W / 2, mid[1] + Hh / 2
box = [(p0[0] - x0) / W, (ytop - p1[1]) / Hh, (p1[0] - p0[0]) / W, (p1[1] - p0[1]) / Hh]
json.dump([round(v, 4) for v in box], open(os.path.join(outdir, "box.json"), "w"))
if boxonly:
    print("BOX", box); sys.exit(0)

for i, t in enumerate(times):
    at(t)
    sc.render.filepath = os.path.join(outdir, f"f{i:02d}.png")
    bpy.ops.render.render(write_still=True)
print("LOOP", outdir, nfr, sc.render.resolution_x, sc.render.resolution_y)
