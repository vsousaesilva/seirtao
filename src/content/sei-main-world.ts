/**
 * Ponte MAIN world do SEIrtão.
 *
 * O SEI renderiza anchors `<a href="javascript:fn(args)">` e form-clicks
 * com `onclick="..."`. Em Chrome MV3, o CSP da página (`script-src`
 * sem `unsafe-inline`/`unsafe-eval`) bloqueia URLs `javascript:` vindas
 * de `element.click()` sintético disparado do content script. Esse bridge
 * roda em `world: "MAIN"` (contexto da própria página), logo pode invocar
 * `window[fn](...args)` diretamente — é "código da página chamando código
 * da página", liberado pelo CSP.
 *
 * A comunicação com o isolated world é feita por `postMessage`. Não se usa
 * `eval`/`new Function` (também barrados pelo CSP): parseia-se a `href`
 * estaticamente extraindo nome da função + argumentos literais.
 *
 * Handlers disponíveis (envelope `{ __seirtao: <kind>, nonce, ... }`):
 *  - `expand-pasta`       → expande uma pasta da árvore do SEI (legado)
 *  - `invoke-anchor`      → localiza e aciona um `<a>` por seletor ou texto
 *  - `fill-field`         → preenche input/select/radio/checkbox + dispara change
 *  - `click-element`      → clica um elemento (button/input[type=submit]/etc.)
 *  - `ckeditor-set-data`  → injeta HTML em uma instância do CKEditor (v4 ou v5) do SEI
 *  - `query-ckeditor`     → lista as instâncias disponíveis (sem injetar nada)
 */

const LOG = '[SEIrtão/main]';

// ─────────────────────────────────────────────────────────────────────────
// Tipos de mensagem (request/response com envelope `__seirtao`)
// ─────────────────────────────────────────────────────────────────────────

interface BaseReq { __seirtao: string; nonce: string }

interface ExpandPastaReq extends BaseReq { __seirtao: 'expand-pasta'; pastaId: string }
interface ExpandPastaRes {
  __seirtao: 'expand-pasta-result'; nonce: string; ok: boolean;
  method?: 'fn-call' | 'click' | 'href-set'; error?: string;
}

interface InvokeAnchorReq extends BaseReq {
  __seirtao: 'invoke-anchor';
  /** Seletor CSS direto (preferido quando disponível). */
  selector?: string;
  /**
   * Texto (normalizado sem acento, lowercase) contido em qualquer um de:
   * `textContent` do `<a>`, `title` do `<a>`, ou `alt`/`title` do `<img>`
   * interno — o SEI costuma renderizar botões icon-only com texto só no alt.
   */
  textHint?: string;
  /** Filtro adicional: só casa anchors cujo href contenha esta string. */
  hrefContains?: string;
  /**
   * Filtro alternativo para botões icon-only: casa o `src` do `<img>`
   * interno (ex.: `documento_incluir.svg`). Útil quando o texto pode mudar
   * entre unidades mas o ícone é padronizado pelo SEI.
   */
  imgSrcContains?: string;
}
interface InvokeAnchorRes {
  __seirtao: 'invoke-anchor-result'; nonce: string; ok: boolean;
  method?: 'fn-call' | 'click' | 'href-set';
  matchedText?: string; matchedHref?: string; error?: string;
}

interface FillFieldReq extends BaseReq {
  __seirtao: 'fill-field';
  selector: string;
  value: string;
  /**
   * Quando omitido, o handler auto-detecta pelo tagname/type. Para radios,
   * o `selector` deve mirar diretamente o `<input type="radio" value="X">`
   * desejado (o handler marca esse radio e dispara `change`).
   */
  kind?: 'text' | 'radio' | 'select' | 'checkbox';
}
interface FillFieldRes {
  __seirtao: 'fill-field-result'; nonce: string; ok: boolean;
  detectedKind?: string; error?: string;
}

interface ClickElementReq extends BaseReq { __seirtao: 'click-element'; selector: string }
interface ClickElementRes { __seirtao: 'click-element-result'; nonce: string; ok: boolean; error?: string }

interface CkSetDataReq extends BaseReq {
  __seirtao: 'ckeditor-set-data';
  html: string;
  /** Nome da instância; se omitido, usa a primeira instância disponível. */
  instanceName?: string;
  /**
   * `append` (default): insere ao final do conteúdo atual, preservando
   * cabeçalho/template pré-existente. Usa `model.insertContent` (CK5) ou
   * `insertHtml` (CK4). `replace`: troca todo o conteúdo via `setData`.
   */
  mode?: 'append' | 'replace';
}
interface CkSetDataRes {
  __seirtao: 'ckeditor-set-data-result'; nonce: string; ok: boolean;
  instanceName?: string; availableInstances?: string[]; error?: string;
  /** Método efetivamente usado (ck5-insertContent, ck4-insertHtml, paste-sintetico, …). */
  method?: string;
}

interface QueryCkReq extends BaseReq { __seirtao: 'query-ckeditor' }
interface QueryCkRes {
  __seirtao: 'query-ckeditor-result'; nonce: string; ok: boolean;
  instances?: string[];
  /** Nomes de plugins CK5 detectados — diagnóstico. */
  plugins?: string[];
  error?: string;
}

/**
 * Lista popups abertos pela página via `window.open()` e ainda vivos.
 * O SEI abre o editor de documento em um popup separado — esses popups
 * ficam fora de `window.frames`, então precisamos rastreá-los aqui no MAIN
 * world (que é o único contexto capaz de interceptar `window.open`).
 */
interface ListPopupsReq extends BaseReq { __seirtao: 'list-popups' }
interface ListPopupsRes {
  __seirtao: 'list-popups-result'; nonce: string; ok: boolean;
  count: number;
  /** URLs (ou `?` se cross-origin) dos popups, na mesma ordem de índice. */
  urls: string[];
  error?: string;
}

/**
 * Encaminha um envelope seirtão para o popup no `popupIndex`. O popup
 * recebe `inner` com um novo nonce (definido pelo orquestrador) e responde
 * diretamente de volta — este handler NÃO espera a resposta, apenas
 * confirma o despacho. O orquestrador escuta a resposta na janela atual
 * via `MessageEvent.source`.
 */
interface ForwardToPopupReq extends BaseReq {
  __seirtao: 'forward-to-popup';
  popupIndex: number;
  inner: { __seirtao: string; nonce: string } & Record<string, unknown>;
}
interface ForwardToPopupRes {
  __seirtao: 'forward-to-popup-result'; nonce: string; ok: boolean;
  error?: string;
}

