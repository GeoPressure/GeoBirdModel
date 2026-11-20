# Logo render for tools/make_logo.sh: one flapping model rendered as a plain single-colour bird in flight (clay),
# transparent background, tightly framed.
#   blender -b --python render_logo.py -- model.glb out.png [frame] [dx,dy,dz] [hex colour] [size]
# dx,dy,dz: direction from the bird to the camera (Blender axes after glTF import: span X, head -Y,
# back +Z). Default: from above and in front, wings spread.
import bpy, sys
import numpy as np
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:]
src, out = a[0], a[1]
frame = float(a[2]) if len(a) > 2 else 4
d = Vector([float(x) for x in (a[3] if len(a) > 3 else "0.25,-0.55,0.8").split(",")]).normalized()
col = a[4] if len(a) > 4 else "2f6f8f"
size = int(a[5]) if len(a) > 5 else 1024
lin = lambda c: (c / 255) ** 2.2
rgb = [lin(int(col[i:i + 2], 16)) for i in (0, 2, 4)]

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
sc.render.resolution_x = sc.render.resolution_y = size
# clay: one colour, a little sheen, no texture
m = bpy.data.materials.new("clay"); m.use_nodes = True
b = m.node_tree.nodes["Principled BSDF"]
b.inputs["Base Color"].default_value = (*rgb, 1); b.inputs["Roughness"].default_value = 0.55
for o in sc.objects:
    if o.type == "MESH":
        o.data.materials.clear(); o.data.materials.append(m)
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (1, 1, 1, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 0.55
for dd, e in (((0.3, -0.4, 1.0), 3.0), ((-0.5, 0.4, -0.3), 0.6)):
    l = bpy.data.objects.new("l", bpy.data.lights.new("l", "SUN")); l.data.energy = e
    l.rotation_euler = (-Vector(dd)).to_track_quat("-Z", "Y").to_euler(); sc.collection.objects.link(l)

sc.frame_set(int(frame), subframe=frame - int(frame))
mesh = max((o for o in sc.objects if o.type == "MESH" and not o.hide_render), key=lambda o: len(o.data.vertices))
me = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
P = np.array([(mesh.matrix_world @ v.co)[:] for v in me.vertices])
cam = bpy.data.objects.new("c", bpy.data.cameras.new("c")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = "ORTHO"
cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
R = np.array(cam.rotation_euler.to_matrix())
Q = P @ R
lo, hi = Q[:, :2].min(0), Q[:, :2].max(0)
cam.data.ortho_scale = 1.06 * max(hi - lo)
mid = (lo + hi) / 2
c = P.mean(0)
cam.location = Vector((R[:, 0] * mid[0] + R[:, 1] * mid[1]).tolist()) + Vector(R[:, 2].tolist()) * float(np.dot(c, R[:, 2])) + d * 5
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print("LOGO", out)
