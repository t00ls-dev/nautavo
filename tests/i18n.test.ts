import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  detectLanguage,
  preferredLanguage,
  rememberLanguage,
  setLanguage,
  storedLanguage,
  t,
  translate,
  translateDocument,
} from '../src/i18n';
import { readRepoFile as read, sourceFiles } from './repo-files';
afterEach(() => {
  setLanguage('en');
  document.body.replaceChildren();
});
it('translates native UI labels and dynamic messages in both directions', () => {
  setLanguage('pt');
  expect(t('Download GPX')).toBe('Baixar GPX');
  expect(t('7 points')).toBe('7 pontos');
  setLanguage('en');
  expect(t('Download GPX')).toBe('Download GPX');
});
it('keeps the no-break space between a number and its unit', () => {
  // Other runs of white space become one space before matching.
  expect(
    translate('Min 100\u00a0m · Max 2,500\u00a0m · Avg 1,308\u00a0m', 'pt'),
  ).toBe('Mín 100\u00a0m · Máx 2,500\u00a0m · Média 1,308\u00a0m');
  expect(translate('  Download\n  GPX ', 'pt')).toBe('Baixar GPX');
});
it('switches existing content and placeholders without overwriting typed place names', () => {
  document.body.innerHTML =
    '<h1>Plan your route</h1><input placeholder="My road trip" value="Postinho do Alto">';
  setLanguage('pt');
  translateDocument();
  expect(document.querySelector('h1')?.textContent).toBe('Criar rota');
  expect(document.querySelector('input')?.value).toBe('Postinho do Alto');
  expect(document.querySelector('input')?.placeholder).toBe('Minha viagem');
  setLanguage('en');
  expect(document.querySelector('h1')?.textContent).toBe('Plan your route');
  expect(document.querySelector('input')?.placeholder).toBe('My road trip');
});

it('translates the weather card rain and an automatic stop by its place', () => {
  setLanguage('pt');
  expect(t('Rain')).toBe('Chuva');
  expect(t('Stop · km 1,2')).toBe('Parada · km 1,2');
  setLanguage('en');
  expect(t('Stop · km 1.2')).toBe('Stop · km 1.2');
});
it('translates the map hint for each kind of point', () => {
  setLanguage('pt');
  expect(t('Set the start on the map')).toBe('Defina o início no mapa');
  expect(t('Set the destination on the map')).toBe('Defina o destino no mapa');
  expect(t('Set stop 2 on the map')).toBe('Defina a parada 2 no mapa');
  setLanguage('en');
  expect(t('Set stop 2 on the map')).toBe('Set stop 2 on the map');
});

it('translates generated stop names and short status messages', () => {
  setLanguage('pt');
  expect(
    t(
      'This link suggests other routing servers: example.org. The route uses the default servers.',
    ),
  ).toBe(
    'Este link sugere outros servidores de rota: example.org. A rota usa os servidores padrão.',
  );
  expect(t('Use link servers')).toBe('Usar servidores do link');
  expect(
    t(
      'Could not calculate the route right now. Check the points or try again.',
    ),
  ).toBe(
    'Não foi possível calcular a rota agora. Confira os pontos ou tente de novo.',
  );
  expect(t('Set point 3.')).toBe('Defina o ponto 3.');
  expect(t('Set your start.')).toBe('Defina o início.');
  expect(t('Keep default servers')).toBe('Manter servidores padrão');
  expect(t('Stop 2')).toBe('Parada 2');
  expect(t('Return to start')).toBe('Volta ao início');
  expect(
    t('Off the road: point 2 (150 m). The route uses the nearest road.'),
  ).toBe('Fora da via: ponto 2 (150 m). A rota usa a via mais próxima.');
  setLanguage('en');
  expect(t('Stop 2')).toBe('Stop 2');
});

describe('language preference', () => {
  afterEach(() => localStorage.clear());
  it('detects the first supported browser language by prefix', () => {
    expect(detectLanguage(['es-ES', 'pt-BR'])).toBe('pt');
    expect(detectLanguage(['EN-gb', 'pt'])).toBe('en');
  });
  it('falls back to English when no browser language is supported', () => {
    expect(detectLanguage(['es-ES', 'fr'])).toBe('en');
    expect(detectLanguage([])).toBe('en');
  });
  it('prefers the stored choice over the browser languages', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
    rememberLanguage('pt');
    expect(storedLanguage()).toBe('pt');
    expect(preferredLanguage()).toBe('pt');
    vi.restoreAllMocks();
  });
  it('ignores invalid stored values', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['pt-BR']);
    localStorage.setItem('language', 'xx');
    expect(storedLanguage()).toBeUndefined();
    expect(preferredLanguage()).toBe('pt');
    vi.restoreAllMocks();
  });
});