/**
 * Diagnóstico profundo do DOM da janela atual: quantidade de elementos
 * típicos do CKEditor, iframes, e presença de `window.CKEDITOR`. Usado
 * quando a probe normal não acha editor — útil para descobrir se o
 * CKEditor está dentro de um iframe da janela ou ainda não montou.
 */
interface DomProbeReq extends BaseReq { __seirtao: 'dom-probe' }
interface DomProbeRes {
  __seirtao: 'dom-probe-result'; nonce: string; ok: boolean;
  url?: string;
  bodyReady?: boolean;
  readyState?: string;
  counts?: {
    ckEditable: number;       // .ck-editor__editable
    ckContent: number;        // .ck-content[contenteditable]
    txaEditor: number;        // [id^="txaEditor"]
    infraEditor: number;      // div.infra-editor
    iframes: number;
    formsTargetPopup: number; // <form target="…"> que abrem janela
  };
  iframeSrcs?: string[];
  hasCkeditorGlobal?: boolean;
  /** Número de instâncias em `window.CKEDITOR.instances` (se existir). */
  ck4InstanceCount?: number;
  /** Nomes das chaves de `window.CKEDITOR.instances`. */
  ck4InstanceNames?: string[];
  /** Diagnóstico por `.ck-editor__editable` / `.ck-content` encontrado. */
  editableDiag?: Array<{
    tag: string;
    id: string;
    ce: string | null;
    ro: boolean;
    hasInst: boolean;
    hasWrapInst: boolean;
    aria: string | null;
    classes: string;
  }>;
  error?: string;
}

type AnyRes =
  | ExpandPastaRes | InvokeAnchorRes | FillFieldRes | ClickElementRes
  | CkSetDataRes | QueryCkRes | ListPopupsRes | ForwardToPopupRes
  | DomProbeRes;

// ─────────────────────────────────────────────────────────────────────────
// Utilidades: parsing de `href="javascript:..."` e invocação segura
// ─────────────────────────────────────────────────────────────────────────

/**
 * Parseia uma chamada simples do tipo `nome(arg1, arg2, ...)` onde os
 * argumentos são literais (string, número, boolean, null). Retorna `null`
 * se a expressão tem construções mais complexas — o chamador então recorre
 * a estratégias alternativas.
 */
function parseSimpleCall(code: string): { fn: string; args: unknown[] } | null {
  const cleaned = code
    .replace(/;\s*return\s+(?:true|false)\s*;?\s*$/i, '')
    .trim()
    .replace(/;+\s*$/, '');
  const m = cleaned.match(/^([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)\s*$/);
  if (!m) return null;
  const fn = m[1];
  const argsStr = m[2].trim();
  if (argsStr === '') return { fn, args: [] };

  const args: unknown[] = [];
  let rest = argsStr;
  while (rest.length > 0) {
    const am = rest.match(/^\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|(-?\d+(?:\.\d+)?)|(true|false|null))\s*(,|$)/);
    if (!am) return null;
    if (am[1] !== undefined) args.push(am[1].replace(/\\(.)/g, '$1'));
    else if (am[2] !== undefined) args.push(am[2].replace(/\\(.)/g, '$1'));
    else if (am[3] !== undefined) args.push(Number(am[3]));
    else if (am[4] === 'true') args.push(true);
    else if (am[4] === 'false') args.push(false);
    else if (am[4] === 'null') args.push(null);
    rest = rest.slice(am[0].length);
    if (am[5] === '') break;
  }
  return { fn, args };
}

function extractJsFromHref(href: string): string | null {
  const m = href.match(/^javascript:\s*([\s\S]+)$/i);
  return m ? m[1] : null;
}

function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

interface InvokeOutcome {
  ok: boolean;
  method?: 'fn-call' | 'click' | 'href-set';
  error?: string;
}

/**
 * Aciona um anchor usando a cadeia de estratégias: (1) parse + chamada
 * direta da função do `href="javascript:..."`; (2) parse + chamada do
 * `onclick`; (3) navegar `window.location` quando o `href` é URL real;
 * (4) clique sintético como último recurso (pode ser barrado por CSP).
 */
