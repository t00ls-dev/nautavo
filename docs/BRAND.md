# nautavo identity

Do not version project UI screenshots or embed them in the README. Use the project logo; keep local verification captures in an ignored `*.local/` folder.

The mark is a compass whose needle is a route: a curve from an orange start point to an arrow pointing north, inside a ring with north, east, south and west ticks. At 32 px and below a simplified mark drops the east, south and west ticks and thickens the strokes, so it stays legible. The wordmark is **nautavo** in lowercase, drawn from Sora SemiBold (SIL Open Font License 1.1) as outlined paths, so no font file is loaded; it is the one piece of text shown as an image, and the brand link carries its accessible name. Keep the interface light and compact.

| Brand color | Use                                         | Color     |
| ----------- | ------------------------------------------- | --------- |
| Sea green   | Icon background, primary interface color    | `#0f7a6b` |
| Navy        | Wordmark                                    | `#102a43` |
| Signal      | The start point of the mark, never for text | `#e8603c` |

The project was called route-gpx until 2026-11; identifiers stored in browsers and backups keep that name (see `AGENTS.md`).

| Role                    | Token                    | Color     |
| ----------------------- | ------------------------ | --------- |
| Primary / route mark    | `--color-primary`        | `#0f7a6b` |
| Primary, hover and text | `--color-primary-strong` | `#0b5e52` |
| Main text               | `--color-text`           | `#1b2934` |
| Secondary text          | `--color-text-muted`     | `#52616d` |
| Background              | `--color-surface`        | `#ffffff` |
| Subtle background       | `--color-subtle`         | `#f5f7f8` |
| Soft background         | `--color-soft`           | `#e7f3f1` |
| Dividers                | `--color-border`         | `#cbd4dc` |
| Control borders         | `--color-border-strong`  | `#8795a1` |
| Focus ring              | `--color-focus`          | `#0b72c6` |
| Errors                  | `--color-danger`         | `#a3262b` |
| Warnings                | `--color-warning`        | `#74420b` |

The tokens are defined once at the top of `src/style.css` for a single light, high-contrast theme. Rules refer to a role by its `--color-*` token, never by another name or by the literal value; a literal that happens to match a token stays only where the role differs (white borders and text on colored marks, the white status strip, map graphics such as the elevation cursor and location accuracy, climb marks). Text uses the system font stack (no web font is loaded): 15px on wide screens and 16px on phones, with at least 13px for secondary text and 16px in editable fields on touch screens. Controls are at least 44px tall, with 8px and 12px corner radii.

The planner is a 400px side panel next to the map on wide screens and a bottom sheet over the map on phones (closed, half or full height). Export actions stay in a bar below the scrolling panel, and map tools are icon-only buttons with accessible names.

Brand files live in `src/brand/`. Use `icon.svg` (the simplified mark) for the favicon and the header, and `wordmark.svg` for the name. `icon-detail.svg` (the full mark) is the source of the larger PNG exports: Apple home-screen and browser metadata icons, and the maskable Android icon, which the script scales into the safe zone; the 32 px tab icon comes from `icon.svg`. `social-card.svg` is the editable source of the sharing preview.

Pages and the manifest name these files by their `/src/brand/` path. The build gives each a hashed URL (`/assets/icon-180-<hash>.png`): Vite rewrites the pages' links and images, and `brandAssets` in `vite.config.ts` rewrites the manifest's icons and the absolute social image in the sharing metadata. A redrawn icon therefore has a URL no browser, proxy or home-screen icon cache has seen; an icon already on someone's home screen keeps the image it was added with. Only files that must keep one address stay in `public/` (manifest, sitemap, robots, notices).

Regenerate PNG files with `node scripts/generate-brand.mjs` (requires Chromium installed through Playwright). All assets are generated locally from repository SVGs.

The manifest supplies browser metadata and uses browser display mode. Its `theme_color` and `background_color` match the HTML `theme-color` (`#ffffff`), so the browser bar blends with the white header of the light theme; the primary green stays in the icons and route mark. This is a web tool with no install prompt: Add to home screen in More actions only shows the browser's own steps, and the icon opens the site in the browser. An app-shell service worker keeps the app's own files so saved routes open offline; routing, search and map tiles require an internet connection.

SEO metadata is present in the initial HTML, with localized titles and descriptions after a language change. Canonical URLs and sharing images never include a route hash or user coordinates. The application, help and What's new have one canonical URL per language, English at the bare path (also `x-default`) and Portuguese with `?lang=pt`; `src/seo.ts` sets that canonical at runtime, so their raw HTML carries only the `hreflang` alternates. The sitemap lists each of these canonical URLs with its `lastmod` and the same alternates. Pages are published without their extension (`/help`, `/changelog`). `public/robots.txt` and the sitemap target the custom-domain root, https://nautavo.com/, which Cloudflare Workers serves over HTTPS (see `AGENTS.md`, Hosting and publication).

For a renamed repository or custom domain, update Vite's base, manifest `id`/`start_url`/`scope`, canonical and sharing URLs and `hreflang` alternates in the three HTML files and `src/seo.ts`, and the sitemap.
