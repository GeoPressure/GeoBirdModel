# Render a bird model (standard glTF frame: back +Y, head +Z; in Blender head -Y, back +Z) from the bird-view angle
# and from below, for a list of frames: blender -b --python render_bird.py -- in.glb out_prefix f1,f2,...
import bpy, sys
from mathutils import Vector, Matrix
argv = sys.argv[sys.argv.index("--")+1:]
src, out, frames = argv[0], argv[1], [int(f) for f in argv[2].split(",")]
opt_dist = 0.9
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
for o in list(sc.objects):
    if o.type == 'MESH' and o.name.startswith('Icosphere'): o.hide_render = True
sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items.keys() else 'BLENDER_EEVEE_NEXT'
sc.render.resolution_x, sc.render.resolution_y = 480, 360
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.62, 0.7, 1); w.node_tree.nodes["Background"].inputs[1].default_value = 1.2
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun)
sun.data.energy = 3; sun.rotation_euler = (2.6, 0.3, 0.4)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens = 50
def look(pos, target, up):
    f = (target - pos).normalized(); r = f.cross(up).normalized(); u = r.cross(f)
    m = Matrix((r, u, -f)).transposed().to_4x4(); m.translation = pos; return m
views = {"bird": (Vector((0.25, -0.55, -0.8)), Vector((0, -1, 0))), "below": (Vector((0.2, 0.9, 0.3)), Vector((0, 0, 1))),
         "side": (Vector((1, 0.15, 0.05)), Vector((0, -1, 0))),
         # close-ups at full resolution, to catch cracks, holes and texture artefacts
         "closeup": (Vector((0.35, -0.6, -0.35)), Vector((0, -1, 0))), "closedown": (Vector((0.4, 0.75, 0.1)), Vector((0, 0, 1))),
         # gallery poster: three-quarter view from above and in front
         "poster": (Vector((0.45, -0.75, 0.55)), Vector((0, -1, 0))),
         # wing beat seen head-on and from behind (check the wing hinge and body)
         "front": (Vector((0, 0.05, 1)), Vector((0, -1, 0))), "behind": (Vector((0, 0.15, -1)), Vector((0, -1, 0))),
         # belly close-ups through the beat (check that only the wings move)
         "bellyside": (Vector((1, 0.0, -0.25)), Vector((0, -1, 0))), "bellyfront": (Vector((0.0, -0.35, 1)), Vector((0, -1, 0))),
         # head close-ups (check crown, eye stripe, bill)
         "headside": (Vector((1, 0.05, 0.15)), Vector((0, -1, 0))), "headtop": (Vector((0.05, -1, 0.35)), Vector((0, 0, 1)))}
dist = {"closeup": 0.38, "closedown": 0.38, "poster": 0.85, "bellyside": 0.42, "bellyfront": 0.45, "headside": 0.42, "headtop": 0.42}
# The view vectors above were written for the old frame (head +Z, back -Y in Blender); rotate them
# into the standard glTF frame (head -Y, back +Z in Blender): (x, y, z) -> (-x, -z, -y).
conv = lambda v: Vector((-v.x, -v.z, -v.y))
views = {k: (conv(d), conv(u)) for k, (d, u) in views.items()}
only = argv[3].split(",") if len(argv) > 3 else list(views)
views = {k: v for k, v in views.items() if k in only}
for f in frames:
    sc.frame_set(f)
    for name, (d, up) in views.items():
        cam.matrix_world = look(d.normalized() * dist.get(name, opt_dist), Vector((0, 0, 0)), up)
        sc.render.film_transparent = name == "poster"
        sc.render.filepath = f"{out}_{name}_{f:02d}.png"
        bpy.ops.render.render(write_still=True)