function invokeAnchor(a: HTMLAnchorElement): InvokeOutcome {
  const href = a.getAttribute('href') ?? '';
  const onclick = a.getAttribute('onclick') ?? '';

  const jsFromHref = extractJsFromHref(href);
  if (jsFromHref) {
    const parsed = parseSimpleCall(jsFromHref);
    if (parsed) {
      const fnRef = (window as unknown as Record<string, unknown>)[parsed.fn];
      if (typeof fnRef === 'function') {
        try {
          (fnRef as (...xs: unknown[]) => unknown).apply(window, parsed.args);
          return { ok: true, method: 'fn-call' };
        } catch (err) {
          console.warn(`${LOG} chamada direta de ${parsed.fn} falhou:`, err);
        }
      } else {
        console.warn(`${LOG} window.${parsed.fn} não é função (typeof=${typeof fnRef}).`);
      }
    }
  }

  if (onclick) {
    const parsed = parseSimpleCall(onclick);
    if (parsed) {
      const fnRef = (window as unknown as Record<string, unknown>)[parsed.fn];
      if (typeof fnRef === 'function') {
        try {
          (fnRef as (...xs: unknown[]) => unknown).apply(a, parsed.args);
          return { ok: true, method: 'fn-call' };
        } catch (err) {
          console.warn(`${LOG} onclick ${parsed.fn} falhou:`, err);
        }
      }
    }
  }

  if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
    try {
      window.location.href = new URL(href, document.baseURI).href;
      return { ok: true, method: 'href-set' };
    } catch (err) {
      console.warn(`${LOG} location.href falhou:`, err);
    }
  }

  try {
    a.click();
    return { ok: true, method: 'click' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Localização de elementos
// ─────────────────────────────────────────────────────────────────────────

function findPastaAnchor(pastaId: string): HTMLAnchorElement | null {
  const escaped = pastaId.replace(/"/g, '\\"');
  const direct = document.querySelector<HTMLAnchorElement>(
    `a[href*="id_pasta=${escaped}"], a[onclick*="id_pasta=${escaped}"], a[onclick*="'${escaped}'"], a[onclick*="\\"${escaped}\\""], a[href*="'${escaped}'"]`,
  );
  if (direct) return direct;
  const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'));
  for (const a of anchors) {
    const onclick = a.getAttribute('onclick') ?? '';
    const href = a.getAttribute('href') ?? '';
    if (onclick.includes(pastaId) || href.includes(pastaId)) return a;
  }
  return null;
}

function findAnchorByQuery(req: InvokeAnchorReq): HTMLAnchorElement | null {
  if (req.selector) {
    try {
      const el = document.querySelector<HTMLAnchorElement>(req.selector);
      if (el) return el;
    } catch (err) {
      console.warn(`${LOG} seletor inválido:`, req.selector, err);
    }
  }
  if (!req.textHint && !req.hrefContains && !req.imgSrcContains) return null;
  const needle = req.textHint ? normalizeText(req.textHint) : '';
  const imgSrcNeedle = req.imgSrcContains ? req.imgSrcContains.toLowerCase() : '';
  const hasContentHint = !!(needle || imgSrcNeedle);
  const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'));
  for (const a of anchors) {
    // hrefContains é filtro estrito (AND): quando informado, obriga casar.
    if (req.hrefContains) {
      const href = a.getAttribute('href') ?? '';
      if (!href.includes(req.hrefContains)) continue;
    }
    // textHint + imgSrcContains são pistas alternativas (OR entre si) —
    // cobrem tanto texto quanto ícone, já que o SEI tem botões icon-only.
    if (hasContentHint) {
      const img = a.querySelector('img');
      let matched = false;
      if (needle) {
        const t = normalizeText(a.textContent ?? '');
        const aTitle = normalizeText(a.getAttribute('title') ?? '');
        const imgAlt = normalizeText(img?.getAttribute('alt') ?? '');
        const imgTitle = normalizeText(img?.getAttribute('title') ?? '');
        if (t.includes(needle) || aTitle.includes(needle) || imgAlt.includes(needle) || imgTitle.includes(needle)) {
          matched = true;
        }
      }
      if (!matched && imgSrcNeedle) {
        const src = (img?.getAttribute('src') ?? '').toLowerCase();
        if (src.includes(imgSrcNeedle)) matched = true;
      }
      if (!matched) continue;
    }
    return a;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers de resposta
// ─────────────────────────────────────────────────────────────────────────

function reply(replyTarget: Window, res: AnyRes): void {
  try { replyTarget.postMessage(res, '*'); } catch { /* noop */ }
  try { window.postMessage(res, '*'); } catch { /* noop */ }
}

// ─────────────────────────────────────────────────────────────────────────
// Registry de popups
//
// O SEI abre a "janela" do editor de documento em um popup separado —
// às vezes via `window.open()`, às vezes via `<form target="...">` ou
// `<a target="...">` (que NÃO passam pelo `window.open` patcheado).
// Para cobrir todos os casos usamos DUAS estratégias complementares:
//
//  1. Interceptar `window.open()` — captura popups programáticos.
//  2. **Popup-hello**: a cada boot do bridge MAIN, se há `window.opener`
//     same-origin, o popup manda `{__seirtao:'popup-hello'}` para o opener;
//     o opener registra `MessageEvent.source` como popup. Isso funciona
//     independente de como o popup foi aberto — basta o SEI carregar o
//     sei-main-world.js lá (já garantido via `match_origin_as_fallback`
//     + `all_frames: true` no manifest).
// ─────────────────────────────────────────────────────────────────────────

const seirtaoPopups: Window[] = [];

function registerPopup(w: Window | null, label: string): void {
  if (!w) return;
  try {
    if (!seirtaoPopups.includes(w)) {
      seirtaoPopups.push(w);
      console.log(`${LOG} popup registrado via ${label} (total=${seirtaoPopups.length})`);
    }
  } catch { /* noop */ }
}

try {
  const origOpen = window.open.bind(window);
  (window as unknown as { open: typeof window.open }).open = function patchedOpen(
    ...args: Parameters<typeof window.open>
  ): Window | null {
    const w = origOpen(...args);
    registerPopup(w, `window.open(${String(args[0] ?? '')})`);
    return w;
  };
} catch (err) {
  console.warn(`${LOG} não foi possível interceptar window.open:`, err);
}

function livePopups(): Window[] {
  return seirtaoPopups.filter((w) => {
    try { return !!w && !w.closed; } catch { return false; }
  });
}

/**
 * Encontra o opener original: se este window foi aberto via `window.open`,
 * retorna `window.opener`. Se for um iframe dentro de um popup, sobe pela
 * cadeia `window.parent` até achar um ancestral que tenha `opener`.
 * Retorna `null` se este bridge está num iframe comum do próprio SEI.
 */
function findOriginOpener(): Window | null {
  try {
    const ownOpener = window.opener as Window | null;
    if (ownOpener && ownOpener !== window) return ownOpener;
  } catch { /* cross-origin */ }
  let w: Window = window;
  try {
    for (let i = 0; i < 8; i += 1) {
      if (!w.parent || w.parent === w) break;
      w = w.parent;
      try {
        const o = w.opener as Window | null;
        if (o && o !== w) return o;
      } catch { return null; /* cross-origin — para de subir */ }
    }
  } catch { /* ignore */ }
  return null;
}

// Popup-hello: anuncia-se ao opener assim que o bridge carregar. Todo
// bridge — inclusive os que vivem em iframes dentro de popups — anuncia-se
// ao opener ORIGINAL (o orquestrador). Isso faz com que um CKEditor
// hospedado em `popup > iframe` fique acessível diretamente por
// `forward-to-popup`, sem precisar de um nível extra de indireção.
try {
  const opener = findOriginOpener();
  if (opener) {
    const hello = {
      __seirtao: 'popup-hello',
      nonce: `hello-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      url: (() => { try { return location.href; } catch { return '?'; } })(),
    };
    try { opener.postMessage(hello, '*'); } catch { /* cross-origin */ }
    console.log(`${LOG} popup-hello enviado ao opener`, hello.url);
  }
} catch (err) {
  console.warn(`${LOG} popup-hello falhou:`, err);
}

// ─────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────

function handleExpandPasta(req: ExpandPastaReq, replyTarget: Window): void {
  const send = (ok: boolean, method?: InvokeOutcome['method'], error?: string): void => {
    reply(replyTarget, { __seirtao: 'expand-pasta-result', nonce: req.nonce, ok, method, error });
  };
  const tryOnce = (): boolean => {
    const a = findPastaAnchor(req.pastaId);
    if (!a) return false;
    const r = invokeAnchor(a);
    send(r.ok, r.method, r.error);
    return true;
  };
  if (tryOnce()) return;
  let tries = 3;
  const retry = (): void => {
    tries -= 1;
    if (tryOnce()) return;
    if (tries > 0) { window.setTimeout(retry, 250); return; }
    send(false, undefined, 'anchor não encontrado no documento');
  };
  window.setTimeout(retry, 250);
}

function handleInvokeAnchor(req: InvokeAnchorReq, replyTarget: Window): void {
  const a = findAnchorByQuery(req);
  if (!a) {
    reply(replyTarget, {
      __seirtao: 'invoke-anchor-result', nonce: req.nonce, ok: false,
      error: 'anchor não encontrado (seletor/textHint/hrefContains não casaram)',
    });
    return;
  }
  const outcome = invokeAnchor(a);
  reply(replyTarget, {
    __seirtao: 'invoke-anchor-result', nonce: req.nonce,
    ok: outcome.ok, method: outcome.method, error: outcome.error,
    matchedText: (a.textContent ?? '').trim().slice(0, 120),
    matchedHref: (a.getAttribute('href') ?? '').slice(0, 200),
  });
}

function handleFillField(req: FillFieldReq, replyTarget: Window): void {
  let el: Element | null = null;
  try { el = document.querySelector(req.selector); }
  catch (err) {
    reply(replyTarget, {
      __seirtao: 'fill-field-result', nonce: req.nonce, ok: false,
      error: `seletor inválido: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }
  if (!el) {
    reply(replyTarget, {
      __seirtao: 'fill-field-result', nonce: req.nonce, ok: false,
      error: `elemento não encontrado: ${req.selector}`,
    });
    return;
  }

  const tag = el.tagName.toLowerCase();
  const type = ((el as HTMLInputElement).type ?? '').toLowerCase();

  let kind = req.kind;
  if (!kind) {
    if (tag === 'select') kind = 'select';
    else if (tag === 'input' && type === 'radio') kind = 'radio';
    else if (tag === 'input' && type === 'checkbox') kind = 'checkbox';
    else kind = 'text';
  }

  try {
    if (kind === 'radio' || kind === 'checkbox') {
      const input = el as HTMLInputElement;
      input.checked = req.value === 'true' || req.value === '1' || req.value === input.value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (kind === 'select') {
      const sel = el as HTMLSelectElement;
      sel.value = req.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      const input = el as HTMLInputElement | HTMLTextAreaElement;
      input.value = req.value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    reply(replyTarget, { __seirtao: 'fill-field-result', nonce: req.nonce, ok: true, detectedKind: kind });
  } catch (err) {
    reply(replyTarget, {
      __seirtao: 'fill-field-result', nonce: req.nonce, ok: false, detectedKind: kind,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function handleClickElement(req: ClickElementReq, replyTarget: Window): void {
  let el: Element | null = null;
  try { el = document.querySelector(req.selector); }
  catch (err) {
    reply(replyTarget, {
      __seirtao: 'click-element-result', nonce: req.nonce, ok: false,
      error: `seletor inválido: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }
  if (!el) {
    reply(replyTarget, {
      __seirtao: 'click-element-result', nonce: req.nonce, ok: false,
      error: `elemento não encontrado: ${req.selector}`,
    });
    return;
  }
  try {
    (el as HTMLElement).click();
    reply(replyTarget, { __seirtao: 'click-element-result', nonce: req.nonce, ok: true });
  } catch (err) {
    reply(replyTarget, {
      __seirtao: 'click-element-result', nonce: req.nonce, ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Superfície mínima reconhecida — cobre CK4 clássico e CK5. Todos os campos
 * específicos de cada versão são opcionais para o mesmo tipo servir aos dois.
 */
interface CkEditorLike {
  /** CK4 e CK5 — substitui todo o conteúdo. */
  setData?(data: string): void;
  focus?(): void;

  // CK4
  /** CK4 — insere HTML na posição atual do cursor (preferido para append). */
  insertHtml?(html: string, mode?: string): void;

  // CK5
  /** CK5 — sinalizador de readiness (`'ready' | 'initializing' | ...`). */
  state?: string;
  /** CK5 — entrypoint para edições atômicas no modelo. */
  model?: {
    change(cb: (writer: unknown) => void): unknown;
    insertContent(content: unknown): unknown;
    document: { getRoot(name?: string): unknown };
  };
  /** CK5 — conversor HTML ↔ modelo. */
  data?: {
    toModel(viewFragment: unknown): unknown;
    processor: { toView(html: string): unknown };
  };
  /** CK5 — view com `scrollToTheSelection`. */
  editing?: { view: { scrollToTheSelection?(): void } };
  /** CK5 — registry de plugins (para diagnóstico). */
  plugins?: { names?(): string[] };
}

type InsertOutcome = { ok: boolean; method: string; error?: string };

interface CkEntry {
  name: string;
  inst: CkEditorLike;
  /** Elemento editável (CK5); usado como fallback para forçar foco. */
  el?: HTMLElement;
  /** true = editor em modo readonly (cabeçalho/rodapé do SEI). */
  readonly: boolean;
  /** true = `contenteditable="true"` e não readonly — candidato ideal. */
  editable: boolean;
  /** Insere `html` respeitando o schema do editor. Encapsula a escolha
   *  de caminho (insertContent / insertHtml / paste sintético). */
  insert: (html: string, mode: 'append' | 'replace') => InsertOutcome;
}

function isReadonlyEl(el: HTMLElement): boolean {
  if (el.getAttribute('contenteditable') === 'false') return true;
  if (el.classList.contains('ck-read-only')) return true;
  if (el.classList.contains('infra-editor__readonly')) return true;
  return false;
}

function isEditableEl(el: HTMLElement): boolean {
  return el.getAttribute('contenteditable') === 'true' && !isReadonlyEl(el);
}

/**
 * Dispara um `ClipboardEvent('paste')` sintético com `DataTransfer` contendo
 * `text/html`. É o caminho oficial para injetar conteúdo em editores ricos
 * modernos que mantêm modelo interno (CK5, ProseMirror): o handler nativo
 * lê o clipboard, parseia pelo schema e cria uma transaction válida — sem
 * ser revertido por MutationObserver.
 *
 * Mesma técnica usada no Badon (ckeditor-bridge.ts). `plain` é útil quando o
 * editor cai no handler de texto simples. O caret é posicionado no FINAL do
 * conteúdo antes do paste, para apendar em vez de substituir a seleção.
 */
function pasteSyntheticAtEnd(el: HTMLElement, html: string, plain?: string): boolean {
  try {
    try { el.focus(); } catch { /* ignore */ }
    const doc = el.ownerDocument;
    const win = doc.defaultView ?? window;
    const sel = win.getSelection?.() ?? doc.getSelection();
    if (sel) {
      const range = doc.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/html', html);
    if (plain) dataTransfer.setData('text/plain', plain);

    const pasteEvent = new ClipboardEvent('paste', {
      bubbles: true, cancelable: true, clipboardData: dataTransfer,
    });
    // Alguns builds do Chrome marcam `clipboardData` como read-only no
    // construtor e ignoram o valor passado. Reassinala via defineProperty.
    if (!pasteEvent.clipboardData) {
      try {
        Object.defineProperty(pasteEvent, 'clipboardData', {
          value: dataTransfer, writable: false,
        });
      } catch { /* ignore */ }
    }

    const delivered = el.dispatchEvent(pasteEvent);
    // `input` garante re-render em integrações que ouvem o evento em vez do
    // ciclo de transaction interno.
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch { /* ignore */ }
    return delivered;
  } catch {
    return false;
  }
}

/**
 * Constrói o método `insert` para uma instância CK4. Para `append`, prefere
 * `insertHtml` (que respeita o cursor e gera undo-step atômico). Para
 * `replace` ou se `insertHtml` não existir, cai em `setData`.
 */
function buildCk4Insert(inst: CkEditorLike, el?: HTMLElement): CkEntry['insert'] {
  return (html, mode) => {
    try {
      if (mode === 'append' && typeof inst.insertHtml === 'function') {
        inst.insertHtml(html, 'html');
        return { ok: true, method: 'ck4-insertHtml' };
      }
      if (typeof inst.setData === 'function') {
        inst.setData(html);
        return { ok: true, method: `ck4-setData(${mode})` };
      }
      // Último recurso: paste sintético no próprio corpo do iframe.
      if (el && pasteSyntheticAtEnd(el, html)) {
        return { ok: true, method: 'ck4-paste-sintetico' };
      }
      return { ok: false, method: 'ck4-no-api', error: 'instância CK4 sem setData/insertHtml' };
    } catch (err) {
      return { ok: false, method: 'ck4-throw', error: err instanceof Error ? err.message : String(err) };
    }
  };
}

/**
 * Constrói o método `insert` para uma instância CK5. Para `append`, usa o
 * caminho oficial: converte HTML → view fragment → model fragment e insere
 * via `model.insertContent` dentro de `model.change`, posicionando a seleção
 * no fim do root. Isso preserva o cabeçalho pré-preenchido pelo template do
 * SEI e cria um único undo-step.
 *
 * Fallbacks (em ordem): setData direto → paste sintético no elemento
 * editável. A escolha do último recurso existe porque builds customizados do
 * SEI podem expor o editor sem as APIs internas (model/data) — nesse caso, o
 * paste sintético ainda passa pelo pipeline de clipboard do CK5.
 */
function buildCk5Insert(inst: CkEditorLike, el?: HTMLElement): CkEntry['insert'] {
  return (html, mode) => {
    // 1) `setData` direto para `replace` (mantém semântica clássica).
    if (mode === 'replace' && typeof inst.setData === 'function') {
      try {
        inst.setData(html);
        return { ok: true, method: 'ck5-setData' };
      } catch (err) {
        // prossegue para paste sintético
        const pasted = el ? pasteSyntheticAtEnd(el, html) : false;
        if (pasted) return { ok: true, method: 'ck5-setData-failed→paste' };
        return { ok: false, method: 'ck5-setData-throw', error: err instanceof Error ? err.message : String(err) };
      }
    }

    // 2) Caminho canônico CK5: model.insertContent no fim do root.
    const model = inst.model;
    const data = inst.data;
    const hasModelPath =
      model && data &&
      typeof data.toModel === 'function' &&
      typeof data.processor?.toView === 'function';

    if (hasModelPath) {
      try {
        model.change((writer: unknown) => {
          const root = model.document.getRoot();
          // Tipagem do writer é opaca aqui (evitamos depender de tipos internos
          // do CK5). As operações abaixo são estáveis desde o CK5 v20+.
          const w = writer as {
            createPositionAt(root: unknown, placement: 'end' | 'start' | number): unknown;
            setSelection(pos: unknown): void;
          };
          if (root && typeof w.createPositionAt === 'function') {
            try { w.setSelection(w.createPositionAt(root, 'end')); } catch { /* ignore */ }
          }
          const viewFragment = data.processor.toView(html);
          const modelFragment = data.toModel(viewFragment);
          model.insertContent(modelFragment);
        });
        try { inst.editing?.view?.scrollToTheSelection?.(); } catch { /* ignore */ }
        return { ok: true, method: 'ck5-insertContent' };
      } catch (err) {
        // segue para fallbacks — não retorna ainda.
        console.warn(`${LOG} ck5-insertContent falhou, tentando fallbacks:`, err);
      }
    }

    // 3) Fallback: `setData` (sobrescreve tudo — perde cabeçalho).
    if (typeof inst.setData === 'function') {
      try {
        inst.setData(html);
        return { ok: true, method: hasModelPath ? 'ck5-setData-afterFail' : 'ck5-setData-noModel' };
      } catch (err) {
        console.warn(`${LOG} ck5-setData falhou:`, err);
      }
    }

    // 4) Último recurso: paste sintético no elemento editável.
    if (el && pasteSyntheticAtEnd(el, html)) {
      return { ok: true, method: 'ck5-paste-sintetico' };
    }

    return { ok: false, method: 'ck5-all-failed', error: 'nenhum caminho de inserção funcionou' };
  };
}

/**
 * Lista instâncias CKEditor 4 (API clássica `window.CKEDITOR.instances`).
 */
function getCk4Entries(): CkEntry[] {
  const ck = (window as unknown as { CKEDITOR?: { instances?: Record<string, CkEditorLike> } }).CKEDITOR;
  const map = ck?.instances;
  if (!map) return [];
  const out: CkEntry[] = [];
  for (const [k, v] of Object.entries(map)) {
    if (v && typeof v.setData === 'function') {
      out.push({
        name: `ck4:${k}`, inst: v, readonly: false, editable: true,
        insert: buildCk4Insert(v),
      });
    }
  }
  return out;
}

/**
 * Lista instâncias CKEditor 5. O CK5 não tem registry global padrão;
 * ele costuma anexar o editor ao elemento editável como `el.ckeditorInstance`.
 * Cobrimos também alguns nomes de propriedade alternativos e alguns globais
 * que integrações (como a do SEI/TRF5) podem expor.
 */
function getCk5Entries(): CkEntry[] {
  const out: CkEntry[] = [];
  // Dedup é por ELEMENTO editável, não por instância. Builds multi-root do
  // CK5 (ex.: `infraEditor` do SEI, que tem Cabeçalho, Título, Corpo, Data,
  // Rodapé) compartilham uma única instância entre N elementos — precisamos
  // de uma entrada por elemento para distinguir qual é o editável.
  const seenEl = new Set<HTMLElement>();
  // Rastreia quais elementos pertencem a cada instância — se >1, é multi-root.
  const instanceEntries = new Map<unknown, CkEntry[]>();

  const tryAccept = (el: HTMLElement, candidate: unknown, tag: string): boolean => {
    if (!candidate || typeof candidate !== 'object') return false;
    const asCk = candidate as CkEditorLike;
    // Aceita se tiver `setData` OU o caminho canônico `model + data` (alguns
    // builds customizados omitem `setData` mas mantêm o modelo).
    const hasModel = !!(asCk.model && asCk.data);
    if (typeof asCk.setData !== 'function' && !hasModel) return false;
    if (seenEl.has(el)) return false;
    seenEl.add(el);
    const readonly = isReadonlyEl(el);
    const entry: CkEntry = {
      name: `ck5:${tag}:${el.id || `#${out.length}`}`,
      inst: asCk, el, readonly, editable: !readonly,
      insert: buildCk5Insert(asCk, el),
    };
    out.push(entry);
    const list = instanceEntries.get(asCk) ?? [];
    list.push(entry);
    instanceEntries.set(asCk, list);
    return true;
  };

  const nodes = document.querySelectorAll<HTMLElement>(
    '.ck-editor__editable, .ck-content[contenteditable], [id^="txaEditor"], div.infra-editor',
  );
  nodes.forEach((el) => {
    const holder = el as unknown as Record<string, unknown>;
    const wrapper = el.closest('.ck-editor, .ck.ck-reset') as HTMLElement | null;
    const wrapperHolder = wrapper as unknown as Record<string, unknown> | null;
    // Ordem de tentativa: propriedade canônica do CK5 primeiro (`ckeditorInstance`),
    // depois variantes usadas por builds customizados.
    tryAccept(el, holder['ckeditorInstance'], 'inst');
    tryAccept(el, holder['_ckeditor5'], '_ck5');
    tryAccept(el, holder['_editor'], '_editor');
    tryAccept(el, holder['editor'], 'editor');
    if (wrapperHolder) {
      tryAccept(el, wrapperHolder['ckeditorInstance'], 'wrap-inst');
      tryAccept(el, wrapperHolder['_editor'], 'wrap-_editor');
    }
  });

  // Alguns builds expõem um registry global (ex.: `window.editors`, `window.infraEditor`).
  const globals = window as unknown as Record<string, unknown>;
  const globalKeys = ['editors', 'infraEditor', 'infraEditores', 'ck5Instances', 'ckeditorInstances'];
  for (const k of globalKeys) {
    const v = globals[k];
    if (!v || typeof v !== 'object') continue;
    for (const [name, inst] of Object.entries(v as Record<string, unknown>)) {
      const ck = inst as CkEditorLike;
      const hasApi = !!ck && (typeof ck.setData === 'function' || (ck.model && ck.data));
      if (hasApi && !instanceEntries.has(ck)) {
        // Globais não têm elemento associado — assumimos editável.
        const entry: CkEntry = {
          name: `ck5-g:${k}.${name}`, inst: ck,
          readonly: false, editable: true,
          insert: buildCk5Insert(ck),
        };
        out.push(entry);
        instanceEntries.set(ck, [entry]);
      }
    }
  }

  // Se uma mesma instância é usada por múltiplos elementos, é um editor
  // multi-root (ex.: `infraEditor` do SEI). Para esses, `model.insertContent`
  // insere na root da seleção — que pode não ser a root do `el` desejado.
  // Troca o `insert` por um que vai direto para paste sintético no elemento
  // (o pipeline de clipboard do CK5 é específico por editable).
  for (const entries of instanceEntries.values()) {
    if (entries.length <= 1) continue;
    for (const e of entries) {
      if (!e.el) continue;
      e.insert = buildCk5MultiRootInsert(e.inst, e.el);
    }
  }

  return out;
}

/**
 * Variante de `insert` para CK5 multi-root: vai direto ao paste sintético
 * no elemento editável específico, evitando `insertContent` que insere na
 * root da seleção atual (possivelmente outra root). O pipeline de clipboard
 * do CK5 é acionado pelo DOM element, então a inserção respeita a root.
 */
function buildCk5MultiRootInsert(inst: CkEditorLike, el: HTMLElement): CkEntry['insert'] {
  return (html, mode) => {
    try { el.focus(); } catch { /* ignore */ }
    try { inst.focus?.(); } catch { /* ignore */ }
    if (pasteSyntheticAtEnd(el, html)) {
      return { ok: true, method: `ck5-multiroot-paste(${mode})` };
    }
    return {
      ok: false, method: 'ck5-multiroot-paste-failed',
      error: 'ClipboardEvent não foi entregue ao editable',
    };
  };
}

/**
 * Fallback de último recurso quando nenhuma instância nativa foi encontrada:
 * cada `.ck-editor__editable` recebe uma entrada sintética que injeta via
 * `ClipboardEvent('paste')`. O CK5 trata o paste pelo pipeline oficial de
 * clipboard — parseia o HTML contra o schema, atualiza o modelo, e não sofre
 * reversão por MutationObserver (ao contrário de `innerHTML`/`execCommand`).
 *
 * Se o paste sintético não for aceito, o usuário ainda pode usar Ctrl+V
 * manualmente — a minuta fica na clipboard original? Não: o DataTransfer do
 * evento é independente. Por isso também dispara `input`/`change` como sinal
 * para integrações que ouvem esses eventos em vez do ciclo de transactions.
 */
function getDomFallbackEntries(existingCount: number): CkEntry[] {
  if (existingCount > 0) return [];
  const out: CkEntry[] = [];
  const nodes = document.querySelectorAll<HTMLElement>(
    '.ck-editor__editable[contenteditable="true"], .ck-content[contenteditable="true"]',
  );
  nodes.forEach((el) => {
    const insert: CkEntry['insert'] = (html, mode) => {
      // `mode === 'replace'`: limpa o conteúdo atual antes do paste.
      if (mode === 'replace') {
        try { el.innerHTML = ''; } catch { /* ignore */ }
      }
      const ok = pasteSyntheticAtEnd(el, html);
      try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch { /* ignore */ }
      return ok
        ? { ok: true, method: `dom-paste-sintetico(${mode})` }
        : { ok: false, method: 'dom-paste-failed', error: 'ClipboardEvent não foi entregue' };
    };
    out.push({
      name: `dom:${el.id || `#${out.length}`}`,
      // inst sintético mantém compatibilidade com código que lê `focus`.
      inst: { focus: () => { try { el.focus(); } catch { /* ignore */ } } },
      el,
      readonly: false, // o seletor já filtrou para contenteditable="true"
      editable: true,
      insert,
    });
  });
  return out;
}

/**
 * Agrega todas as instâncias do frame atual, já ordenadas: editáveis primeiro
 * (corpo do documento) e readonly (cabeçalho/rodapé) depois. O fallback DOM
 * só é adicionado se nenhuma instância nativa editável estiver disponível.
 */
function getAllCkEntries(): CkEntry[] {
  const native = [...getCk4Entries(), ...getCk5Entries()];
  const hasNativeEditable = native.some((e) => e.editable);
  const fallback = hasNativeEditable ? [] : getDomFallbackEntries(native.length);
  const all = [...native, ...fallback];
  all.sort((a, b) => (a.editable === b.editable ? 0 : a.editable ? -1 : 1));
  return all;
}

/** Coleta diagnóstico de todos os `.ck-editor__editable` do frame — usado nas respostas de erro. */
function collectEditableDiag(): Array<{ id: string; ce: string | null; ro: boolean; hasInst: boolean; aria: string | null }> {
  const els = document.querySelectorAll<HTMLElement>('.ck-editor__editable, .ck-content');
  return Array.from(els).map((el) => ({
    id: el.id,
    ce: el.getAttribute('contenteditable'),
    ro: isReadonlyEl(el),
    hasInst: !!(el as unknown as { ckeditorInstance?: unknown }).ckeditorInstance,
    aria: el.getAttribute('aria-label'),
  }));
}

/** Coleta nomes de plugins de todas as instâncias CK5 — diagnóstico. */
function collectCk5Plugins(entries: CkEntry[]): string[] {
  const names = new Set<string>();
  for (const e of entries) {
    const plugins = e.inst.plugins;
    if (!plugins || typeof plugins.names !== 'function') continue;
    try {
      for (const n of plugins.names() ?? []) names.add(n);
    } catch { /* ignore */ }
  }
  return Array.from(names).sort();
}

function handleQueryCkEditor(req: QueryCkReq, replyTarget: Window): void {
  const entries = getAllCkEntries();
  const editables = entries.filter((e) => e.editable);
  const plugins = collectCk5Plugins(entries);
  if (editables.length === 0) {
    const diag = collectEditableDiag();
    reply(replyTarget, {
      __seirtao: 'query-ckeditor-result', nonce: req.nonce, ok: false,
      error: entries.length > 0
        ? `${entries.length} instância(s) CK, mas todas readonly (corpo do editor ainda não montou?)`
        : `nenhuma instância CKEditor — ${diag.length} .ck-editor__editable no DOM`,
      instances: entries.map((e) => e.name),
      plugins,
    });
    return;
  }
  reply(replyTarget, {
    __seirtao: 'query-ckeditor-result', nonce: req.nonce, ok: true,
    instances: editables.map((e) => e.name),
    plugins,
  });
}

function handleCkSetData(req: CkSetDataReq, replyTarget: Window): void {
  const entries = getAllCkEntries();
  const names = entries.map((e) => e.name);
  if (entries.length === 0) {
    reply(replyTarget, {
      __seirtao: 'ckeditor-set-data-result', nonce: req.nonce, ok: false,
      error: 'nenhuma instância CKEditor encontrada neste frame',
    });
    return;
  }
  // Sempre prefere editáveis — se `instanceName` foi dado mas é readonly, cai de volta no editável.
  const editables = entries.filter((e) => e.editable);
  let target = req.instanceName ? entries.find((e) => e.name === req.instanceName) : undefined;
  if (!target || !target.editable) target = editables[0];
  if (!target) {
    reply(replyTarget, {
      __seirtao: 'ckeditor-set-data-result', nonce: req.nonce, ok: false,
      availableInstances: names,
      error: 'todas as instâncias CK estão readonly (ex.: documento já assinado)',
    });
    return;
  }

  // Default é `append` — preserva cabeçalho/template já pré-preenchido pelo SEI.
  const mode = req.mode ?? 'append';
  const outcome = target.insert(req.html, mode);
  try { target.inst.focus?.(); } catch { /* ignore */ }
  try { target.el?.focus(); } catch { /* ignore */ }
  console.log(`${LOG} ckeditor-set-data: ${target.name} → ${outcome.method} (ok=${outcome.ok})`);

  reply(replyTarget, {
    __seirtao: 'ckeditor-set-data-result', nonce: req.nonce,
    ok: outcome.ok,
    instanceName: target.name,
    availableInstances: names,
    method: outcome.method,
    error: outcome.error,
  });
}

function handleDomProbe(req: DomProbeReq, replyTarget: Window): void {
  try {
    const forms = Array.from(document.querySelectorAll<HTMLFormElement>('form[target]'));
    const formsTargetPopup = forms.filter((f) => {
      const t = (f.getAttribute('target') ?? '').trim();
      return !!t && t !== '_self' && t !== '_top' && t !== '_parent';
    }).length;
    const iframes = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'));
    const iframeSrcs = iframes.map((f) => {
      const s = f.getAttribute('src') ?? '';
      return (s || f.name || '(anon)').slice(0, 100);
    });
    const ckGlobal = (window as unknown as {
      CKEDITOR?: { instances?: Record<string, unknown> };
    }).CKEDITOR;
    const hasCkeditorGlobal = !!ckGlobal;
    const ck4InstanceNames = ckGlobal?.instances ? Object.keys(ckGlobal.instances) : [];
    const ck4InstanceCount = ck4InstanceNames.length;

    // Diagnóstico por elemento editável — identifica qual é o corpo real vs.
    // cabeçalho readonly, e se o engine CK5 associou uma instância a cada um.
    const editableDiag: NonNullable<DomProbeRes['editableDiag']> = [];
    const editableNodes = document.querySelectorAll<HTMLElement>(
      '.ck-editor__editable, .ck-content[contenteditable], div.infra-editor',
    );
    editableNodes.forEach((el) => {
      const wrapper = el.closest('.ck-editor, .ck.ck-reset') as HTMLElement | null;
      editableDiag.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        ce: el.getAttribute('contenteditable'),
        ro: el.classList.contains('ck-read-only')
          || el.classList.contains('infra-editor__readonly')
          || el.getAttribute('contenteditable') === 'false',
        hasInst: !!(el as unknown as { ckeditorInstance?: unknown }).ckeditorInstance,
        hasWrapInst: !!(wrapper as unknown as { ckeditorInstance?: unknown } | null)?.ckeditorInstance,
        aria: el.getAttribute('aria-label'),
        classes: (el.className || '').slice(0, 120),
      });
    });

    reply(replyTarget, {
      __seirtao: 'dom-probe-result', nonce: req.nonce, ok: true,
      url: (() => { try { return location.href; } catch { return '?'; } })(),
      bodyReady: !!document.body,
      readyState: document.readyState,
      counts: {
        ckEditable: document.querySelectorAll('.ck-editor__editable').length,
        ckContent: document.querySelectorAll('.ck-content[contenteditable]').length,
        txaEditor: document.querySelectorAll('[id^="txaEditor"]').length,
        infraEditor: document.querySelectorAll('div.infra-editor').length,
        iframes: iframes.length,
        formsTargetPopup,
      },
      iframeSrcs,
      hasCkeditorGlobal,
      ck4InstanceCount,
      ck4InstanceNames,
      editableDiag,
    });
  } catch (err) {
    reply(replyTarget, {
      __seirtao: 'dom-probe-result', nonce: req.nonce, ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function handleListPopups(req: ListPopupsReq, replyTarget: Window): void {
  const popups = livePopups();
  const urls = popups.map((w) => {
    try { return w.location?.href ?? '?'; } catch { return '?'; }
  });
  reply(replyTarget, {
    __seirtao: 'list-popups-result', nonce: req.nonce, ok: true,
    count: popups.length,
    urls,
  });
}

/**
 * Encaminha `req.inner` ao popup indicado por `popupIndex`.
 *
 * Roteamento da resposta: o popup responde com `MessageEvent.source ===
 * esta janela` (a janela que repassou o envelope), então a resposta chega
 * aqui, não no orquestrador. Para levar a resposta até o orquestrador,
 * instalamos um listener one-shot que casa pelo `inner.nonce` e repassa
 * para `replyTarget` (a janela do orquestrador). Isso deixa o
 * `bridgeCallPopup` no orquestrador indistinguível de um `bridgeCall`
 * normal — ele apenas espera um `*-result` com o nonce esperado.
 */
function handleForwardToPopup(req: ForwardToPopupReq, replyTarget: Window): void {
  const popups = livePopups();
  const target = popups[req.popupIndex];
  if (!target) {
    reply(replyTarget, {
      __seirtao: 'forward-to-popup-result', nonce: req.nonce, ok: false,
      error: `popup #${req.popupIndex} não existe (total=${popups.length})`,
    });
    return;
  }

  const innerNonce = req.inner.nonce;
  const relay = (e: MessageEvent): void => {
    const data = e.data as { __seirtao?: string; nonce?: string } | null;
    if (!data || typeof data !== 'object') return;
    if (!data.__seirtao || data.nonce !== innerNonce) return;
    // Evita loop: ignora o próprio eco do relay (postMessage local).
    if (e.source === replyTarget) return;
    try { replyTarget.postMessage(data, '*'); } catch { /* noop */ }
  };
  const POPUP_RELAY_TTL_MS = 30_000;
  window.addEventListener('message', relay);
  setTimeout(() => {
    window.removeEventListener('message', relay);
  }, POPUP_RELAY_TTL_MS);

  try {
    target.postMessage(req.inner, '*');
    reply(replyTarget, {
      __seirtao: 'forward-to-popup-result', nonce: req.nonce, ok: true,
    });
  } catch (err) {
    window.removeEventListener('message', relay);
    reply(replyTarget, {
      __seirtao: 'forward-to-popup-result', nonce: req.nonce, ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Dispatcher
// ─────────────────────────────────────────────────────────────────────────

window.addEventListener('message', (e: MessageEvent) => {
  const data = e.data as unknown;
  if (!data || typeof data !== 'object') return;
  const d = data as { __seirtao?: string; nonce?: string };
  if (!d.__seirtao || !d.nonce) return;
  const src = (e.source as Window) ?? window;

  switch (d.__seirtao) {
    case 'expand-pasta':
      handleExpandPasta(d as unknown as ExpandPastaReq, src);
      break;
    case 'invoke-anchor':
      handleInvokeAnchor(d as unknown as InvokeAnchorReq, src);
      break;
    case 'fill-field':
      handleFillField(d as unknown as FillFieldReq, src);
      break;
    case 'click-element':
      handleClickElement(d as unknown as ClickElementReq, src);
      break;
    case 'ckeditor-set-data':
      handleCkSetData(d as unknown as CkSetDataReq, src);
      break;
    case 'query-ckeditor':
      handleQueryCkEditor(d as unknown as QueryCkReq, src);
      break;
    case 'list-popups':
      handleListPopups(d as unknown as ListPopupsReq, src);
      break;
    case 'forward-to-popup':
      handleForwardToPopup(d as unknown as ForwardToPopupReq, src);
      break;
    case 'popup-hello':
      // Popup anunciando-se ao opener: registramos a ref (MessageEvent.source).
      registerPopup(src, 'popup-hello');
      break;
    case 'dom-probe':
      handleDomProbe(d as unknown as DomProbeReq, src);
      break;
    default:
      // Não é do seirtao — ignora. (Resultados `*-result` caem aqui também.)
      break;
  }
});

// Sinaliza presença para facilitar debug no isolated world.
try {
  (window as unknown as { __seirtaoMainBridge?: true }).__seirtaoMainBridge = true;
} catch { /* noop */ }

console.log(`${LOG} bridge MAIN world pronto em ${window.location.href}`);
