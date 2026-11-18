// The Cloudflare Worker behind nautavo.com (wrangler.jsonc). Static files are
// served without it: it runs for /api/* (assets.run_worker_first) and for
// paths no file matches, which get its 404.
import { REGION_PATH, regionAnswer, type RegionFields } from './region';

/** Answers carry a location or nothing; none may be kept by any cache. */
const NO_STORE = { 'Cache-Control': 'no-store' };
/** What the Worker serves is never a page to index (only prod pages are). */
const HEADERS = { ...NO_STORE, 'X-Robots-Tag': 'noindex' };

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === REGION_PATH) {
      // HEAD answers like GET without a body, as static files do.
      if (request.method !== 'GET' && request.method !== 'HEAD')
        return new Response(null, {
          status: 405,
          headers: { ...HEADERS, Allow: 'GET, HEAD' },
        });
      const answer = regionAnswer((request as { cf?: RegionFields }).cf);
      if (!answer) return new Response(null, { status: 204, headers: HEADERS });
      const response = Response.json(answer, { headers: HEADERS });
      return request.method === 'HEAD'
        ? new Response(null, response)
        : response;
    }
    return new Response('Not found', {
      status: 404,
      headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  },
};
