// The Cloudflare Worker behind nautavo.com (wrangler.jsonc). Static files are
// served without it; it runs only for /api/* (assets.run_worker_first).
import { REGION_PATH, regionFromCf, type CfLocation } from './region';

/** Answers carry a location or nothing; none may be kept by any cache. */
const NO_STORE = { 'Cache-Control': 'no-store' };

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === REGION_PATH && request.method === 'GET') {
      const answer = regionFromCf((request as { cf?: CfLocation }).cf);
      return answer
        ? Response.json(answer, { headers: NO_STORE })
        : new Response(null, { status: 204, headers: NO_STORE });
    }
    return new Response('Not found', {
      status: 404,
      headers: { ...NO_STORE, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  },
};
