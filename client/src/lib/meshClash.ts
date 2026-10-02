import { boundsOf, boundsOverlap, buildBvh, cross3, dot3, normalize3, rayBounds, rayTriangle, sceneTriangles, sub3, type Bounds3, type BvhNode, type GeometryMesh, type GeometryScene, type Triangle, type Vec3 } from "./meshGeometry";

export interface MeshClash { a: string; b: string; meshA: string; meshB: string; kind: "surface-intersection" | "coplanar-contact" | "solid-containment"; point: Vec3 }
export interface MeshClashReport { complete: boolean; clashes: MeshClash[]; triangleTests: number; candidatePairs: number; openMeshes: string[]; warnings: string[]; toleranceM: number }

/** Triangle SAT includes in-plane axes so coplanar disjoint triangles are rejected. */
function triangleContact(a: Triangle, b: Triangle, tolerance: number): "surface-intersection" | "coplanar-contact" | null {
  const ea = [sub3(a.b, a.a), sub3(a.c, a.b), sub3(a.a, a.c)], eb = [sub3(b.b, b.a), sub3(b.c, b.b), sub3(b.a, b.c)];
  const na = cross3(ea[0], ea[1]), nb = cross3(eb[0], eb[1]);
  const axes: Vec3[] = [na, nb, ...ea.map(e => cross3(na, e)), ...eb.map(e => cross3(nb, e))];
  for (const x of ea) for (const y of eb) axes.push(cross3(x, y));
  // Translate projections to reduce loss of precision at survey coordinates.
  const pa = [sub3(a.a, a.a), sub3(a.b, a.a), sub3(a.c, a.a)], pb = [sub3(b.a, a.a), sub3(b.b, a.a), sub3(b.c, a.a)];
  for (const axis of axes) {
    const length = Math.hypot(...axis); if (length < 1e-15) continue;
    const unit = axis.map(v => v / length) as Vec3;
    const x = pa.map(v => dot3(v, unit)), y = pb.map(v => dot3(v, unit));
    if (Math.max(...x) < Math.min(...y) - tolerance || Math.max(...y) < Math.min(...x) - tolerance) return null;
  }
  const normal = normalize3(na), parallel = Math.hypot(...cross3(normal, normalize3(nb))) < 1e-8;
  return parallel && Math.abs(dot3(sub3(b.a, a.a), normal)) <= tolerance ? "coplanar-contact" : "surface-intersection";
}

/** Edge topology is checked after tolerance welding. Unclosed meshes get surface checks only. */
function topology(mesh: GeometryMesh, tolerance: number): { closed: boolean; probes: Vec3[] } {
  const vertexKeys = new Map<string, number>(), remap: number[] = [], points: Vec3[] = [];
  const weld = Math.max(tolerance * 0.01, 1e-9);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const point: Vec3 = [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]], key = point.map(v => Math.round(v / weld)).join(":");
    let id = vertexKeys.get(key); if (id === undefined) { id = points.length; points.push(point); vertexKeys.set(key, id); } remap.push(id);
  }
  const edges = new Map<string, { count: number; direction: number }>(), parent = points.map((_, i) => i);
  const find = (n: number): number => { let p = n; while (parent[p] !== p) p = parent[p]; while (parent[n] !== n) { const next = parent[n]; parent[n] = p; n = next; } return p; };
  let closed = true;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ids = mesh.indices.slice(i, i + 3).map(id => remap[id]);
    if (new Set(ids).size < 3) { closed = false; continue; }
    for (let k = 0; k < 3; k++) {
      const a = ids[k], b = ids[(k + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const edge = edges.get(key) ?? { count: 0, direction: 0 }; edge.count++; edge.direction += a < b ? 1 : -1; edges.set(key, edge);
      parent[find(b)] = find(a);
    }
  }
  if ([...edges.values()].some(e => e.count !== 2 || e.direction !== 0)) closed = false;
  const components = new Map<number, Vec3>();
  for (const index of mesh.indices) { const id = remap[index], root = find(id); if (!components.has(root)) components.set(root, points[id]); }
  return { closed, probes: [...components.values()] };
}

function pointInside(point: Vec3, triangles: Triangle[], tree: BvhNode | null, tolerance: number, consume: () => void): boolean | null {
  const votes: boolean[] = [];
  for (const raw of [[1, 0.371, 0.529], [0.257, 1, 0.619], [0.413, 0.193, 1]] as Vec3[]) {
    const direction = normalize3(raw), hits: number[] = [], stack = tree ? [tree] : [];
    while (stack.length) {
      const node = stack.pop()!; if (!rayBounds(point, direction, node.bounds)) continue;
      if (node.triangles) for (const index of node.triangles) { consume(); const t = rayTriangle(point, direction, triangles[index], tolerance); if (t !== null) hits.push(t); }
      else { if (node.left) stack.push(node.left); if (node.right) stack.push(node.right); }
    }
    hits.sort((a, b) => a - b);
    let unique = 0, previous = -Infinity;
    for (const hit of hits) if (hit - previous > tolerance) { unique++; previous = hit; }
    votes.push(unique % 2 === 1);
  }
  return votes.every(v => v === votes[0]) ? votes[0] : null;
}

