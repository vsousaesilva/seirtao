/**
 * Adapter do SEI 5.0.4 (TRF5 — sei.trf5.jus.br).
 *
 * A árvore do processo é serializada como JS inline dentro da página
 * `controlador.php?acao=procedimento_visualizar&id_procedimento=X`:
 *   Nos[n] = new infraArvoreNo(tipo, id, pai, link, target, label, tooltip, ...)
 *   Nos[n].src  = '...'
 *   Nos[n].html = '...'
 *   NosAcoes[k] = new infraArvoreAcao(idNo, tipo, descricao)
 *
 * Este adapter parseia esse script sem executá-lo (seguro em content script)
 * e expõe também utilitários de fetch Latin-1 e extração das URLs de ação
 * pré-assinadas do frame `arvore_visualizar`.
 */

export type TipoNo = 'PROCESSO' | 'PASTA' | 'AGUARDE' | 'DOCUMENTO';

export interface NoArvore {
  tipo: TipoNo;
  id: string;
  pai: string | null;
  link: string | null;
  target: string | null;
  label: string;
  tooltip: string;
  src?: string;
  html?: string;
}

export interface AcaoNo {
  idNo: string;
  tipo: string;
  descricao: string;
}

export interface ArvoreProcesso {
  nos: NoArvore[];
  acoes: AcaoNo[];
  numeroProcesso: string | null;
}

const SEI_HOST = 'sei.trf5.jus.br';

/** Confirma que a página atual é do SEI do TRF5. */
export function isSeiPage(location: Location = window.location): boolean {
  return location.host === SEI_HOST;
}

/** Retorna o valor de um parâmetro da querystring atual (ou de uma URL explícita). */
export function getAcao(urlOrSearch: string = window.location.search): string | null {
  const qs = urlOrSearch.includes('?') ? urlOrSearch.slice(urlOrSearch.indexOf('?') + 1) : urlOrSearch.replace(/^\?/, '');
  const params = new URLSearchParams(qs);
  return params.get('acao');
}

/**
 * Fetch com decodificação forçada em ISO-8859-1.
 * As páginas do SEI declaram `charset=iso-8859-1`; confiar no default UTF-8
 * do `Response.text()` corrompe acentos em títulos e tooltips.
 */
export async function fetchLatin1(url: string): Promise<string> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`fetchLatin1: ${res.status} ${res.statusText} — ${url}`);
  }
  const buffer = await res.arrayBuffer();
  return new TextDecoder('iso-8859-1').decode(buffer);
}

/**
 * Tokeniza os argumentos de uma chamada de construtor JS (`f(a, b, c)`)
 * respeitando strings com aspas simples/duplas e sequências de escape.
 * Retorna lista de tokens já com o literal JS unquotado (ou `null` pro literal `null`).
 */
function parseJsArgs(inside: string): Array<string | null> {
  const out: Array<string | null> = [];
  let i = 0;
  const n = inside.length;
  while (i < n) {
    while (i < n && /\s/.test(inside[i]!)) i++;
    if (i >= n) break;
    const ch = inside[i]!;
    if (ch === ',') { i++; continue; }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      let str = '';
      while (i < n) {
        const c = inside[i]!;
        if (c === '\\' && i + 1 < n) {
          const next = inside[i + 1]!;
          if (next === 'n') str += '\n';
          else if (next === 'r') str += '\r';
          else if (next === 't') str += '\t';
          else str += next;
          i += 2;
          continue;
        }
        if (c === quote) { i++; break; }
        str += c;
        i++;
      }
      out.push(str);
    } else {
      let token = '';
      while (i < n && inside[i] !== ',') {
        token += inside[i]!;
        i++;
      }
      const t = token.trim();
      if (t === 'null' || t === '' || t === 'undefined') out.push(null);
      else out.push(t);
    }
  }
  return out;
}

/**
 * Encontra uma chamada de função (padrão `fn(...)`) a partir de um índice,
 * respeitando parênteses aninhados e strings com aspas.
 * Retorna o conteúdo interno (sem os parênteses externos) e o índice do `)` final.
 */
function extractCallArgs(src: string, fromIndex: number): { inside: string; endIndex: number } | null {
  const open = src.indexOf('(', fromIndex);
  if (open < 0) return null;
  let depth = 1;
  let i = open + 1;
  let inStr: string | null = null;
  while (i < src.length) {
    const c = src[i]!;
    if (inStr) {
      if (c === '\\' && i + 1 < src.length) { i += 2; continue; }
      if (c === inStr) inStr = null;
      i++;
      continue;
    }
    if (c === "'" || c === '"') { inStr = c; i++; continue; }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return { inside: src.slice(open + 1, i), endIndex: i };
    }
    i++;
  }
  return null;
}

/**
 * Parseia a árvore a partir do HTML cru da página `procedimento_visualizar`.
 * Seguro para rodar em content script — não executa nada, só varre o texto.
 */
