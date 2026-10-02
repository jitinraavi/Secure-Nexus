# Triangle mesh clash engine

`meshGeometry.ts` defines a bounded metre/linear-RGB scene exchange, visible Three.js snapshot with instance/world transforms, median-split triangle BVH, ray-box and ray-triangle queries. Skinned/morph geometry is explicitly excluded. Negative scale winding is retained. Textures, alpha and section planes have explicit export limitations.

`meshClash.ts` uses a sweep broad phase, BVH pair traversal and triangle separating axes, including coplanar in-plane axes. Reports distinguish surface intersection, coplanar contact and enclosure in a closed mesh. Edge topology after tolerance welding gates containment; component probes and three ray-parity directions detect ambiguous cases. Parts sharing a source ID are treated as one entity and are excluded from self-clashes. Geometry must use unique source IDs for independent objects.

Clash tolerance is 1e-9–0.01 m. The scene cap is 400,000 input triangles. Five million narrow-phase/ray tests and 200,000 broad-phase candidates bound computation. Reaching a budget produces an explicitly partial report, never an all-clear. Degenerate triangles, open topology and ambiguous parity appear in diagnostics. This is floating-point triangle geometry, not an exact-arithmetic solid kernel or an engineering clearance certification. The first detected contact is reported for each pair; its point is a bounding-box contact estimate rather than an intersection manifold.

Source inspection only. No numerical examples, compiler, tests, imports or application were executed.
