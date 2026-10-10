# Groundwork interface refresh

Historical review of local snapshot `e90f97a`; source line positions may differ in the merged branch. See [the current six-item comparison](SECURITY-AUDIT-COMPARISON.md) for integration status and current validation.

The frontend now shares a graphite, sage, and ivory design system across its public pages, authentication, project overview, design editor, workbenches, organization tools, billing, activity, and settings.

## Spatial interface

- Interactive Three.js architectural studies appear on public pages and the project overview, with rotation, pause, reset, and wireframe controls.
- Workbench guides use static 3D studies. Smaller navigation, page introductions, project illustrations, and checkout cards use CSS perspective to keep everyday screens lightweight.
- Shared projects display their saved room, community, or infrastructure model with read-only camera controls.
- Decorative scenes respect reduced motion, suspend offscreen rendering, cap pixel density, and release rendering resources when removed. A static illustration remains available when WebGL cannot initialize.

## Interaction and accessibility

- Shared dialogs render above the application shell, contain keyboard focus, support Escape, and return focus to their opener. Mutating operations guard against duplicate submission and stale responses.
- Mobile navigation and editor inspectors provide named dialogs. Fields, scene controls, appearance controls, and authentication stages expose accessible labels.
- Pages provide loading, error, retry, and empty states. Dark, light, and system appearance remain available.
- Demo checkout clearly identifies its zero-charge simulation and does not collect payment credentials.

## Verification scope

Browser review uses an isolated local API database and synthetic account/project data. Checks cover desktop and narrow mobile layouts, theme switching, keyboard navigation, actual project creation and autosave, model import, workspace persistence, shared model viewing, unavailable share recovery, rendering availability, and demo checkout completion. Production rendering still requires a configured provider; development source does not register the production offline application shell.

Run `npm run lint` for both TypeScript projects and `npm run build` for the frontend/PWA and server build. Upload regression checks also verify valid multipart requests and rejection of extra files or fields.

Final verification on October 9, 2026: both commands passed; the multipart regression passed all eight checks; and the browser saved and reloaded workspace revision 1 with seven meshes and 84 triangles. A named project snapshot also saved through keyboard submission. The focused regression command, from `server`, is `node --disable-warning=ExperimentalWarning --import tsx --test --test-name-pattern="workspace multipart uploads" test/api.test.ts`.

The usual development command is `npm run dev`. For an isolated preview, `GROUNDWORK_API_TARGET` can point Vite at a separate local API; the default remains `http://localhost:4000`.
