# Responsive coordination and phase playback

## Background coordination

Community and infrastructure editors request envelope coordination checks from a dedicated module Web Worker. A typed request carries only the arrays/settings used by those checks, rather than the complete design. Unrelated review, documentation and visualization edits preserve the request input when those model arrays remain unchanged.

New geometric edits debounce for 200 ms. A new input terminates the previous worker and discards its results. Unmount also clears timers and terminates the worker. Requests have a 30-second deadline. Worker startup, cloning, analysis and message failures produce an explicit unavailable state; pending/failed checks never show a clean-model message from an older model.

Users may retry the worker or explicitly choose “Run on this tab (may pause editing)”. That fallback uses the same approximation checks on the main thread and labels its result. It is never selected automatically. The UI displays a running notice before starting the requested fallback. The fallback cannot be interrupted while its synchronous calculation is running.

The worker accelerates responsiveness, not mathematical fidelity: rotated footprint/SAT and vertical-envelope checks remain planning approximations. Dense models can still produce many candidate pairs and findings. Geometry construction, IFC parsing, terrain triangulation and JSON serialization are not moved to workers by this change.

## Incremental phase visibility

Community amenities, drafts, active-level rooms, towers and labels, plus infrastructure facilities/drafts and existing MEP roots, retain phase metadata on their scene roots. Changing visualization time, schedule or render quality updates visibility without disposing/rebuilding scene geometry. A new geometric design still rebuilds the scene. Layer filtering remains a construction-time choice; phase roots do not override it.

Facilities are constructed independently of phase time so their layout does not shift during playback. Each facility has a phase-controlled parent that also contains its technical edges. Tower detailed/proxy levels share the tower's world position and rotation on the LOD parent. Proxy geometry avoids extra sibling edge meshes that would bypass LOD level visibility.

Selection searches `userData.selectId`, removes and disposes previous overlay resources, and targets the tower's LOD root for dragging. Picking ignores objects with a hidden ancestor, including phase-hidden objects and inactive LOD levels. Late map overlays from replaced scene builds are disposed.

## Inspection-only limits

No application, tests, compiler, build, browser preview or benchmark was executed. Worker bundling/CSP behavior, TypeScript integration, interactive picking/dragging, phase playback and GPU disposal need runtime verification. This module provides a background coordination path and incremental phase updates; it does not claim proven 10k/100k scale, general scene streaming, distributed workers or GPU byte budgets.
