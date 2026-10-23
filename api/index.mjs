// The Vite frontend is served by the CDN. API requests reuse the existing
// Express application without opening a listener or starting background loops.
let application;

export default async function handler(request, response) {
  try {
    application ??= import('../server/dist/index.js').then((module) => module.app);
    const app = await application;
    return app(request, response);
  } catch (error) {
    application = undefined;
    console.error('[groundwork] Function initialization failed', {
      type: error instanceof Error ? error.name : 'UnknownError',
    });
    if (!response.headersSent) {
      response.statusCode = 503;
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'private, no-store');
      response.end(JSON.stringify({ error: 'The application is temporarily unavailable. Please try again.' }));
    } else if (!response.writableEnded) response.end();
  }
}
