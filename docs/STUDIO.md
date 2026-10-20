# Integrated Groundwork studio

The public studio and design workspace share one origin and one Vite 8 build. `/` serves `client/studio.html`, a vanilla JavaScript/Three.js presentation. Application URLs such as `/login`, `/signup`, `/dashboard`, `/editor/:id`, `/share/:token` and authentication callbacks serve `client/index.html` and React Router. The authority server, secondary host, Vite development server and offline service worker all use this distinction.

The studio's styles are loaded only by its own document. Following **Enter the studio** opens the protected dashboard, with the existing sign-in redirect when needed. React home navigation performs a document transition back to the public studio. Authentication, billing, project permissions and encrypted storage remain in the existing backend.

## Design and content

- Tokens: `client/studio/styles/tokens.css` (colour, type, fluid sizing and motion curves).
- Markup and studio copy: `client/studio.html`.
- Eight illustrative project records: `client/studio/data/projects.js`.
- Modular area CSS: `client/studio/styles/`.
- Three.js models: `client/studio/scene/`.
- Lifecycle and scroll stages: `client/studio/main.js`.
- Local photographs and licensed fonts: `client/public/studio-assets/`; credits in [STUDIO-ASSETS.md](STUDIO-ASSETS.md).

The portfolio is concept content using credited third-party photographs. Replace sample project facts and the example contact address with verified studio content before public commercial use.

Set `VITE_CONTACT_EMAIL` and optional `VITE_NEWSLETTER_ENDPOINT` in `client/.env.local` **before building**. Never place secrets in `VITE_` variables. The newsletter remains disabled and clearly labelled coming soon until a real endpoint is configured. It requires a JSON POST accepting `{email, consent, website}` and explicit `{subscribed:true}` confirmation. The current application CSP allows same-origin connections; prefer a reviewed same-origin subscription service rather than weakening CSP for arbitrary providers. This integration does not invent a mailing list backend.

## Run and validate

From the repository root, with Node 22.12 or newer:

```sh
npm ci
npm run dev
npm test
npm run build
npm run check:build
```

Vite serves the combined site at its printed local URL and proxies `/api` to the backend. Both HTML entries and the complete fingerprinted offline asset inventory are generated in `client/dist/`. `npm start` serves the built site and API together. See [DEPLOYMENT.md](DEPLOYMENT.md) for persistent storage, HTTPS, mail and live-provider requirements.

The public site supports pointer/touch gallery dragging, keyboard navigation, native project dialogs, three services layouts, five selectable process stages, system reduced motion, a persistent motion preference and WebGL fallback illustrations. No visitor email address is stored in browser storage. Architectural animations pause when offscreen or the tab is hidden.

When upgrading an installed PWA, finish or preserve editor work and close all old controlled tabs before reopening. The service worker deliberately does not force an update over an unsaved editor; its new inventory includes both documents and all studio assets. Fresh installations and naturally activated updates route the public home and workspace separately, including offline.
