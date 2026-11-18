// The Cloudflare Worker behind nautavo.com (wrangler.jsonc). Static files are
// served without it; it runs only for /api/* (assets.run_worker_first).
import { REGION_PATH, regionAnswer, type RegionFields } from './region';

/** Answers carry a location or nothing; none may be kept by any cache. */
const NO_STORE = { 'Cache-Control': 'no-store' };

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // HEAD answers like GET without a body, as static files do.
    if (
      url.pathname === REGION_PATH &&
      (request.method === 'GET' || request.method === 'HEAD')
    ) {
      const answer = regionAnswer((request as { cf?: RegionFields }).cf);
      if (!answer)
        return new Response(null, { status: 204, headers: NO_STORE });
      const response = Response.json(answer, { headers: NO_STORE });
      return request.method === 'HEAD'
        ? new Response(null, response)
        : response;
    }
    return new Response('Not found', {
      status: 404,
      headers: { ...NO_STORE, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  },
};
