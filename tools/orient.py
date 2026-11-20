# Find which way a textured Meshy bird points, without trusting Meshy's output orientation.
#   blender -b --python orient.py -- model.glb flight.png out_prefix
# Prints "ORIENT forward=<±X|±Y|±Z> up=<±X|±Y|±Z> ..." (Blender axes of the imported model):
# - wingspan = longest axis; body = longer remaining axis near the middle;
# - head = the round end of the body (the tail end is flat and wide), from the geometry;
# - back = the side whose colours match the flight image (which shows the bird from above),
#   from orthographic renders of both sides. Geometry alone can't tell back from belly
#   (wings may droop below the body).
import bpy, sys, math
import numpy as np
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
src, flight, out = argv[0], argv[1], argv[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
meshes = [o for o in sc.objects if o.type == "MESH"]
co = np.concatenate([np.array([(o.matrix_world @ v.co)[:] for v in o.data.vertices]) for o in meshes])
c = co - (co.min(0) + co.max(0)) / 2
ext = c.max(0) - c.min(0)
s_ax = int(np.argmax(ext)); half_s = ext[s_ax] / 2
rest = [a for a in range(3) if a != s_ax]
core = c[np.abs(c[:, s_ax]) < 0.12 * half_s]
ce = core.max(0) - core.min(0)
b_ax = rest[0] if ce[rest[0]] >= ce[rest[1]] else rest[1]
u_ax = rest[1] if b_ax == rest[0] else rest[0]
lo, hi = core[:, b_ax].min(), core[:, b_ax].max(); L = hi - lo
def flatness(end):
    sel = core[core[:, b_ax] > hi - 0.15 * L] if end > 0 else core[core[:, b_ax] < lo + 0.15 * L]
    return np.ptp(sel[:, u_ax]) / max(np.ptp(sel[:, s_ax]), 1e-9) if len(sel) else 0.0
head_sign = 1 if flatness(1) >= flatness(-1) else -1

# colour of the bird in the flight image (non-white pixels)
img = bpy.data.images.load(flight)
px = np.array(img.pixels[:]).reshape(-1, 4)[:, :3]
bird_px = px[px.sum(1) < 2.7]
ref = bird_px.mean(0)

sc.render.engine = "BLENDER_WORKBENCH"
sc.display.shading.light = "FLAT"; sc.display.shading.color_type = "TEXTURE"
sc.render.film_transparent = True
sc.render.resolution_x = sc.render.resolution_y = 256
sc.view_settings.view_transform = "Standard"
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = "ORTHO"; cam.data.ortho_scale = float(ext.max()) * 1.1
centre = Vector(((co.min(0) + co.max(0)) / 2).tolist())
res = {}
for sgn in (1, -1):
    d = Vector([sgn if i == u_ax else 0 for i in range(3)])
    up_hint = Vector([1 if i == b_ax else 0 for i in range(3)])
    cam.location = centre + d * float(ext.max()) * 3
    cam.rotation_euler = (-d).to_track_quat("-Z", "XYZ"[b_ax]).to_euler()
    path = f"{out}_{'+' if sgn > 0 else '-'}{'XYZ'[u_ax]}.png"
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    r = np.array(bpy.data.images.load(path).pixels[:]).reshape(-1, 4)
    vis = r[r[:, 3] > 0.5][:, :3]
    res[sgn] = (float(np.linalg.norm(vis.mean(0) - ref)), path)
up_sign = 1 if res[1][0] <= res[-1][0] else -1
ax = lambda a, s: ("+" if s > 0 else "-") + "XYZ"[a]
print(f"ORIENT forward={ax(b_ax, head_sign)} up={ax(u_ax, up_sign)} "
      f"colour_distance_up={res[up_sign][0]:.3f} other_side={res[-up_sign][0]:.3f}")
