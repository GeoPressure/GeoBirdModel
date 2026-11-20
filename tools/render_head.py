# Close-up renders of the head (left, right, top, front) of a bird model in standard glTF frame.
#   blender -b --python render_head.py -- model.glb out_prefix [frame]
# Check: one eye per side, crown and face pattern as in the flight image, bill intact.
import bpy, sys
from mathutils import Vector, Matrix
argv = sys.argv[sys.argv.index("--")+1:]
src, out = argv[0], argv[1]; frame = int(argv[2]) if len(argv) > 2 else 1
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene; sc.frame_set(frame)
dg = bpy.context.evaluated_depsgraph_get()
pts = []
for o in sc.objects:
    if o.type == 'MESH' and not o.name.startswith('Icosphere'):
        m = o.evaluated_get(dg).to_mesh(); pts += [o.matrix_world @ v.co for v in m.vertices]
head = min(pts, key=lambda p: p.y)  # most -Y point = bill tip
core = [p for p in pts if abs(p.x) < 0.03]
hc = Vector((0, head.y + 0.06, sum(p.z for p in core) / len(core) + 0.01))
sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items.keys() else 'BLENDER_EEVEE_NEXT'
sc.render.resolution_x, sc.render.resolution_y = 360, 300
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True; w.node_tree.nodes["Background"].inputs[0].default_value = (0.75, 0.78, 0.82, 1)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam; cam.data.lens = 50
def look(pos, target, up):
    f = (target - pos).normalized(); r = f.cross(up).normalized(); u = r.cross(f)
    m = Matrix((r, u, -f)).transposed().to_4x4(); m.translation = pos; return m
for name, d in {"left": Vector((-1, -0.3, 0.15)), "right": Vector((1, -0.3, 0.15)), "top": Vector((0.05, -0.2, 1)), "front": Vector((0, -1, 0.1))}.items():
    cam.matrix_world = look(hc + d.normalized() * 0.22, hc, Vector((0, 0, 1)) if name != "top" else Vector((0, -1, 0)))
    sc.render.filepath = f"{out}_{name}.png"; bpy.ops.render.render(write_still=True)
