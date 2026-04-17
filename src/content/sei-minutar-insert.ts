/**
 * Orquestrador da Fase C: automação das 4 etapas do SEI para inserir a
 * minuta como rascunho dentro do processo.
 *
 * Sequência modelada como state machine:
 *
 *   IDLE
 *     → CLICKING_INCLUIR       (aciona "Incluir Documento" no ifrArvore)
 *     → AWAIT_TIPO              (espera ifrConteudoVisualizacao navegar
 *                                para acao=documento_escolher_tipo)
 *     → SELECTING_TIPO          (clica no link do tipo escolhido)
 *     → AWAIT_CADASTRAR         (espera navegar para acao=documento_cadastrar)
 *     → FILLING_CADASTRAR       (preenche descrição + nível + hipótese)
 *     → SUBMITTING              (submete o form "Salvar")
 *     → AWAIT_EDITOR            (espera o editor CKEditor abrir — v4 ou v5)
 *     → INJECTING               (injeta o HTML convertido via editor.setData)
 *     → DONE                    (minuta no editor, pronto para revisão humana)
 *
 * Qualquer falha leva a ERROR. Cada transição tem timeout próprio e o
 * erro carrega uma instrução prática ao usuário (ex.: "clique manualmente
 * em Incluir Documento") para preservar a autonomia mesmo quando a
 * automação falhar.
 *
 * A comunicação com a página é feita pelo bridge MAIN world
 * (`sei-main-world.ts`): este módulo roda no isolated world e só fala
 * com a página via `postMessage` + nonce.
 *
 * **Compliance (Fase D):** este orquestrador NUNCA clica em "Salvar" do
 * editor CKEditor nem em "Assinar" — ele para em INJECTING. A revisão e
 * assinatura ficam 100% na mão do servidor/usuário.
 */

import type { InsertConfirmResult, NivelAcessoTipo } from './ui/seirtao-panel';
import {
  appendAuditEntry,
  isAutoInsertEnabled,
  sha256HexPrefix,
  type AuditEntry,
} from './sei-insert-audit';

const LOG = '[SEIrtão/insert]';

// ─────────────────────────────────────────────────────────────────────────
// Estados e eventos públicos
// ─────────────────────────────────────────────────────────────────────────

export type InsertState =
  | 'idle'
  | 'clicking-incluir'
  | 'await-tipo'
  | 'selecting-tipo'
  | 'await-cadastrar'
  | 'filling-cadastrar'
  | 'submitting'
  | 'await-editor'
  | 'injecting'
  | 'done'
  | 'error';

export interface InsertStateDetail {
  /** Mensagem curta para UI (ex.: "Abrindo formulário de cadastro…"). */
  message: string;
  /** Dados técnicos opcionais (ex.: URL observada, nome da instância CKEditor). */
  info?: Record<string, unknown>;
}

export interface InsertErrorDetail extends InsertStateDetail {
  /** Instrução prática ao usuário sobre como concluir manualmente. */
  userHint: string;
  /** Estado em que o erro ocorreu. */
  failedAt: InsertState;
}

export interface InsertCallbacks {
  onState?: (state: InsertState, detail: InsertStateDetail) => void;
  onError?: (detail: InsertErrorDetail) => void;
  onDone?: (detail: InsertStateDetail) => void;
}

// ─────────────────────────────────────────────────────────────────────────
// Timeouts (ms) — valores conservadores; SEI pode ser lento em horário de pico
// ─────────────────────────────────────────────────────────────────────────

const TIMEOUTS = {
  clickIncluir: 8000,
  awaitTipo: 15000,
  selectTipo: 8000,
  awaitCadastrar: 15000,
  fillCadastrar: 8000,
  submit: 10000,
  awaitEditor: 20000,
  inject: 8000,
} as const;

// ─────────────────────────────────────────────────────────────────────────
// Localização dos iframes-chave do SEI
// ─────────────────────────────────────────────────────────────────────────

interface SeiFrames {
  arvore: HTMLIFrameElement;
  visualizacao: HTMLIFrameElement;
}

/**
 * Coleta TODOS os iframes same-origin alcançáveis a partir do top — inclui
 * iframes aninhados (ex.: `ifrArvore` pode conter sub-iframes). A lista é
 * usada para localizar o botão "Incluir Documento" onde quer que ele viva.
 */
function collectSameOriginIframes(): HTMLIFrameElement[] {
  const out: HTMLIFrameElement[] = [];
  const visit = (root: Document): void => {
    const local = Array.from(root.querySelectorAll<HTMLIFrameElement>('iframe'));
    for (const iframe of local) {
      out.push(iframe);
      try {
        const sub = iframe.contentDocument;
        if (sub) visit(sub);
      } catch { /* cross-origin — ignora */ }
    }
  };
  visit(document);
  return out;
}

interface IncluirAnchorMatch {
  iframe: HTMLIFrameElement;
  win: Window;
  anchor: HTMLAnchorElement;
  href: string;
  /** Selector CSS absoluto dentro do documento do iframe. */
  selector: string;
}

/**
 * Localiza o anchor "Incluir Documento" em qualquer iframe same-origin.
 * Casamento robusto (mesma heurística validada pelo sei-document-types.ts):
 * prioriza href com `acao=documento_escolher_tipo`; fallbacks testam texto,
 * title, alt/title do `<img>` interno e src do ícone (`documento_incluir`).
 */