export function detectMeshClashes(scene: GeometryScene, toleranceM = 1e-6): MeshClashReport {
  if (!Number.isFinite(toleranceM) || toleranceM < 1e-9 || toleranceM > 0.01) throw new Error("Clash tolerance must be 1e-9–0.01 metres.");
  const triangles = sceneTriangles(scene), byMesh = scene.meshes.map((): number[] => []);
  triangles.forEach((t, i) => byMesh[t.mesh].push(i));
  const trees = byMesh.map(indices => buildBvh(triangles, indices)), topologies = scene.meshes.map(mesh => topology(mesh, toleranceM));
  const report: MeshClashReport = { complete: true, clashes: [], triangleTests: 0, candidatePairs: 0, toleranceM, openMeshes: scene.meshes.filter((_, i) => !topologies[i].closed).map(m => m.id), warnings: [...scene.warnings] };
  if (report.openMeshes.length) report.warnings.push("Containment is evaluated only for closed, consistently oriented edge topology. Surface checks still include open meshes.");
  const consume = () => { if (++report.triangleTests > 5_000_000) throw new Error("Triangle-test budget reached; report is partial."); };
  const entries = trees.map((tree, i) => ({ tree, i })).filter((e): e is { tree: BvhNode; i: number } => e.tree !== null).sort((a, b) => a.tree.bounds.min[0] - b.tree.bounds.min[0]);
  try {
    for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j];
      if (b.tree.bounds.min[0] > a.tree.bounds.max[0] + toleranceM) break;
      if (scene.meshes[a.i].sourceId === scene.meshes[b.i].sourceId || !boundsOverlap(a.tree.bounds, b.tree.bounds, toleranceM)) continue;
      if (++report.candidatePairs > 200_000) throw new Error("Candidate-pair budget reached; report is partial.");
      const stack: [BvhNode, BvhNode][] = [[a.tree, b.tree]];
      let result: { kind: MeshClash["kind"]; point: Vec3 } | null = null;
      while (stack.length && !result) {
        const [x, y] = stack.pop()!;
        if (!boundsOverlap(x.bounds, y.bounds, toleranceM)) continue;
        if (x.triangles && y.triangles) {
          for (const ix of x.triangles) { for (const iy of y.triangles) {
            if (!boundsOverlap(triangles[ix].bounds, triangles[iy].bounds, toleranceM)) continue;
            consume(); const kind = triangleContact(triangles[ix], triangles[iy], toleranceM);
            if (kind) { const box = intersectionBounds(triangles[ix].bounds, triangles[iy].bounds); result = { kind, point: box.min.map((v, k) => (v + box.max[k]) / 2) as Vec3 }; break; }
          } if (result) break; }
        } else if (!x.triangles) { if (x.left) stack.push([x.left, y]); if (x.right) stack.push([x.right, y]); }
        else { if (y.left) stack.push([x, y.left]); if (y.right) stack.push([x, y.right]); }
      }
      if (!result && topologies[b.i].closed) for (const probe of topologies[a.i].probes) {
        const inside = pointInside(probe, triangles, b.tree, toleranceM, consume);
        if (inside === null) { report.complete = false; report.warnings.push(`Ambiguous containment ${scene.meshes[a.i].id}/${scene.meshes[b.i].id}.`); }
        if (inside) { result = { kind: "solid-containment", point: probe }; break; }
      }
      if (!result && topologies[a.i].closed) for (const probe of topologies[b.i].probes) {
        const inside = pointInside(probe, triangles, a.tree, toleranceM, consume);
        if (inside === null) { report.complete = false; report.warnings.push(`Ambiguous containment ${scene.meshes[b.i].id}/${scene.meshes[a.i].id}.`); }
        if (inside) { result = { kind: "solid-containment", point: probe }; break; }
      }
      if (result) report.clashes.push({ a: scene.meshes[a.i].sourceId, b: scene.meshes[b.i].sourceId, meshA: scene.meshes[a.i].id, meshB: scene.meshes[b.i].id, ...result });
    }
  } catch (failure) { report.complete = false; report.warnings.push(failure instanceof Error ? failure.message : "Clash calculation interrupted."); }
  if (triangles.length !== scene.meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0)) report.warnings.push("Degenerate triangles were excluded.");
  return report;
}
function intersectionBounds(a: Bounds3, b: Bounds3): Bounds3 {
  return boundsOf([a.min.map((v, k) => Math.max(v, b.min[k])) as Vec3, a.max.map((v, k) => Math.min(v, b.max[k])) as Vec3]);
}
