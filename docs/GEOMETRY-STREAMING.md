# Geometry streaming and measurement

The geometry workbench accepts version 1 metre-based scene JSON and streaming manifests. Manifest chunks have `id`, same-origin `url`, world `bounds: {min,max}`, `geometricErrorM`, upper transfer `bytes`, and up to sixteen `children`; `roots` reference independent chunk trees. Children must fit their parent and have no greater error. Cycles, multiple parents, unreachable chunks and depth above 32 are rejected.

The viewport selects parent/child levels by projected geometric error and camera-frustum intersection. It loads authenticated same-origin chunk JSON with streaming byte enforcement and AbortSignal cancellation. An LRU decoded cache reserves a conservative 16 bytes per numeric value plus object overhead and defaults to 128 MiB. The current view is retained until the whole next selection loads. Failure retains the previous valid view and shows an error. Visible geometry is limited to one million triangles; allocations are disposed on eviction and teardown. Chunk bodies themselves use the bounded GeometryScene schema. Asset hosting/chunk production are deployment responsibilities; the encrypted whole-document editor is not automatically rewritten into streamed storage.

GPU vertex positions are rebased around each scene/chunk center before float32 allocation; world transforms and camera remain double-precision objects. Logarithmic depth is requested for the streaming viewport. Failed chunk selections back off for five seconds.

Live FPS, draw calls, triangles and allocated geometry buffers are shown in the viewport. Texture storage estimates exclude unknown formats, driver overhead and render targets. A worker harness measures 10,000/100,000 synthetic single-triangle components and 1,000 ray queries, labeling these as BVH measurements rather than full application scalability. No benchmark numbers are invented or measured during this change.

Source inspected only. Worker bundling, memory/FPS behavior, transfer limits and WebGL operation remain unverified.