function findIncluirDocumentoAnchor(): IncluirAnchorMatch | null {
  const needle = /incluir\s+documento/i;
  const iframes = collectSameOriginIframes();
  for (const iframe of iframes) {
    let doc: Document | null = null;
    let win: Window | null = null;
    try { doc = iframe.contentDocument; win = iframe.contentWindow; }
    catch { continue; }
    if (!doc || !win) continue;

    const anchors = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'));
    for (const a of anchors) {
      const href = a.getAttribute('href') ?? '';
      if (!href) continue;

      const hrefMatches = href.includes('acao=documento_escolher_tipo');
      const title = a.getAttribute('title') ?? '';
      const text = a.textContent ?? '';
      const img = a.querySelector('img');
      const imgAlt = img?.getAttribute('alt') ?? '';
      const imgTitle = img?.getAttribute('title') ?? '';
      const imgSrc = (img?.getAttribute('src') ?? '').toLowerCase();

      const textMatches =
        needle.test(title) || needle.test(text) ||
        needle.test(imgAlt) || needle.test(imgTitle) ||
        imgSrc.includes('documento_incluir');

      if (hrefMatches || textMatches) {
        return {
          iframe, win, anchor: a, href,
          selector: `a[href="${cssEscape(href)}"]`,
        };
      }
    }
  }
  return null;
}

function findSeiFrames(): SeiFrames | null {
  const arvore = document.querySelector<HTMLIFrameElement>(
    'iframe[name="ifrArvore"], iframe#ifrArvore',
  );
  const visualizacao = document.querySelector<HTMLIFrameElement>(
    'iframe[name="ifrConteudoVisualizacao"], iframe#ifrConteudoVisualizacao',
  );
  if (!arvore || !visualizacao) return null;
  return { arvore, visualizacao };
}

function safeHref(iframe: HTMLIFrameElement): string {
  try { return iframe.contentDocument?.location.href ?? iframe.src ?? ''; }
  catch { return iframe.src ?? ''; }
}

// ─────────────────────────────────────────────────────────────────────────
// Bridge request helper genérico
// ─────────────────────────────────────────────────────────────────────────

interface BridgeResponse {
  __seirtao: string;
  nonce: string;
  ok: boolean;
  error?: string;
  [k: string]: unknown;
}

/**
 * Envia uma requisição ao bridge MAIN world em `targetWin` e aguarda
 * resposta com o mesmo nonce. O `expectedKind` casa o sufixo `-result`
 * do `__seirtao` (ex.: `invoke-anchor` → `invoke-anchor-result`).
 */
