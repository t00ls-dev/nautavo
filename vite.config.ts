import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { Connect, Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import {
  BRAND_PATH,
  hashedBrandUrls,
  UNLINKED_BRAND_FILES,
} from './src/brand-assets.ts';
import { precacheList, precacheUrl } from './src/precache.ts';
import { REGION_PATH } from './src/region.ts';
import worker from './src/worker.ts';

const SW_ENTRY = 'sw';

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)));
}

/**
 * Writes this build's version and URL list into `sw.js` (src/sw.ts), once
 * every file, public ones included, is in the output folder. The version
 * hashes the files' contents, so each deploy that changes them installs a new
 * service worker and cache.
 */
function serviceWorkerManifest(): Plugin {
  let outDir = 'dist';
  return {
    name: 'service-worker-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const files = precacheList(await listFiles(outDir));
      const hash = createHash('sha256');
      for (const file of files) {
        hash.update(file);
        hash.update(await readFile(join(outDir, file)));
      }
      const version = hash.digest('hex').slice(0, 16);
      // Pages are cached and requested by their public URL (`/help`).
      const urls = files.map(precacheUrl);
      const path = join(outDir, 'sw.js');
      const source = await readFile(path, 'utf8');
      const token = /(["'`])__NAUTAVO_BUILD__\1/;
      if (!token.test(source))
        throw new Error('sw.js has no build manifest placeholder');
      await writeFile(
        path,
        source.replace(
          token,
          JSON.stringify(JSON.stringify({ version, urls })),
        ),
      );
    },
  };
}

/**
 * Gives the brand files (src/brand/) hashed URLs everywhere: Vite rewrites the
 * pages' links and images itself; this emits the files only the manifest and
 * the sharing metadata name, then points the pages' absolute social image
 * URLs and the manifest's icons at the built files. The manifest keeps its
 * fixed URL: its source in public/ is replaced in the output by this copy.
 */
function brandAssets(): Plugin {
  let root = '';
  const source = (file: string) => resolve(root, BRAND_PATH.slice(1), file);
  return {
    name: 'brand-assets',
    apply: 'build',
    configResolved(config) {
      root = config.root;
    },
    async buildStart() {
      for (const file of UNLINKED_BRAND_FILES)
        this.emitFile({
          type: 'asset',
          name: file,
          originalFileName: `${BRAND_PATH.slice(1)}${file}`,
          source: await readFile(source(file)),
        });
    },
    generateBundle: {
      order: 'post',
      async handler(_, bundle) {
        const built = new Map<string, string>();
        for (const output of Object.values(bundle))
          if (output.type === 'asset')
            for (const name of output.originalFileNames)
              if (name.startsWith(BRAND_PATH.slice(1)))
                built.set(
                  name.slice(BRAND_PATH.length - 1),
                  `/${output.fileName}`,
                );
        for (const output of Object.values(bundle))
          if (output.type === 'asset' && output.fileName.endsWith('.html'))
            output.source = hashedBrandUrls(String(output.source), built);
        this.emitFile({
          type: 'asset',
          fileName: 'manifest.webmanifest',
          source: hashedBrandUrls(
            await readFile(
              resolve(root, 'public/manifest.webmanifest'),
              'utf8',
            ),
            built,
          ),
        });
      },
    },
  };
}

/**
 * Local servers behave like Cloudflare Workers (wrangler.jsonc) where the app
 * depends on it: /api/region is answered by the Worker's own code (204
 * without a Cloudflare location, as in production), and the preview, a
 * production build, redirects `.html` page addresses to their public URL as
 * `html_handling: auto-trailing-slash` does, so the offline tests see the
 * same redirects as the published site.
 */
function workersParity(): Plugin {
  const region: Connect.NextHandleFunction = (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== REGION_PATH) return next();
    void worker
      .fetch(new Request(url, { method: req.method }))
      .then(async (response) => {
        res.statusCode = response.status;
        response.headers.forEach((value, name) => res.setHeader(name, value));
        res.end(Buffer.from(await response.arrayBuffer()));
      })
      .catch(next);
  };
  const cleanUrls: Connect.NextHandleFunction = (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const target = precacheUrl(url.pathname);
    if (target === url.pathname) return next();
    res.statusCode = 307;
    res.setHeader('Location', target + url.search);
    res.end();
  };
  return {
    name: 'workers-parity',
    configureServer(server) {
      server.middlewares.use(region);
    },
    configurePreviewServer(server) {
      server.middlewares.use(region);
      server.middlewares.use(cleanUrls);
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [brandAssets(), serviceWorkerManifest(), workersParity()],
  // The local preview (preview.nautavo.com) is never indexed; only prod is.
  preview: { headers: { 'X-Robots-Tag': 'noindex' } },
  build: {
    // Brand files keep their own hashed URLs instead of being inlined.
    assetsInlineLimit: (file) =>
      file.includes(BRAND_PATH) ? false : undefined,
    // MapLibre GL JS (about 1,090 kB minified, 296 kB gzipped) is one
    // lazy chunk loaded only when navigation starts; the default 500 kB
    // limit warned about it on every build. The app's own entry stays far
    // below this, so a new warning still means a chunk worth reviewing.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        main: 'index.html',
        help: 'help.html',
        changelog: 'changelog.html',
        // The service worker is served at the root, unhashed, so its scope is
        // the whole site and the browser finds each new version at one URL.
        [SW_ENTRY]: 'src/sw.ts',
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === SW_ENTRY ? 'sw.js' : 'assets/[name]-[hash].js',
      },
    },
  },
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts'] },
});