describe('translation coverage', () => {
  // Product names, units, language codes and licenses stay the same in Portuguese.
  const sameInBothLanguages = new Set([
    'Nautavo',
    // The format's name, the Settings › Advanced row of the JSON editor.
    'JSON',
    // Required map attribution, kept as written.
    '© OpenStreetMap',
    'Language / Idioma',
    // Language codes in the help and What's new headers, and each language
    // named in itself in Settings.
    'EN',
    'PT',
    'English',
    'Português',
    'km',
    'mi',
    'Celsius',
    'Fahrenheit',
    'km/h',
    '1–120 km/h',
    'EOX 2025 · CC BY-NC-SA 4.0',
    'EOX 2016 · CC BY 4.0',
    'GitHub',
    'Android',
  ]);
  // Thrown only to callers that replace them with a translated message.
  const internalErrors = new Set([
    'Superseded route',
    'Invalid position',
    'Photon unavailable',
    'Invalid Photon response',
    'Invalid route geometry.',
    'Invalid tile template',
    'Invalid tile URL',
    'Invalid tile configuration',
    'Invalid route backup.',
    'Invalid saved route name.',
    'Invalid saved route points.',
    'Invalid saved route geometry.',
    'Local route storage is blocked by another tab.',
  ]);
  const untranslated = (texts: Iterable<string>) =>
    [...new Set(texts)].filter(
      (text) =>
        /[a-z]{2}/i.test(text) &&
        !sameInBothLanguages.has(text) &&
        !internalErrors.has(text) &&
        translate(text, 'pt') === text,
    );

  it('translates every interface text and attribute in index.html', () => {
    const doc = new DOMParser().parseFromString(
      read('index.html'),
      'text/html',
    );
    const texts: string[] = [];
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode()))
      if (!node.parentElement?.closest('script,style,textarea,noscript'))
        texts.push((node.nodeValue ?? '').trim().replace(/\s+/g, ' '));
    doc
      .querySelectorAll('[placeholder],[aria-label],[title]')
      .forEach((element) =>
        ['placeholder', 'aria-label', 'title'].forEach((attr) => {
          const value = element.getAttribute(attr);
          if (value) texts.push(value);
        }),
      );
    expect(untranslated(texts)).toEqual([]);
  });

  it('translates literal status and error messages shown to users', () => {
    const files = sourceFiles().filter((file) => file !== 'src/i18n.ts');
    const messages = files.flatMap((file) =>
      Array.from(
        read(file).matchAll(
          /\b(?:new Error|status|libraryMessage|message)\(\s*'((?:[^'\\]|\\.)+)'/g,
        ),
        (match) => match[1].replace(/\\'/g, "'"),
      ),
    );
    expect(messages.length).toBeGreaterThan(50);
    expect(untranslated(messages)).toEqual([]);
  });

  it('uses singular forms', () => {
    setLanguage('pt');
    expect(t('1 local road section · 0.8 km')).toBe(
      '1 trecho em via local · 0.8 km',
    );
    expect(t('3 local road sections · 6,2 km')).toBe(
      '3 trechos em vias locais · 6,2 km',
    );
    expect(t('Imported 1 route. Existing names were kept.')).toBe(
      '1 rota importada. Os nomes existentes foram mantidos.',
    );
  });
});

it('translates the daylight phrases', () => {
  setLanguage('pt');
  expect(t('Sunrise')).toBe('Nascer do sol');
  expect(t('Sunset')).toBe('Pôr do sol');
  expect(t('12 km in the dark')).toBe('12 km no escuro');
  expect(t('Leave by 8 de nov., 17:35 to arrive before sunset.')).toBe(
    'Saia até 8 de nov., 17:35 para chegar antes do pôr do sol.',
  );
  expect(t('Daylight at the start from 05:42.')).toBe(
    'Luz do dia no início a partir de 05:42.',
  );
});

it('translates usage-limit waits for weather and elevation', () => {
  expect(
    translate('Elevation usage limit reached. Try again in 30s.', 'pt'),
  ).toBe('Limite de uso da elevação atingido. Tente em 30s.');
  expect(
    translate('Weather usage limit reached. Try again in 2 min.', 'pt'),
  ).toBe('Limite de uso do clima atingido. Tente em 2 min.');
});
it('calls elevation Elevação in Portuguese, never altitude (#298)', () => {
  const entries = [
    ...read('src/i18n.ts').matchAll(/'([^']*levation[^']*)':\s*'([^']*)'/g),
  ];
  expect(entries.length).toBeGreaterThan(5);
  expect(
    entries.filter(([, , pt]) => /altitude/i.test(pt)).map(([, en]) => en),
  ).toEqual([]);
});