function bridgeCall<T extends BridgeResponse>(
  targetWin: Window,
  payload: Record<string, unknown> & { __seirtao: string },
  expectedKind: string,
  timeoutMs: number,
): Promise<T> {
  return new Promise((resolve) => {
    const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    let settled = false;

    const onMessage = (e: MessageEvent): void => {
      const data = e.data as BridgeResponse | null;
      if (!data || data.__seirtao !== expectedKind || data.nonce !== nonce) return;
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
      resolve(data as T);
    };

    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      resolve({
        __seirtao: expectedKind, nonce, ok: false,
        error: `timeout (bridge não respondeu em ${timeoutMs}ms)`,
      } as T);
    }, timeoutMs);

    window.addEventListener('message', onMessage);
    try {
      targetWin.postMessage({ ...payload, nonce }, '*');
    } catch (err) {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve({
          __seirtao: expectedKind, nonce, ok: false,
          error: err instanceof Error ? err.message : String(err),
        } as T);
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Aguarda uma condição num iframe (URL muda, elemento aparece, etc.)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Faz polling num iframe até que `predicate` retorne `true` (ou timeout).
 * Preferimos polling a `load` event porque o SEI às vezes navega sub-frames
 * sem disparar `load` no wrapper externo.
 */
async function waitUntil(
  iframe: HTMLIFrameElement,
  predicate: (doc: Document, url: string) => boolean,
  timeoutMs: number,
  intervalMs = 200,
): Promise<{ ok: boolean; doc?: Document; url?: string }> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    let doc: Document | null = null;
    try { doc = iframe.contentDocument; } catch { /* cross-origin */ }
    const url = safeHref(iframe);
    if (doc && doc.readyState !== 'loading') {
      try {
        if (predicate(doc, url)) return { ok: true, doc, url };
      } catch { /* predicate lançou — tenta de novo */ }
    }
    await sleep(intervalMs);
  }
  return { ok: false, url: safeHref(iframe) };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────────────────
// Conversor texto → HTML para CKEditor (Fase C.4 — embutido aqui)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Converte a minuta em texto puro (formato do FIRAC/prompts) para HTML
 * adequado ao CKEditor 4 do SEI. Regras:
 *  - linhas em CAIXA ALTA (≥ 3 palavras ou curtas isoladas) viram `<p><strong>…</strong></p>`
 *  - linhas iniciadas com `- ` viram `<ul><li>` agrupados
 *  - linhas iniciadas com `> ` viram `<blockquote>` agrupados
 *  - parágrafos normais viram `<p>` com `<br>` para quebras simples
 *  - escapa `<`, `>`, `&` para evitar HTML injection vindo do modelo
 */
export function minutaTextToHtml(text: string): string {
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  const isCapsHeader = (line: string): boolean => {
    const t = line.trim();
    if (t.length < 3) return false;
    if (!/[A-ZÁÉÍÓÚÇÃÕÂÊÔ]/.test(t)) return false;
    const letters = t.replace(/[^A-Za-zÁÉÍÓÚÇÃÕÂÊÔáéíóúçãõâêô]/g, '');
    if (letters.length < 3) return false;
    return letters === letters.toUpperCase();
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') { i += 1; continue; }

    if (trimmed.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('- ')) {
        items.push(`<li>${esc(lines[i].trim().slice(2))}</li>`);
        i += 1;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (trimmed.startsWith('> ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        items.push(esc(lines[i].trim().slice(2)));
        i += 1;
      }
      out.push(`<blockquote><p>${items.join('<br>')}</p></blockquote>`);
      continue;
    }

    if (isCapsHeader(trimmed)) {
      out.push(`<p><strong>${esc(trimmed)}</strong></p>`);
      i += 1;
      continue;
    }

    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i];
      const curTrim = cur.trim();
      if (curTrim === '') break;
      if (curTrim.startsWith('- ') || curTrim.startsWith('> ')) break;
      if (isCapsHeader(curTrim)) break;
      paraLines.push(esc(cur));
      i += 1;
    }
    if (paraLines.length > 0) out.push(`<p>${paraLines.join('<br>')}</p>`);
  }

  return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Mapeamento nível de acesso → valores do SEI
// ─────────────────────────────────────────────────────────────────────────

/**
 * Labels visíveis do radio de nível de acesso no SEI. Os `value=` variam
 * entre versões (em algumas 0=Sigiloso, em outras 0=Público) — por isso
 * casamos pelo TEXTO do label, não pelo valor numérico.
 */
const NIVEL_LABELS: Record<NivelAcessoTipo, RegExp> = {
  sigiloso: /sigiloso/i,
  restrito: /restrito/i,
  publico: /p[úu]blico/i,
};

interface NivelRadioMatch {
  name: string;
  value: string;
}

/**
 * Localiza o radio de nível de acesso que corresponde ao nível desejado.
 * O SEI 5.0.4 usa `name="rdoNivelAcesso"` (versões antigas usavam
 * `optNivelAcesso`); casamos por label for=id (pode haver múltiplos —
 * um visual vazio + um com texto), `<label>` wrapper, `title`/`aria-label`
 * e texto adjacente. Retorna {name, value} reais pra montar seletor.
 */
function findNivelRadioMatch(doc: Document, nivel: NivelAcessoTipo): NivelRadioMatch | null {
  const pattern = NIVEL_LABELS[nivel];
  const radios = Array.from(doc.querySelectorAll<HTMLInputElement>(
    'input[type="radio"][name="rdoNivelAcesso"], input[type="radio"][name="optNivelAcesso"], input[type="radio"][name*="ivelAcesso" i]',
  ));
  for (const r of radios) {
    const hit = (text: string): boolean => !!text && pattern.test(text);
    // Caminho 1: TODOS os <label for="idDoRadio"> — o SEI tem um label
    // visual vazio (.infraRadioLabel) e um de texto (.infraLabelRadio)
    // apontando para o mesmo id; precisamos checar os dois.
    const id = r.id;
    if (id) {
      const labs = doc.querySelectorAll<HTMLLabelElement>(`label[for="${cssEscape(id)}"]`);
      for (const lab of Array.from(labs)) {
        if (hit(lab.textContent ?? '')) return { name: r.name, value: r.value };
      }
    }
    // Caminho 2: <label><input> Texto</label>
    const parentLab = r.closest('label');
    if (parentLab && hit(parentLab.textContent ?? '')) return { name: r.name, value: r.value };
    // Caminho 3: atributo title/aria-label no próprio input
    const meta = `${r.getAttribute('title') ?? ''} ${r.getAttribute('aria-label') ?? ''}`;
    if (hit(meta)) return { name: r.name, value: r.value };
    // Caminho 4: texto em container imediato (ex.: <div><input><span>Texto</span></div>)
    const container = r.parentElement?.parentElement ?? r.parentElement;
    if (container && hit(container.textContent ?? '')) return { name: r.name, value: r.value };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Orquestrador principal
// ─────────────────────────────────────────────────────────────────────────

class Emitter {
  private finalized = false;
  constructor(private cbs: InsertCallbacks, private audit: () => Partial<AuditEntry>) {}

  state(state: InsertState, message: string, info?: Record<string, unknown>): void {
    try { this.cbs.onState?.(state, { message, info }); }
    catch (err) { console.warn(`${LOG} onState throw:`, err); }
  }

  error(failedAt: InsertState, message: string, userHint: string, info?: Record<string, unknown>): void {
    const detail: InsertErrorDetail = { failedAt, message, userHint, info };
    console.warn(`${LOG} ERRO em ${failedAt}:`, message, info ?? '');
    try { this.cbs.onError?.(detail); }
    catch (err) { console.warn(`${LOG} onError throw:`, err); }
    this.finalize('error', failedAt, message);
  }

  done(message: string, info?: Record<string, unknown>): void {
    try { this.cbs.onDone?.({ message, info }); }
    catch (err) { console.warn(`${LOG} onDone throw:`, err); }
    this.finalize('done');
  }

  private finalize(outcome: 'done' | 'error', failedAt?: string, errorMessage?: string): void {
    if (this.finalized) return;
    this.finalized = true;
    const base = this.audit();
    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      processo: base.processo ?? null,
      atoTipo: base.atoTipo ?? '',
      descricao: base.descricao ?? '',
      nivelAcesso: base.nivelAcesso ?? 'publico',
      hipoteseLegal: base.hipoteseLegal,
      minutaSize: base.minutaSize ?? 0,
      minutaHashPrefix: base.minutaHashPrefix ?? '',
      outcome,
      failedAt,
      errorMessage,
    };
    void appendAuditEntry(entry);
  }
}

/**
 * Inicia a automação das 4 etapas do SEI com os dados já confirmados pelo
 * usuário no cartão de pré-inserção (Fase D.1).
 *
 * Esta função nunca rejeita: todos os erros vão pelo callback `onError`.
 */
export async function insertMinutaNoSEI(
  result: InsertConfirmResult,
  callbacks: InsertCallbacks,
): Promise<void> {
  const minutaHashPrefix = await sha256HexPrefix(result.text);
  const auditSnapshot = (): Partial<AuditEntry> => ({
    processo: result.numeroProcesso,
    atoTipo: result.atoTipo,
    descricao: result.descricao,
    nivelAcesso: result.nivelAcesso.tipo,
    hipoteseLegal: result.nivelAcesso.hipotese,
    minutaSize: result.text.length,
    minutaHashPrefix,
  });
  const emit = new Emitter(callbacks, auditSnapshot);
  console.log(`${LOG} iniciando inserção`, {
    ato: result.atoTipo,
    descricao: result.descricao.slice(0, 80),
    nivel: result.nivelAcesso.tipo,
    tamanhoMinuta: result.text.length,
    hash: minutaHashPrefix,
  });

  // Fase D.5 — kill-switch. Default é desabilitado; o usuário precisa
  // habilitar explicitamente nas Options ("Permitir inserção automática
  // de minutas no SEI"). Fail-closed: qualquer erro → abortado.
  const enabled = await isAutoInsertEnabled();
  if (!enabled) {
    emit.error(
      'idle',
      'Inserção automática no SEI está desabilitada.',
      'Abra as Opções do SEIrtão e marque "Permitir inserção automática de minutas no SEI".',
    );
    return;
  }

  const frames = findSeiFrames();
  if (!frames) {
    emit.error(
      'idle',
      'Iframes do SEI (ifrArvore / ifrConteudoVisualizacao) não encontrados.',
      'Abra o processo no SEI e mantenha a aba ativa antes de inserir.',
    );
    return;
  }

  // Etapa 1 — Clicar "Incluir Documento".
  // Varremos TODOS os iframes same-origin porque o botão pode viver em
  // ifrArvore, num sub-iframe da árvore, ou até no top — versões/temas do
  // SEI variam. Achando o anchor aqui (isolated world, mesmo origem), o
  // bridge só precisa do selector exato para invocar.
  emit.state('clicking-incluir', 'Acionando "Incluir Documento"…');
  const incluir = findIncluirDocumentoAnchor();
  if (!incluir) {
    emit.error(
      'clicking-incluir',
      'Botão "Incluir Documento" não localizado em nenhum iframe do processo.',
      'Clique manualmente em "Incluir Documento" na barra da árvore do processo.',
    );
    return;
  }
  console.log(`${LOG} anchor "Incluir Documento" localizado:`, {
    href: incluir.href.slice(0, 120),
    frameUrl: safeHref(incluir.iframe).slice(0, 120),
  });
  const clickRes = await bridgeCall<BridgeResponse & { matchedText?: string; matchedHref?: string }>(
    incluir.win,
    {
      __seirtao: 'invoke-anchor',
      selector: incluir.selector,
    },
    'invoke-anchor-result',
    TIMEOUTS.clickIncluir,
  );
  if (!clickRes.ok) {
    emit.error(
      'clicking-incluir',
      clickRes.error ?? 'Falha ao acionar "Incluir Documento".',
      'Clique manualmente em "Incluir Documento" na barra da árvore do processo.',
      { matchedText: clickRes.matchedText, matchedHref: clickRes.matchedHref },
    );
    return;
  }

  // Etapa 1→2 — Esperar ifrConteudoVisualizacao navegar para documento_escolher_tipo.
  emit.state('await-tipo', 'Esperando tela "Escolher Tipo do Documento"…');
  const tipoPage = await waitUntil(
    frames.visualizacao,
    (_doc, url) => url.includes('acao=documento_escolher_tipo'),
    TIMEOUTS.awaitTipo,
  );
  if (!tipoPage.ok || !tipoPage.doc) {
    emit.error(
      'await-tipo',
      'Tela "Escolher Tipo do Documento" não carregou.',
      'Verifique se o popup/janela de escolha abriu e repita a ação.',
      { urlObservada: tipoPage.url },
    );
    return;
  }

  // Etapa 2 — Selecionar o tipo escolhido.
  const tipoAnchor = findTipoAnchor(tipoPage.doc, result.atoTipo);
  if (!tipoAnchor) {
    emit.error(
      'selecting-tipo',
      `Tipo "${result.atoTipo}" não encontrado na lista do SEI.`,
      'Escolha o tipo manualmente; o tipo pode estar nomeado de forma diferente nesta unidade.',
      { atoTipo: result.atoTipo },
    );
    return;
  }
  emit.state('selecting-tipo', `Selecionando tipo "${tipoAnchor.textContent?.trim() ?? result.atoTipo}"…`);
  const selectRes = await bridgeCall<BridgeResponse>(
    frames.visualizacao.contentWindow!,
    {
      __seirtao: 'invoke-anchor',
      selector: buildSelectorForAnchor(tipoAnchor),
      hrefContains: 'controlador.php',
    },
    'invoke-anchor-result',
    TIMEOUTS.selectTipo,
  );
  if (!selectRes.ok) {
    emit.error(
      'selecting-tipo',
      selectRes.error ?? 'Falha ao selecionar o tipo do documento.',
      'Selecione o tipo manualmente na lista.',
    );
    return;
  }

  // Etapa 2→3 — Esperar form documento_cadastrar.
  // Aceitamos variações de `acao=` (documento_cadastrar / documento_gerar /
  // documento_cadastrar_ato_administrativo) e usamos o botão Salvar como
  // sinal de "form montado" — os nomes dos campos variam entre versões,
  // mas `btnSalvar` é estável.
  emit.state('await-cadastrar', 'Esperando formulário de cadastro…');
  const cadPage = await waitUntil(
    frames.visualizacao,
    (doc, url) =>
      /acao=documento_(cadastrar|gerar)/.test(url) &&
      !!doc.querySelector('#btnSalvar, input[name="btnSalvar"], button[name="btnSalvar"]'),
    TIMEOUTS.awaitCadastrar,
  );
  if (!cadPage.ok || !cadPage.doc) {
    emit.error(
      'await-cadastrar',
      'Formulário de cadastro do documento não carregou.',
      'Volte e selecione o tipo novamente.',
      { urlObservada: cadPage.url },
    );
    return;
  }

  // Etapa 3 — Preencher descrição, nível de acesso e (se restrito) hipótese.
  emit.state('filling-cadastrar', 'Preenchendo descrição e nível de acesso…');
  const fillOk = await fillCadastrarForm(frames.visualizacao.contentWindow!, result);
  if (!fillOk.ok) {
    emit.error(
      'filling-cadastrar',
      fillOk.error ?? 'Falha ao preencher o formulário.',
      'Preencha os campos manualmente e clique em Salvar.',
      fillOk.info,
    );
    return;
  }

  // Etapa 3→4 — Clicar Salvar (vai para o editor).
  emit.state('submitting', 'Salvando cadastro…');
  const submitRes = await bridgeCall<BridgeResponse>(
    frames.visualizacao.contentWindow!,
    {
      __seirtao: 'click-element',
      selector: 'input#btnSalvar, input[name="btnSalvar"], button#btnSalvar, button[name="btnSalvar"]',
    },
    'click-element-result',
    TIMEOUTS.submit,
  );
  if (!submitRes.ok) {
    emit.error(
      'submitting',
      submitRes.error ?? 'Botão "Salvar" não encontrado.',
      'Clique em Salvar manualmente no formulário.',
    );
    return;
  }

  // Etapa 4 — Esperar o CKEditor abrir em algum iframe e ter instância ativa.
  emit.state('await-editor', 'Esperando editor CKEditor carregar…');
  const editorTarget = await waitForCkEditor(30_000);
  if (!editorTarget) {
    const diag = await collectEditorDiagnostics();
    console.warn(`${LOG} waitForCkEditor esgotou; diagnóstico completo:`);
    console.warn(`${LOG}   frames (${diag.frames}):`);
    for (const u of diag.frameUrls) console.warn(`${LOG}     · ${u}`);
    console.warn(`${LOG}   popups (${diag.popups}):`);
    for (const u of diag.popupUrls) console.warn(`${LOG}     · ${u}`);
    for (const p of diag.popupDomProbes) {
      const c = p.probe?.counts;
      console.warn(
        `${LOG}   popup#${p.index} DOM: ckEditable=${c?.ckEditable ?? '?'}, `
          + `ckContent=${c?.ckContent ?? '?'}, txaEditor=${c?.txaEditor ?? '?'}, `
          + `infraEditor=${c?.infraEditor ?? '?'}, iframes=${c?.iframes ?? '?'}, `
          + `forms[target]=${c?.formsTargetPopup ?? '?'}, `
          + `CKEDITOR=${p.probe?.hasCkeditorGlobal ?? '?'}, `
          + `CK4.instances=${p.probe?.ck4InstanceCount ?? '?'}`
          + `${p.probe?.ck4InstanceNames?.length ? ` [${p.probe.ck4InstanceNames.join(', ')}]` : ''}, `
          + `readyState=${p.probe?.readyState ?? '?'}, `
          + `bodyReady=${p.probe?.bodyReady ?? '?'}`,
      );
      if (p.probe?.iframeSrcs?.length) {
        for (const s of p.probe.iframeSrcs) console.warn(`${LOG}     ↳ iframe: ${s}`);
      }
      if (p.probe?.editableDiag?.length) {
        console.warn(`${LOG}     editables (${p.probe.editableDiag.length}):`);
        p.probe.editableDiag.forEach((d, i) => {
          console.warn(
            `${LOG}       [${i}] ${d.tag}#${d.id || '(sem-id)'} ce=${d.ce ?? 'null'} ro=${d.ro} `
              + `inst=${d.hasInst} wrapInst=${d.hasWrapInst} aria="${d.aria ?? ''}" `
              + `cls="${d.classes}"`,
          );
        });
      }
      if (!p.probe) console.warn(`${LOG}     (sem resposta do popup à dom-probe)`);
      else if (!p.probe.ok) console.warn(`${LOG}     dom-probe falhou: ${p.probe.error ?? '?'}`);
    }
    emit.error(
      'await-editor',
      `Editor CKEditor não ficou pronto no tempo esperado. (frames vistos: ${diag.frames}, popups anunciados: ${diag.popups})`,
      'Veja no console (F12) as linhas "[SEIrtão/insert]   · ..." para saber onde o editor foi registrado. Se já estiver aberto, cole a minuta manualmente (Ctrl+V).',
      diag,
    );
    return;
  }

  // Etapa 4 — Injetar HTML convertido. Modo `append` preserva o cabeçalho
  // pré-preenchido pelo template do SEI; o bridge escolhe o melhor caminho
  // (CK5 model.insertContent → CK4 insertHtml → paste sintético).
  emit.state('injecting', 'Injetando minuta no editor…', {
    instance: editorTarget.instanceName,
    location: editorTarget.popup ? `popup#${editorTarget.popup.index}` : 'frame',
  });
  const html = minutaTextToHtml(result.text);
  const injectEnvelope = {
    __seirtao: 'ckeditor-set-data',
    html,
    instanceName: editorTarget.instanceName,
    mode: 'append' as const,
  };
  const injectRes = editorTarget.popup
    ? await bridgeCallPopup<BridgeResponse & { method?: string; availableInstances?: string[] }>(
        editorTarget.popup.parentWin,
        editorTarget.popup.index,
        injectEnvelope,
        'ckeditor-set-data-result',
        TIMEOUTS.inject,
      )
    : await bridgeCall<BridgeResponse & { method?: string; availableInstances?: string[] }>(
        editorTarget.win,
        injectEnvelope,
        'ckeditor-set-data-result',
        TIMEOUTS.inject,
      );
  if (!injectRes.ok) {
    emit.error(
      'injecting',
      injectRes.error ?? 'Nenhum caminho de inserção funcionou.',
      'Cole a minuta manualmente (Ctrl+V) no editor que já está aberto.',
      { availableInstances: injectRes.availableInstances, method: injectRes.method },
    );
    return;
  }
  console.log(`${LOG} minuta injetada via ${injectRes.method ?? '?'}`);

  emit.state('done', 'Minuta inserida. Revise e assine manualmente no SEI.');
  emit.done('Minuta injetada no CKEditor. Revisão humana obrigatória antes de assinar.');
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers: seleção de tipo, preenchimento do form, detecção do CKEditor
// ─────────────────────────────────────────────────────────────────────────

function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Localiza o `<a>` do tipo escolhido na página `documento_escolher_tipo`.
 *
 * SEI 5.0.4 renderiza cada opção como:
 *   <tr data-desc="termo de ciencia">
 *     <td>...
 *       <input type="checkbox" value="785" title="Termo de Ciência">
 *       <a href="#" onclick="escolher(785)" class="ancoraOpcao">Termo de Ciência</a>
 *     </td>
 *   </tr>
 *
 * Ou seja: `href="#"` em todos, `data-desc` já vem normalizado (sem acento,
 * lowercase), e o id_serie está no `onclick` e no `value` do checkbox.
 * Preferimos casar pelo `<tr data-desc="...">` (mais estável) e devolver o
 * `a.ancoraOpcao` dentro dele.
 */
function findTipoAnchor(doc: Document, atoTipo: string): HTMLAnchorElement | null {
  const needle = normalizeText(atoTipo);

  // 1) Caminho preferido: linha com data-desc exatamente igual.
  const rowExact = doc.querySelector<HTMLTableRowElement>(
    `tr[data-desc="${cssEscape(needle)}"]`,
  );
  if (rowExact) {
    const a = rowExact.querySelector<HTMLAnchorElement>('a.ancoraOpcao');
    if (a) return a;
  }

  // 2) data-desc que contém/está contido no needle (tipo "Despacho" bate
  //    em "Despacho de Distribuição", por exemplo — deixamos o mais curto ganhar).
  const rows = Array.from(doc.querySelectorAll<HTMLTableRowElement>('tr[data-desc]'));
  type Candidate = { anchor: HTMLAnchorElement; desc: string };
  const candidates: Candidate[] = [];
  for (const tr of rows) {
    const desc = (tr.getAttribute('data-desc') ?? '').trim();
    if (!desc) continue;
    if (desc === needle || desc.includes(needle) || needle.includes(desc)) {
      const a = tr.querySelector<HTMLAnchorElement>('a.ancoraOpcao');
      if (a) candidates.push({ anchor: a, desc });
    }
  }
  if (candidates.length > 0) {
    candidates.sort((x, y) => Math.abs(x.desc.length - needle.length) - Math.abs(y.desc.length - needle.length));
    return candidates[0].anchor;
  }

  // 3) Fallback final: percorre `a.ancoraOpcao` casando por textContent.
  const anchors = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a.ancoraOpcao'));
  for (const a of anchors) {
    const text = normalizeText(a.textContent ?? '');
    if (!text) continue;
    if (text === needle || text.includes(needle) || needle.includes(text)) return a;
  }
  return null;
}

/**
 * Gera seletor CSS estável para um anchor. No `documento_escolher_tipo`
 * todos têm `href="#"`, então precisamos do `onclick` (ex.: `escolher(785)`)
 * para identificar o certo. Fora disso, href único é suficiente.
 */
function buildSelectorForAnchor(a: HTMLAnchorElement): string {
  const onclick = a.getAttribute('onclick') ?? '';
  if (onclick) return `a[onclick="${cssEscape(onclick)}"]`;
  const href = a.getAttribute('href') ?? '';
  if (href && href !== '#') return `a[href="${cssEscape(href)}"]`;
  const id = a.getAttribute('id');
  if (id) return `a#${cssEscape(id)}`;
  return 'a';
}

function cssEscape(s: string): string {
  if (typeof (window as unknown as { CSS?: { escape?: (s: string) => string } }).CSS?.escape === 'function') {
    return (window as unknown as { CSS: { escape: (s: string) => string } }).CSS.escape(s);
  }
  return s.replace(/["\\]/g, '\\$&');
}

interface FillOutcome {
  ok: boolean;
  error?: string;
  info?: Record<string, unknown>;
}

async function fillCadastrarForm(
  win: Window,
  result: InsertConfirmResult,
): Promise<FillOutcome> {
  // Descrição — o nome do campo varia entre versões/temas do SEI:
  // txtDescricao (clássico), txtNomeArvore, txtNumero, txtAssunto. Tentamos
  // em ordem; um único sucesso basta (se o SEI exigir campos extras, eles
  // ficam em branco — o usuário ajusta na revisão).
  const descSelectors = [
    'input[name="txtDescricao"]',
    'input#txtDescricao',
    'input[name="txtNomeArvore"]',
    'input#txtNomeArvore',
    'input[name="txtNumero"]',
    'input#txtNumero',
    'input[name="txtAssunto"]',
    'input#txtAssunto',
  ];
  let descRes: BridgeResponse | null = null;
  for (const sel of descSelectors) {
    descRes = await bridgeCall<BridgeResponse>(
      win,
      { __seirtao: 'fill-field', selector: sel, value: result.descricao, kind: 'text' },
      'fill-field-result',
      TIMEOUTS.fillCadastrar,
    );
    if (descRes.ok) {
      console.log(`${LOG} descrição preenchida via ${sel}`);
      break;
    }
  }
  if (!descRes?.ok) {
    return { ok: false, error: `descrição não preencheu (nenhum campo conhecido casou): ${descRes?.error ?? 'não achado'}` };
  }

  // Nível de acesso — radio. Achamos name+value reais via busca por label
  // no próprio documento do iframe (mesma origem).
  const nivelMatch = findNivelRadioMatch(win.document, result.nivelAcesso.tipo);
  if (!nivelMatch) {
    return {
      ok: false,
      error: `nível de acesso (${result.nivelAcesso.tipo}): nenhum radio casou com o label`,
    };
  }
  const nivelSelector =
    `input[type="radio"][name="${cssEscape(nivelMatch.name)}"][value="${cssEscape(nivelMatch.value)}"]`;
  console.log(`${LOG} radio nível encontrado:`, nivelMatch, 'seletor=', nivelSelector);
  const nivelRes = await bridgeCall<BridgeResponse>(
    win,
    {
      __seirtao: 'fill-field',
      selector: nivelSelector,
      value: nivelMatch.value,
      kind: 'radio',
    },
    'fill-field-result',
    TIMEOUTS.fillCadastrar,
  );
  if (!nivelRes.ok) {
    return {
      ok: false,
      error: `nível de acesso (${result.nivelAcesso.tipo}): ${nivelRes.error ?? 'falhou'}`,
      info: { nivelMatch, nivelSelector },
    };
  }

  // Hipótese legal (apenas restrito)
  if (result.nivelAcesso.tipo === 'restrito' && result.nivelAcesso.hipotese) {
    const hipoteseRes = await bridgeCall<BridgeResponse>(
      win,
      {
        __seirtao: 'fill-field',
        selector: 'select[name="selHipoteseLegal"], select#selHipoteseLegal',
        value: result.nivelAcesso.hipotese,
        kind: 'select',
      },
      'fill-field-result',
      TIMEOUTS.fillCadastrar,
    );
    // Falha aqui é soft: a UI do SEI pode ter obrigatoriedade que bloqueia Salvar;
    // reportamos como erro para o usuário selecionar manualmente.
    if (!hipoteseRes.ok) {
      return {
        ok: false,
        error: `hipótese legal: ${hipoteseRes.error ?? 'falhou'} (selecione manualmente o item "${result.nivelAcesso.hipotese}")`,
      };
    }
  }

  return { ok: true };
}

interface CkTarget {
  win: Window;
  instanceName: string;
  /**
   * Quando presente, o editor vive num popup aberto via `window.open()` —
   * inacessível por `window.frames`. Mensagens ao editor precisam ser
   * encaminhadas via `bridgeCallPopup`, onde `parentWin` é a janela que
   * detém o registry de popups no bridge MAIN e `index` é a posição no
   * retorno do `list-popups`.
   */
  popup?: { parentWin: Window; index: number };
}

/**
 * Envia um envelope ao popup #`popupIndex` da `parentWin` via
 * `forward-to-popup` e aguarda a resposta do popup (que chega na janela
 * corrente via `MessageEvent` porque os popups são same-origin e
 * `postMessage` de volta para `window.opener` acaba também nesta janela
 * quando o listener está no isolated world — a implementação mais robusta
 * é escutar em `window` e deixar o popup responder com `postMessage` a
 * qualquer janela; na prática o popup responde com `parent.postMessage`,
 * mas aqui preferimos que o próprio handler do popup espalhe a resposta
 * para todas as janelas na hierarquia).
 *
 * Concretamente, os dois canais chegam na mesma janela porque o
 * `reply()` do bridge MAIN (em `sei-main-world.ts`) também faz
 * `window.postMessage` local — o `MessageEvent.source` é o popup, mas a
 * janela que hospeda o listener é a que abriu o popup (isolated world
 * do content script).
 */
function bridgeCallPopup<T extends BridgeResponse>(
  parentWin: Window,
  popupIndex: number,
  innerEnvelope: Record<string, unknown> & { __seirtao: string },
  expectedKind: string,
  timeoutMs: number,
): Promise<T> {
  return new Promise((resolve) => {
    const innerNonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const forwardNonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    let settled = false;

    const onMessage = (e: MessageEvent): void => {
      const data = e.data as BridgeResponse | null;
      if (!data || typeof data !== 'object') return;
      // Queremos a resposta do inner, com o innerNonce — ignora o ack
      // `forward-to-popup-result` (que chega antes, só confirmando o despacho).
      if (data.__seirtao !== expectedKind || data.nonce !== innerNonce) return;
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
      resolve(data as T);
    };

    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      resolve({
        __seirtao: expectedKind, nonce: innerNonce, ok: false,
        error: `timeout (popup não respondeu em ${timeoutMs}ms)`,
      } as T);
    }, timeoutMs);

    window.addEventListener('message', onMessage);

    try {
      parentWin.postMessage({
        __seirtao: 'forward-to-popup',
        nonce: forwardNonce,
        popupIndex,
        inner: { ...innerEnvelope, nonce: innerNonce },
      }, '*');
    } catch (err) {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve({
          __seirtao: expectedKind, nonce: innerNonce, ok: false,
          error: err instanceof Error ? err.message : String(err),
        } as T);
      }
    }
  });
}

/**
 * Varre iframes em busca do editor CKEditor pronto. Suporta duas APIs:
 *  - CK4: `window.CKEDITOR.instances` (registry global).
 *  - CK5: sem registry — cada `ckeditorInstance` fica no próprio elemento
 *    editável (`.ck-editor__editable` / `#txaEditor_*`).
 * A detecção é feita no main world (veja `sei-main-world.ts`).
 * Faz polling porque o CKEditor boota async.
 */
async function waitForCkEditor(timeoutMs: number): Promise<CkTarget | null> {
  const started = Date.now();
  // Janela de graça em que preferimos uma instância nativa (CK4/CK5) em vez
  // do fallback DOM. Dá tempo para o CK5 anexar `ckeditorInstance`.
  const GRACE_MS = 2500;
  let lastDomTarget: CkTarget | null = null;
  while (Date.now() - started < timeoutMs) {
    const target = await probeCkEditorOnce();
    if (target) {
      const isDom = target.instanceName.startsWith('dom:');
      if (!isDom) return target;
      lastDomTarget = target;
      if (Date.now() - started >= GRACE_MS) return target;
    }
    await sleep(400);
  }
  return lastDomTarget;
}

async function probeCkEditorOnce(): Promise<CkTarget | null> {
  const candidates = collectFrameWindows();
  const diag: Array<{ url: string; ok: boolean; instances?: string[]; error?: string; via?: string }> = [];

  // 1) Varrer iframes normais.
  for (const win of candidates) {
    try {
      const res = await bridgeCall<BridgeResponse & { instances?: string[] }>(
        win,
        { __seirtao: 'query-ckeditor' },
        'query-ckeditor-result',
        1500,
      );
      let url = '?';
      try { url = win.location?.href ?? '?'; } catch { /* cross-origin */ }
      diag.push({ url: url.slice(0, 120), ok: res.ok, instances: res.instances, error: res.error, via: 'frame' });
      if (res.ok && res.instances && res.instances.length > 0) {
        return { win, instanceName: res.instances[0] };
      }
    } catch { /* ignora — outro iframe */ }
  }

  // 2) Para cada janela candidata, perguntar ao bridge MAIN dela quais
  // popups existem (abertos via window.open naquele contexto) e probar
  // cada popup via `forward-to-popup`.
  for (const parentWin of candidates) {
    let listRes: BridgeResponse & { count?: number; urls?: string[] };
    try {
      listRes = await bridgeCall<BridgeResponse & { count?: number; urls?: string[] }>(
        parentWin,
        { __seirtao: 'list-popups' },
        'list-popups-result',
        1000,
      );
    } catch { continue; }
    if (!listRes.ok || !listRes.count) continue;

    for (let i = 0; i < listRes.count; i += 1) {
      try {
        const res = await bridgeCallPopup<BridgeResponse & { instances?: string[] }>(
          parentWin,
          i,
          { __seirtao: 'query-ckeditor' },
          'query-ckeditor-result',
          1500,
        );
        const url = listRes.urls?.[i] ?? '?';
        diag.push({ url: url.slice(0, 120), ok: res.ok, instances: res.instances, error: res.error, via: `popup#${i}` });
        if (res.ok && res.instances && res.instances.length > 0) {
          return {
            win: parentWin,
            instanceName: res.instances[0],
            popup: { parentWin, index: i },
          };
        }
      } catch { /* ignora popup individual */ }
    }
  }

  // Log compacto: uma linha por candidato, para evitar poluir o console
  // quando o polling roda dezenas de vezes. Só mostra errors não-vazios
  // para reduzir ruído. O log verboso completo é impresso no momento do
  // timeout final em `collectEditorDiagnostics`.
  if (diag.some((d) => !d.ok && d.error && d.via?.startsWith('popup'))) {
    for (const d of diag) {
      if (!d.ok && d.via?.startsWith('popup')) {
        console.debug(`${LOG}   ${d.via}: ${d.error ?? '?'} | ${d.url}`);
      }
    }
  }
  return null;
}

interface DomProbeResponse extends BridgeResponse {
  url?: string;
  bodyReady?: boolean;
  readyState?: string;
  counts?: {
    ckEditable: number;
    ckContent: number;
    txaEditor: number;
    infraEditor: number;
    iframes: number;
    formsTargetPopup: number;
  };
  iframeSrcs?: string[];
  hasCkeditorGlobal?: boolean;
  ck4InstanceCount?: number;
  ck4InstanceNames?: string[];
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
}

interface EditorDiag {
  frames: number;
  popups: number;
  popupUrls: string[];
  frameUrls: string[];
  popupDomProbes: Array<{ index: number; url: string; probe: DomProbeResponse | null }>;
  [k: string]: unknown;
}

/**
 * Coleta informação de diagnóstico sobre frames e popups anunciados.
 * Usado quando `waitForCkEditor` esgota, para que o usuário (ou o log no
 * console) tenha uma pista de onde o editor realmente vive.
 */
async function collectEditorDiagnostics(): Promise<EditorDiag> {
  const frames = collectFrameWindows();
  const frameUrls = frames.map((w) => {
    try { return (w.location?.href ?? '?').slice(0, 120); } catch { return '?(x-origin)'; }
  });
  let popupCount = 0;
  const popupUrls: string[] = [];
  const popupDomProbes: EditorDiag['popupDomProbes'] = [];
  for (const parentWin of frames) {
    let listRes: BridgeResponse & { count?: number; urls?: string[] };
    try {
      listRes = await bridgeCall<BridgeResponse & { count?: number; urls?: string[] }>(
        parentWin,
        { __seirtao: 'list-popups' },
        'list-popups-result',
        500,
      );
    } catch { continue; }
    if (!listRes.ok || !listRes.count) continue;
    popupCount += listRes.count;
    for (let i = 0; i < listRes.count; i += 1) {
      const u = (listRes.urls?.[i] ?? '?').slice(0, 120);
      popupUrls.push(u);
      // DOM-probe the popup itself: quantos elementos do CKEditor existem lá?
      let probe: DomProbeResponse | null = null;
      try {
        probe = await bridgeCallPopup<DomProbeResponse>(
          parentWin,
          i,
          { __seirtao: 'dom-probe' },
          'dom-probe-result',
          2000,
        );
      } catch { /* ignora */ }
      popupDomProbes.push({ index: i, url: u, probe });
    }
  }
  return { frames: frames.length, popups: popupCount, popupUrls, frameUrls, popupDomProbes };
}

/**
 * Retorna todas as `Window`s alcançáveis: o próprio `window` mais todos os
 * iframes descendentes em profundidade. Inclui o próprio top porque, em
 * alguns fluxos, o editor abre no mesmo frame que carregou o formulário.
 */
function collectFrameWindows(): Window[] {
  const out: Window[] = [window];
  const visit = (w: Window): void => {
    try {
      for (let i = 0; i < w.frames.length; i += 1) {
        const child = w.frames[i];
        out.push(child);
        visit(child);
      }
    } catch { /* cross-origin — ignora */ }
  };
  visit(window);
  return out;
}
