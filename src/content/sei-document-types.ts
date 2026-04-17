/**
 * Descoberta dos tipos de documento habilitados para a unidade atual no SEI.
 *
 * Usado pelo autocomplete do painel ("Escolher outro ato…") para sugerir
 * tipos que o usuário pode efetivamente criar — complementando os 8 atos
 * canônicos do catálogo `ATOS_ADMINISTRATIVOS`.
 *
 * Estratégia: localiza o iframe com a árvore (`ifrArvore`) e captura o
 * link "Incluir Documento" da toolbar. Esse link aponta para
 * `controlador.php?acao=documento_escolher_tipo&...` com `infra_hash`
 * válido — carregamos essa URL num iframe oculto, aguardamos o load e
 * parseamos a lista de tipos renderizada pelo servidor.
 *
 * O resultado fica em cache durante a sessão. Falha é silenciosa (o
 * autocomplete degrada graciosamente para apenas os atos canônicos).
 */

const LOG = '[SEIrtão/tipos]';

let cached: string[] | null = null;
let inflight: Promise<string[]> | null = null;

/** Retorna os tipos já descobertos (sem disparar nova descoberta). */
export function peekDocumentTypes(): string[] | null {
  return cached;
}

/**
 * Busca no frame top o iframe da árvore do SEI (`ifrArvore`) e, dentro
 * dele, a URL do "Incluir Documento". Devolve null se ainda não carregou.
 */
function findIncluirDocumentoUrl(): string | null {
  const iframes = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'));
  for (const iframe of iframes) {
    let doc: Document | null = null;
    try { doc = iframe.contentDocument; } catch { continue; }
    if (!doc) continue;

    const anchors = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'));
    for (const a of anchors) {
      const href = a.getAttribute('href') ?? '';
      if (!href) continue;

      if (href.includes('acao=documento_escolher_tipo')) {
        return new URL(href, doc.location?.href ?? window.location.href).toString();
      }

      if (!href.includes('controlador.php')) continue;

      const title = (a.getAttribute('title') ?? '').toLowerCase();
      const text = (a.textContent ?? '').toLowerCase();
      const img = a.querySelector('img');
      const imgAlt = (img?.getAttribute('alt') ?? '').toLowerCase();
      const imgTitle = (img?.getAttribute('title') ?? '').toLowerCase();
      const imgSrc = (img?.getAttribute('src') ?? '').toLowerCase();

      const matches =
        /incluir\s+documento/.test(title) ||
        /incluir\s+documento/.test(text) ||
        /incluir\s+documento/.test(imgAlt) ||
        /incluir\s+documento/.test(imgTitle) ||
        /documento_incluir\.svg/.test(imgSrc);

      if (matches) {
        return new URL(href, doc.location?.href ?? window.location.href).toString();
      }
    }
  }
  return null;
}

/**
 * Carrega uma URL em iframe oculto e extrai a lista de tipos de documento
 * da página `documento_escolher_tipo`. A tabela do SEI lista cada tipo
 * como um link; pegamos o texto de cada link dentro da área de resultados.
 */
function fetchTypesFromUrl(url: string, timeoutMs = 12000): Promise<string[]> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.left = '-9999px';
    iframe.style.top = '-9999px';
    iframe.style.width = '800px';
    iframe.style.height = '600px';
    iframe.style.border = '0';
    iframe.style.visibility = 'hidden';
    iframe.src = url;

    let done = false;
    const cleanup = (): void => {
      if (done) return;
      done = true;
      try { iframe.remove(); } catch { /* ignore */ }
    };

    const timer = window.setTimeout(() => {
      if (done) return;
      console.warn(`${LOG} timeout esperando documento_escolher_tipo.`);
      cleanup();
      resolve([]);
    }, timeoutMs);

    iframe.addEventListener('load', () => {
      if (done) return;
      try {
        const doc = iframe.contentDocument;
        if (!doc) {
          window.clearTimeout(timer);
          cleanup();
          resolve([]);
          return;
        }

        const types = extractTypesFromDocument(doc);
        window.clearTimeout(timer);
        cleanup();
        resolve(types);
      } catch (err) {
        console.warn(`${LOG} erro lendo iframe de tipos:`, err);
        window.clearTimeout(timer);
        cleanup();
        resolve([]);
      }
    });

    document.body.appendChild(iframe);
  });
}

/**
 * Parseia a página `documento_escolher_tipo` extraindo os nomes de tipo
 * de documento. A estrutura típica do SEI é uma tabela onde cada linha
 * contém um link com o nome do tipo. Além disso pode haver uma lista
 * favoritos no topo. Capturamos ambos, deduplicamos e ordenamos.
 */
function extractTypesFromDocument(doc: Document): string[] {
  const names = new Set<string>();

  doc.querySelectorAll<HTMLAnchorElement>('a').forEach((a) => {
    const href = a.getAttribute('href') ?? '';
    const onclick = a.getAttribute('onclick') ?? '';
    const text = (a.textContent ?? '').trim();
    if (!text) return;
    if (text.length < 3 || text.length > 80) return;

    const looksLikeTypePicker =
      href.includes('acao=documento_cadastrar') ||
      href.includes('id_serie=') ||
      onclick.includes('id_serie') ||
      onclick.includes('documento_cadastrar');

    if (looksLikeTypePicker) names.add(text);
  });

  if (names.size === 0) {
    doc.querySelectorAll<HTMLTableCellElement>('table td a').forEach((a) => {
      const text = (a.textContent ?? '').trim();
      if (text && text.length >= 3 && text.length <= 80 && /[a-záéíóúçãõ]/i.test(text)) {
        names.add(text);
      }
    });
  }

  return Array.from(names).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/**
 * Descobre os tipos de documento habilitados. Usa cache in-memory por
 * sessão. Em caso de falha, retorna []. Chamadas concorrentes
 * compartilham a mesma Promise.
 */
export async function discoverDocumentTypes(): Promise<string[]> {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async (): Promise<string[]> => {
    const url = findIncluirDocumentoUrl();
    if (!url) {
      console.log(`${LOG} URL de "Incluir Documento" não localizada no ifrArvore.`);
      return [];
    }
    console.log(`${LOG} descobrindo tipos via ${url.slice(0, 120)}…`);
    const types = await fetchTypesFromUrl(url);
    console.log(`${LOG} ${types.length} tipos descobertos.`);
    if (types.length > 0) cached = types;
    return types;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** Limpa o cache (ex.: quando a unidade atual do SEI muda). */
export function invalidateDocumentTypes(): void {
  cached = null;
}
