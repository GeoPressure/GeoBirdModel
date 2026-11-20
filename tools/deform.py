# How much the body surface deforms beyond the root bone's rigid motion over the wing beat.
#   blender -b --python deform.py -- flapping.glb   -> DEFORM / ALONG lines (fractions of the half-span)
# Belly and breast should stay below ~0.005; only the head (stabilised) and the wings may move.
import bpy, sys, numpy as np
argv = sys.argv[sys.argv.index("--")+1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])
sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == 'ARMATURE')
mesh = next(o for o in sc.objects if o.type == 'MESH' and not o.name.startswith('Icosphere'))
def pos(f):
    sc.frame_set(f); dg = bpy.context.evaluated_depsgraph_get()
    m = mesh.evaluated_get(dg).to_mesh()
    P = np.array([(mesh.matrix_world @ v.co)[:] for v in m.vertices])
    R = np.array(arm.matrix_world @ arm.pose.bones['root'].matrix)
    return P, R
P0, R0 = pos(1)
inv0 = np.linalg.inv(R0)
# half-span as the rig set it: the wing_out bones end at the wing tips of the rest pose
# (the posed span at frame 1, swept and bent, made every number ~1.4x too small)
half = abs((arm.matrix_world @ arm.data.bones['wing_out.R'].tail_local).x)
res = np.zeros(len(P0))
for f in range(1, 25, 2):
    P, R = pos(f)
    # remove the root's rigid motion: map the frame back into frame 1's root space
    Pr = (np.c_[P, np.ones(len(P))] @ (R0 @ np.linalg.inv(R)).T)[:, :3]
    res = np.maximum(res, np.linalg.norm(Pr - P0, axis=1))
# body = within 0.6 of the shoulder distance of the centre line, below the back
ax = np.abs(P0[:, 0])
# along the body (glTF import: head -Y in Blender): bins from head to tail
yb = np.linspace(P0[ax < 0.1 * half, 1].min(), P0[ax < 0.1 * half, 1].max(), 9)
body = []
for k, (a, b) in enumerate(zip(yb[:-1], yb[1:])):
    sel = (ax < 0.1 * half) & (P0[:, 1] >= a) & (P0[:, 1] < b)
    if sel.any() and k >= 2: body.append(np.percentile(res[sel] / half, 95))  # the first two bins: bill and head
    if sel.any(): print(f"ALONG y {a / half:+.2f}..{b / half:+.2f}: 95% {np.percentile(res[sel] / half, 95):.4f}, z range {P0[sel, 2].min() / half:+.2f}..{P0[sel, 2].max() / half:+.2f}")
for name, sel in {"centre (|x|<0.05 half)": ax < 0.05 * half, "flanks (0.05-0.10)": (ax >= 0.05 * half) & (ax < 0.10 * half)}.items():
    r = res[sel] / half
    print(f"DEFORM {name}: median {np.median(r):.4f}, 95% {np.percentile(r, 95):.4f}, max {r.max():.4f} half-span")
print(f"BODY {max(body):.4f} half-span (largest 95% deformation behind the head; limit 0.005)")
