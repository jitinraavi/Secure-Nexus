# Product Specification — Interior Design & Modeling App

> Status: **Draft v1** — captures all requirements described so far. Sections marked **[TBD]** need confirmation before build.

## 1. Overview

An app + web application for **interior designers and freelance architects** to:

1. Capture a room (device camera **or** upload a photo file if no camera is available, e.g. desktop).
2. Design the room visually: select **furniture**, **colours**, and **curtains** per room.
3. Generate an **interior design model** from the photo/file containing the chosen objects & palette.
4. **Modify** the generated output to taste (swap pieces, recolour, move, resize, delete).
5. **Ship the design** to AutoCAD and other 3D design/modelling software via connectors.

## 2. Target Users

- Interior designers
- Freelance architects
- (Secondary) real-estate presenters; furniture e-commerce sellers

## 3. Platforms

- **Web application** (primary, works on desktop + mobile browsers)
- Progressive Web App (PWA) capabilities so tablets/phones behave like an app
- Camera capture via `navigator.mediaDevices`; graceful fallback to file upload when no camera exists (desktops/laptops)

## 4. Functional Requirements

### 4.1 Room Input
- FR-101 Live camera capture of a room (mobile/tablet).
- FR-102 File upload fallback: JPEG/PNG/WebP from the device; browser-based "no camera" detection forces upload.
- FR-103 Drag-and-drop upload + paste-from-clipboard on desktop.
- FR-104 Basic pre-processing: straighten, crop, adjust light, remove background (client-side or via processing service).

### 4.2 Design Catalogue & Selection
- FR-201 **Furniture library**: sofa, beds, tables, chairs, shelves, lighting, rugs, etc., filterable by room type (living room, bedroom, kitchen, office, bath, dining).
- FR-202 **Colour palette**: walls (paint/stain), floor, furniture finishes; user picks hex/swatches and applies per surface.
- FR-203 **Curtains/drapes**: styles (sheer, blackout, curtains, blinds), length, colour, mounting.
- FR-204 Furniture can be dragged/scaled/rotated on the room; positions snap to floor/walls.
- FR-205 Libraries searchable by tag/name, with 2D or 3D preview.

### 4.3 Design Generation
- FR-301 Generate an **interior design model** from photo + selections (furniture, colours, curtains).
- FR-302 Output must be **modifiable**: replace an item, recolour any surface, move items, delete items, undo/redo.
- FR-303 Multiple render modes: photorealistic mock-up, stylised collage, and 3D wireframe/scene view (**[TBD]** — photorealistic needs an AI vision model, see §7).

### 4.4 Projects & Persistence
- FR-401 Save/load projects per user; share read-only links.
- FR-402 Version history of a design (revisions + diff).
- FR-403 Export a design summary (item list + quantities + palette) as PDF/CSV for quoting.

### 4.5 CAD & 3D Software Connectors
- FR-501 **Export to AutoCAD**: generate `.dxf` (2D plan/floorscape) with layers per object type; `.dwg` via Autodesk conversion path or AutoCAD web sync (**[TBD]** which path).
- FR-502 **Other 3D formats**: OBJ, GLTF/GLB, IFC (BIM), SketchUp **SKP** (**[TBD]** — SKP is proprietary; OBJ/GLB via export, or via plugins).
- FR-503 "**Connect app**" flow: pair the web app with local/cloud CAD product (e.g. AutoCAD) — settings, connection status, one-click "send design to AutoCAD".
- FR-504 Autodesk Platform Services (APS/Forge) integration for cloud conversion & viewing (**[TBD]** API keys/license).
- FR-505 Geometry must be tagged with real-world units (default mm, XAU-scale) and layer naming matching CAD conventions.

### 4.6 Payments Portal
- FR-601 Subscription plans: **Free**, **Pro** and **Studio** with a price/period per plan and automatic entitlement upgrade on successful payment.
- FR-602 Payment methods: **UPI**, **cards**, and **PayPal** (various providers; provider picker in the UI).
- FR-603 Demo mode: no-credentials checkout so the full flow (create → pay → plan upgrade) can be demoed; gated so it cannot be reached with live keys.
- FR-604 Live mode: Razorpay Payment Links (UPI + cards) and PayPal Orders v2 with server-side capture + webhook completion; payment history kept per user.

## 5. Security (inherited from existing backend)

Reuses the already-scaffolded **Groundwork** backend:

- **Authentication & sessions**: scrypt password hashing, server-side sessions (hashed tokens), httpOnly/sameSite cookies, idle + absolute expiry.
- **MFA**: TOTP two-factor authentication.
- **Abuse protection**: rate limiting, account lockout, CSRF double-submit protection, Helmet + CSP headers.
- **Encryption**: AES-256-GCM vault for user-uploaded photos and design data at rest.
- **Audit & monitoring**: full audit log (logins, uploads, exports, connector activity), dashboard stats, anomaly visibility.
- **Data isolation**: every file/project scoped to the owning user.

## 6. Non-Functional Requirements

- NFR-01 Works offline-first for project editing; syncs when connected.
- NFR-02 3D preview runs in-browser (WebGL/Three.js); no install required.
- NFR-03 All uploads validated (type, size ≤ 25 MB, magic-byte sniffing).
- NFR-04 Privacy-first: photos/designs encrypted at rest; user can delete project + data permanently.
- NFR-05 Responsive: mobile, tablet, desktop.
- NFR-06 **Deployable on Render** as a single Node web service (API + built SPA); `/api/health` healthcheck; persistent-disk option for the SQLite data.

## 7. Technical Approach & Open Questions **[TBD]**

**Realistic generation tiers (decision needed):**
- **Tier 1 — Composite renderer (buildable now)**: overlay chosen furniture/curtains/colour swatches onto the photo as an editable scene. No AI needed.
- **Tier 2 — AI photorealistic (needs external service or local model)**: e.g. Stable Diffusion / ControlNet via API key, or a local ONNX model. Costs + GPU/API key needed.

**Connector path (decision needed):**
- DXF export = open, no vendor dependency (recommended default).
- DWG/SKP = proprietary; via conversion service or app plugin.

**Camera on web:** works via getUserMedia over HTTPS; iOS Safari requires user gesture. Confirmed fallback = file upload.

## 8. Suggested Tech Stack (based on existing scaffold)

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite + Tailwind v4 + Three.js (react-three-fiber) for 3D |
| Backend | Node 22 + Express + TypeScript (existing secure backend) |
| Data | SQLite via `node:sqlite` (local-first); upgrade path to Postgres |
| CAD export | `dxf-writer`/`three-dxf`, GLTF/OBJ via Three.js, IFC via `web-ifc` |
| AI render | **[TBD]** external API vs local model |
| Auth/Security | Existing scrypt + TOTP + CSRF + rate-limit + AES-GCM + audit layer |

## 9. Milestones

1. **M1 — Foundation**: secure auth + photo capture/upload + project CRUD + encrypted storage.
2. **M2 — Design editor**: furniture/colour/curtain palette, drag-drop editor, composite render (Tier 1).
3. **M3 — Export & connectors**: DXF/OBJ/GLB/IFC export, connect flow, PDF summary.
4. **M4 — AI generation** **[TBD]** : plug selected AI renderer.

## 10. Open Questions for Confirmation

1. Photorealistic AI generation: yes/no, and via external API (which?) or on-device model?
2. AutoCAD connection scope: export only, or live sync both ways (importer too)?
3. Required CAD formats: DXF (default) + which others and their priority?
4. Team/multi-user collaboration required, or single-user projects, initially?
5. Primary target device for camera capture: mobile, tablet, or both?