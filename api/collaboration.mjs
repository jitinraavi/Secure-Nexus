import handler from './index.mjs';
import { bindServerlessCancellation } from '../server/dist/serverlessRuntime.js';

// Cancellation is enabled for read-only event streams, leaving ordinary API
// writes free to complete their transaction even when a browser disconnects.
export default function collaborationHandler(request, response) {
  bindServerlessCancellation(request, response);
  if (response.destroyed || response.writableEnded) return;
  return handler(request, response);
}
