# Civil station profile and corridor study

The civil controls accept 2–100 strictly increasing station/elevation pairs, starting at station zero. Blank input or Use constant grade returns to the existing grade settings. Shared validation rejects duplicates, invalid ranges and malformed input. Stored invalid profiles receive a warning and use constant grade. Piecewise linear interpolation retains every profile break station; beyond the final point its elevation is held explicitly.

The chart, average end-area quantities, station CSV, report and LandXML share these elevations. JSON includes the settings and full station report. The optional cyan surface overlay joins left edge, crown and right edge through the same stations and normals used in cross-section sampling. It is drawn over the infrastructure view for study visibility, without changing the procedural highway model, terrain excavation, facilities or highway BOQ. Enable it after generating the model.

Original route vertices and up to 2,000 regular samples are retained, plus profile breaks. Routes above 10,000 vertices receive a visible warning and use the documented straight fallback. The study surface is bounded to 12,200 stations and finite supported coordinates. Reversing-route tangents use the next or previous nonzero segment.

This remains a polyline and piecewise linear planning profile. Circular/spiral alignments, parabolic vertical curves, superelevation, side slopes, excavation meshes, breaklines, reprojection and hydraulic routing are separate engineering integrations. LandXML interoperability, cut/fill accuracy, chart behavior and GPU disposal have only been inspected from source. No app, tests, compiler, build, preview or external validator was run.
