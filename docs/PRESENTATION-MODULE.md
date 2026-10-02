# Shared camera presentation

The primary room, community and infrastructure views expose the same presentation controls below the 4D planning bar. Save, rename, reorder, show or delete up to 100 camera viewpoints; play an authored path, export its metre-based JSON, capture a 1×/2×/4× PNG or record a short viewport video. Authored actions suspend the automatic flythrough from the shared controls. Existing room VR/AR controls remain available on supported devices.

Camera paths validate all coordinates and use bounded durations. The shared controller owns camera motion during a path, disables and restores orbit damping, and tears down recording/timers/tracks on cancellation or viewport disposal. The room editor clears its legacy tour/transition before authored camera actions. UI generation checks reject stale captures after a viewport/API changes.

PNG export temporarily increases the render size, caps output at 16 megapixels/8,192 pixels per side and respects the renderer's texture limit. It restores the current viewport dimensions and quality after asynchronous encoding, including resize or quality changes made during capture. A still capture cannot overlap video recording or an immersive session.

Video uses the browser's canvas stream and supported MediaRecorder codec, with no microphone/camera input or remote render service. It supports 1–60 seconds at 15/30/60 fps through the API (UI uses 30 fps), a 64 MB buffer limit, explicit cancellation and automatic cleanup. The extension follows the recorder's MIME type. The tab must remain visible for scene animation; recording performance and codec availability depend on the browser/device.

Only source-file inspection was performed. No application, tests, type checker, build, preview, capture, recorder or XR session was run. Browser permissions/capabilities, canvas encoding, GPU size restoration, camera interpolation and bundling remain unverified. These controls do not add path tracing, denoising, HDR asset import or construction-geometry animation, and do not claim measured photorealism or frame-rate guarantees.
