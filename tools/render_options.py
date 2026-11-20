# One row of the rig options sheet: side, head-on (upstroke and downstroke) and behind.
#   blender -b --python render_options.py -- model.glb out.png
# Imported glTF in Blender: span X, head -Y, back +Z.
import bpy, sys
from mathutils import Vector
a = sys.argv[sys.argv.index("--") + 1:]; src, out = a[0], a[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
eng = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
sc.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in eng else "BLENDER_EEVEE"
sc.render.resolution_x, sc.render.resolution_y = 520, 380
sc.world = bpy.data.worlds.new("w"); sc.world.color = (0.75, 0.77, 0.8)
sc.view_settings.view_transform = "Standard"
for d in [(0.3, -0.5, 1), (-0.5, 0.4, -0.6)]:
    l = bpy.data.objects.new("l", bpy.data.lights.new("l", "SUN")); l.data.energy = 3.0
    l.rotation_euler = Vector(d).to_track_quat("-Z", "Y").to_euler(); sc.collection.objects.link(l)
cam = bpy.data.objects.new("c", bpy.data.cameras.new("c")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = "ORTHO"
shots = [("side", Vector((1, 0, -0.12)), 1, 0.8), ("front", Vector((0, -1, -0.2)), 7, 0.85),
         ("front", Vector((0, -1, -0.2)), 19, 0.85), ("behind", Vector((0, 1, -0.05)), 1, 0.85)]
paths = []
for i, (vn, d, f, scale) in enumerate(shots):
    d = d.normalized(); cam.location = d * 2; cam.data.ortho_scale = scale
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    sc.frame_set(f); p = f"{out}_{i}.png"; sc.render.filepath = p; bpy.ops.render.render(write_still=True); paths.append(p)
print("SHOTS", " ".join(paths))
