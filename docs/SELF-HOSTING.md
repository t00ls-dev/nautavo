# Self-hosting

The build is a static site that runs from the root of any domain. Set `SITE_URL` to that address so the canonical and sharing URLs, the sitemap and robots.txt name it instead of nautavo.com (`src/site.ts`):

```sh
npm ci
SITE_URL=https://routes.example.org/ npm run build   # then serve dist/
```

- The address must be the root of a host: the app is built for the `/` base, and the build stops with an error for a path, query or fragment.
- The host must serve pages without their extension (`/help` from `help.html`), as nginx does with `try_files $uri $uri.html $uri/ =404`.
- The approximate region (`/api/region`) comes from the Cloudflare Worker in [`src/worker.ts`](../src/worker.ts); without it the first map view simply skips that step.
- Security headers come with the build (`_headers`, read by Cloudflare) and the Worker; another host should send the same ones, from [`src/security-headers.ts`](../src/security-headers.ts). Their policy lets the site connect only to https services.
- [`wrangler.jsonc`](../wrangler.jsonc) and the Deploy workflow belong to nautavo.com's own deployment.
- The default routing, search, weather and elevation servers are public services with usage policies ([services and privacy](SERVICES.md)); for more than light use, run your own and set them in Settings.