export function parseArvore(html: string): ArvoreProcesso {
  const nos: NoArvore[] = [];
  const acoes: AcaoNo[] = [];

  // 1. Nos[idx] = new infraArvoreNo(...)
  const noPattern = /Nos\[\s*(\d+)\s*\]\s*=\s*new\s+infraArvoreNo\s*/g;
  let match: RegExpExecArray | null;
  while ((match = noPattern.exec(html))) {
    const idx = Number(match[1]);
    const call = extractCallArgs(html, match.index + match[0].length);
    if (!call) continue;
    const args = parseJsArgs(call.inside);
    const [tipo, id, pai, link, target, label, tooltip] = args;
    nos[idx] = {
      tipo: (tipo ?? 'DOCUMENTO') as TipoNo,
      id: id ?? '',
      pai: pai,
      link: link,
      target: target,
      label: label ?? '',
      tooltip: tooltip ?? '',
    };
  }

  // 2. Nos[idx].src = '...'  |  Nos[idx].html = '...'
  const srcPattern = /Nos\[\s*(\d+)\s*\]\s*\.\s*(src|html)\s*=\s*(['"])/g;
  while ((match = srcPattern.exec(html))) {
    const idx = Number(match[1]);
    const prop = match[2] as 'src' | 'html';
    const quote = match[3]!;
    const start = match.index + match[0].length;
    let i = start;
    let value = '';
    while (i < html.length) {
      const c = html[i]!;
      if (c === '\\' && i + 1 < html.length) {
        const nxt = html[i + 1]!;
        if (nxt === 'n') value += '\n';
        else if (nxt === 'r') value += '\r';
        else if (nxt === 't') value += '\t';
        else value += nxt;
        i += 2;
        continue;
      }
      if (c === quote) break;
      value += c;
      i++;
    }
    if (nos[idx]) nos[idx]![prop] = value;
  }

  // 3. NosAcoes[k] = new infraArvoreAcao(idNo, tipo, descricao)
  const acaoPattern = /NosAcoes\[\s*\d+\s*\]\s*=\s*new\s+infraArvoreAcao\s*/g;
  while ((match = acaoPattern.exec(html))) {
    const call = extractCallArgs(html, match.index + match[0].length);
    if (!call) continue;
    const args = parseJsArgs(call.inside);
    const [idNo, tipo, descricao] = args;
    if (idNo && tipo) {
      acoes.push({ idNo, tipo, descricao: descricao ?? '' });
    }
  }

  const numeroProcesso = nos[0] && nos[0].tipo === 'PROCESSO' ? nos[0].label : null;

  return {
    nos: nos.filter((n): n is NoArvore => !!n),
    acoes,
    numeroProcesso,
  };
}

/**
 * URLs pré-assinadas declaradas como variáveis JS globais no frame
 * `arvore_visualizar`. Reutilizáveis sem rotação de `infra_hash` enquanto
 * a sessão estiver válida.
 *
 * Chaves esperadas (parcial): linkEditarConteudo, linkAssinarDocumento,
 * linkExcluirDocumento, linkMontarArvoreProcesso, linkMontarArvoreProcessarHtml,
 * linkCienciaDocumento, linkDocumentoEnviarEmail, linkBotoesAcesso.
 */
export function extractActionUrls(source: string): Record<string, string> {
  const urls: Record<string, string> = {};
  const pattern = /(?:var\s+)?(link[A-Za-z0-9_]+)\s*=\s*(['"])([^'"]*?)\2\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(source))) {
    const key = m[1]!;
    const value = m[3]!;
    if (value.includes('controlador.php') || value.includes('controlador_rest.php') || value.includes('controlador_ajax.php')) {
      urls[key] = value;
    }
  }
  return urls;
}

/** Atalho: extrai as URLs de ação de um Document já parseado (busca em todos os <script>). */
export function extractActionUrlsFromDocument(doc: Document): Record<string, string> {
  const scripts = doc.querySelectorAll('script');
  let combined = '';
  scripts.forEach((s) => { combined += s.textContent + '\n'; });
  return extractActionUrls(combined);
}

/**
 * Baixa um documento do SEI (HTML) e devolve apenas o texto visível do corpo.
 *
 * O `src` do nó da árvore geralmente aponta para `controlador.php?acao=...`
 * que renderiza o HTML do documento em si. Este helper faz o fetch em Latin-1,
 * parseia o HTML e extrai `body.innerText`, removendo scripts/styles e
 * colapsando espaços.
 *
 * Se o `src` puder ser resolvido via DOMParser mas não render visível (ex.:
 * documentos digitalizados cujo conteúdo é PDF), devolvemos uma string vazia
 * para que o orquestrador possa sinalizar a ausência de texto ao LLM.
 */
export async function fetchDocumentoTexto(src: string): Promise<string> {
  const absUrl = src.startsWith('http') ? src : new URL(src, `${window.location.origin}/sei/`).toString();
  const html = await fetchLatin1(absUrl);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript').forEach((el) => el.remove());
  const body = doc.body;
  if (!body) return '';
  const text = (body as HTMLElement).innerText || body.textContent || '';
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
