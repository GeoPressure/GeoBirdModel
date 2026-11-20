# Gallery poster of a flapping bird: field-guide three-quarter view (side, a little in front and
# above), wings in the upper half of the beat, framed on the whole bird so nothing is cut.
#   blender -b --python render_poster.py -- model.glb out.png [frame]
# Imported glTF in Blender: span X, head -Y, back +Z.
import bpy, sys
import numpy as np
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:]
src, out = a[0], a[1]
frame = int(a[2]) if len(a) > 2 else 3          # phase 30 deg: wings raised, beat in motion
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
for o in list(sc.objects):
    if o.type == "MESH" and o.name.startswith("Icosphere"):
        o.hide_render = True
eng = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
sc.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in eng else "BLENDER_EEVEE"
sc.render.resolution_x, sc.render.resolution_y = 1200, 900
sc.render.film_transparent = True
sc.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.8, 0.82, 0.86, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 0.9
for d, e in (((0.4, -0.5, 1.0), 3.2), ((-0.6, 0.3, -0.4), 0.8)):   # key light from above-front, soft fill
    l = bpy.data.objects.new("l", bpy.data.lights.new("l", "SUN")); l.data.energy = e
    l.rotation_euler = (-Vector(d)).to_track_quat("-Z", "Y").to_euler(); sc.collection.objects.link(l)

sc.frame_set(frame)
mesh = max((o for o in sc.objects if o.type == "MESH" and not o.hide_render), key=lambda o: len(o.data.vertices))
dg = bpy.context.evaluated_depsgraph_get()
me = mesh.evaluated_get(dg).to_mesh()
P = np.array([(mesh.matrix_world @ v.co)[:] for v in me.vertices])
c = (P.min(0) + P.max(0)) / 2

d = Vector((0.8, -0.45, 0.42)).normalized()     # from the bird to the camera: side, front, above
cam = bpy.data.objects.new("c", bpy.data.cameras.new("c")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = "ORTHO"
cam.location = Vector(c.tolist()) + d * 5
cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
# fit: project the vertices on the camera plane, ortho scale = largest extent + margin
R = np.array(cam.rotation_euler.to_matrix())
Q = (P - c) @ R                                  # camera axes: x right, y up
wx, wy = np.ptp(Q[:, 0]), np.ptp(Q[:, 1])
aspect = sc.render.resolution_x / sc.render.resolution_y
cam.data.ortho_scale = 1.08 * max(wx, wy * aspect)
off = (Q.min(0) + Q.max(0)) / 2
cam.location = cam.location + Vector((R[:, 0] * off[0] + R[:, 1] * off[1]).tolist())
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print("POSTER", out)
