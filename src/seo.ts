const texts = {
  app: {
    en: [
      'Nautavo: Route Planner & GPX Export',
      'Plan routes on real roads, import GPX, FIT or TCX, replay activities, check weather, elevation and surface, navigate on your phone and download GPX. No account.',
    ],
    pt: [
      'Nautavo: Planejador de rotas e exportação GPX',
      'Crie rotas pelas ruas, importe GPX, FIT ou TCX, reveja atividades, veja clima, elevação e pavimento, navegue pelo celular e baixe em GPX. Sem cadastro.',
    ],
  },
  help: {
    en: [
      'Nautavo: Route Planning & GPX Help',
      'Learn to plan and edit routes, import GPX, FIT and TCX, replay activities, read the itinerary, weather, elevation and surface, navigate and share routes.',
    ],
    pt: [
      'Nautavo: Ajuda para criar e exportar rotas',
      'Aprenda a criar e editar rotas, importar GPX, FIT e TCX, rever atividades, ver itinerário, clima, elevação e pavimento, navegar, salvar e compartilhar.',
    ],
  },
  changelog: {
    en: [
      "Nautavo: What's New",
      'See what changed in Nautavo: new features, changes and fixes in the route planner and GPX export, newest first.',
    ],
    pt: [
      'Nautavo: Novidades',
      'Veja o que mudou no Nautavo: novos recursos, mudanças e correções no planejador de rotas e na exportação GPX, das mais recentes às mais antigas.',
    ],
  },
} as const;

const SITE = import.meta.env.SITE_URL;
/**
 * Every page has one indexable URL per language: English at the bare path
 * (also x-default) and Portuguese with `?lang=pt`, matching the hreflang
 * alternates in the HTML and the sitemap. The canonical is set only here, so
 * the raw HTML never names the English URL as canonical of the Portuguese one.
 */
const PATHS = {
  app: '',
  help: 'help',
  changelog: 'changelog',
} as const;

/** `?lang=pt` for Portuguese, nothing for English (the bare URL). */
export function languageQuery(language: 'en' | 'pt'): string {
  return language === 'pt' ? '?lang=pt' : '';
}

export function canonicalUrl(
  language: 'en' | 'pt',
  page: keyof typeof texts = 'app',
): string {
  return SITE + PATHS[page] + languageQuery(language);
}

export function updateSeo(
  language: 'en' | 'pt',
  page: keyof typeof texts = 'app',
): void {
  const pt = language === 'pt';
  const [title, description] = texts[page][language];
  document.title = title;
  for (const selector of [
    'meta[name="description"]',
    'meta[property="og:description"]',
    'meta[name="twitter:description"]',
  ])
    document.querySelector(selector)?.setAttribute('content', description);
  for (const selector of [
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
  ])
    document.querySelector(selector)?.setAttribute('content', title);
  document
    .querySelector('meta[property="og:locale"]')
    ?.setAttribute('content', pt ? 'pt_BR' : 'en_US');
  const url = canonicalUrl(language, page);
  let canonical = document.querySelector<HTMLLinkElement>(
    'link[rel=canonical]',
  );
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.append(canonical);
  }
  canonical.href = url;
  document
    .querySelector('meta[property="og:url"]')
    ?.setAttribute('content', url);
}
