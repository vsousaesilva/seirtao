/**
 * Bootstrap do seirtao nas páginas do SEI.
 *
 * Content script roda em todos os frames (`all_frames:true`), mas a UI
 * (botão na navbar + sidebar) é montada apenas no frame TOP para evitar
 * duplicação — inner frames (`ifrArvore`, `arvore_visualizar`) continuam
 * rodando os parsers silenciosamente para alimentar o painel.
 */

import {
  extractActionUrlsFromDocument,
  getAcao,
  isSeiPage,
  parseArvore,
  type ArvoreProcesso,
  type NoArvore,
} from './adapters/sei';
import { createChatSession, type ChatSession } from './sei-chat';
import { minutarProximoAto, minutarAtoEspecifico } from './sei-minutar';
import { resumirProcesso } from './sei-resumir';
import { discoverDocumentTypes } from './sei-document-types';
import { insertMinutaNoSEI } from './sei-minutar-insert';
import { otimizarModelo } from './sei-otimizar';
import { mountPanel, type PanelController } from './ui/seirtao-panel';
import { mountToolbarButton } from './ui/seirtao-toolbar';

const LOG = '[SEIrtão]';

function isTopFrame(): boolean {
  try {
    return window.top === window;
  } catch {
    return false;
  }
}

function tryMountUI(acao: string | null, navRight: HTMLElement): PanelController | null {
  const panel = mountPanel();
  const toolbar = mountToolbarButton(navRight);
  if (!toolbar) {
    console.warn(`${LOG} botão não montou — navRight=`, navRight);
    return null;
  }
  toolbar.onClick(() => panel.toggle());

  console.log(`${LOG} UI montada — botão inserido na navbar (acao="${acao}")`);
  return panel;
}

/** Seletores candidatos para a navbar direita do SEI, na ordem de preferência. */
const NAVBAR_SELECTORS = [
  '#divInfraBarraSistemaPadraoD',
  '[id*="BarraSistemaPadraoD"]',
  '[id*="BarraSistema"] .nav-item',
  'header .nav-item.infraAcaoBarraSistema',
];

function findNavbar(): HTMLElement | null {
  for (const sel of NAVBAR_SELECTORS) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) {
      const container = el.id && el.id.includes('BarraSistemaPadraoD') ? el : (el.parentElement as HTMLElement | null);
      return container ?? el;
    }
  }
  return null;
}

/** Aguarda o nó da navbar aparecer, retentando por até `timeout` ms. */
function waitForNavbar(timeout = 8000): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const existing = findNavbar();
    if (existing) { resolve(existing); return; }

    const obs = new MutationObserver(() => {
      const el = findNavbar();
      if (el) { obs.disconnect(); resolve(el); }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });

    setTimeout(() => { obs.disconnect(); resolve(null); }, timeout);
  });
}

function dumpHeaderIds(): string[] {
  const ids: string[] = [];
  document.querySelectorAll<HTMLElement>('[id]').forEach((el) => {
    if (/Barra|Sistema|Header|header|nav/i.test(el.id)) ids.push(el.id);
  });
  return ids.slice(0, 30);
}

let currentArvore: ArvoreProcesso | null = null;

function wireResumirAction(panel: PanelController): void {
  panel.onResumirClick(() => {
    if (!currentArvore) {
      panel.resumo.error('Árvore do processo ainda não foi carregada.');
      return;
    }
    const selected = panel.getSelectedDocIds();
    if (selected.size === 0) {
      panel.resumo.error('Nenhum documento selecionado. Marque ao menos um documento na seção "Documentos".');
      return;
    }
    panel.resumo.reset();
    panel.resumo.setProgress(0, selected.size, 'iniciando…');
    resumirProcesso(currentArvore, {
      onProgress: (done, total, current) => panel.resumo.setProgress(done, total, current),
      onChunk: (delta) => {
        panel.resumo.startStreaming();
        panel.resumo.appendChunk(delta);
      },
      onDone: () => panel.resumo.done(),
      onError: (msg) => panel.resumo.error(msg),
    }, selected);
  });
}

function wireMinutarAction(panel: PanelController): void {
  panel.onMinutarClick(() => {
    if (!currentArvore) {
      panel.triage.error('Árvore do processo ainda não foi carregada.');
      return;
    }
    const selected = panel.getSelectedDocIds();
    if (selected.size === 0) {
      panel.triage.error('Nenhum documento selecionado. Marque ao menos um documento na seção "Documentos".');
      return;
    }
    panel.triage.setProgress(0, selected.size, 'iniciando…');
    minutarProximoAto(currentArvore, {
      onProgress: (done, total, current) => panel.triage.setProgress(done, total, current),
      onChunk: (delta) => {
        panel.triage.startStreaming();
        panel.triage.appendChunk(delta);
      },
      onDone: () => panel.triage.done(),
      onError: (msg) => panel.triage.error(msg),
    }, selected);
  });

  panel.onMinutarAtoClick((atoLabel, orientations, templateOverride) => {
    if (!currentArvore) {
      panel.minuta.error('Árvore do processo ainda não foi carregada.');
      return;
    }
    const selected = panel.getSelectedDocIds();
    if (selected.size === 0) {
      panel.minuta.error('Nenhum documento selecionado. Marque ao menos um documento na seção "Documentos".');
      return;
    }
    panel.minuta.reset();
    panel.minuta.setProgress(0, selected.size, 'iniciando…');
    console.log(
      `${LOG} gerando minuta para ato="${atoLabel}" ` +
      `(orientações: ${orientations ? 'sim' : 'não'}, modelo: ${templateOverride ?? 'auto'}).`,
    );
    minutarAtoEspecifico(
      currentArvore,
      atoLabel,
      orientations,
      {
        onProgress: (done, total, current) => panel.minuta.setProgress(done, total, current),
        onChunk: (delta) => {
          panel.minuta.startStreaming();
          panel.minuta.appendChunk(delta);
        },
        onDone: () => panel.minuta.done(),
        onError: (msg) => panel.minuta.error(msg),
      },
      selected,
      templateOverride,
    );
  });

  panel.onInserirMinutaConfirmed((result) => {
    console.log(`${LOG} cartão de pré-inserção confirmado (Fase D.1):`, {
      processo: result.numeroProcesso,
      atoTipo: result.atoTipo,
      descricao: result.descricao,
      nivel: result.nivelAcesso.tipo,
      hipotese: result.nivelAcesso.hipotese ?? '—',
      tamanhoMinuta: result.text.length,
    });
    void insertMinutaNoSEI(result, {
      onState: (state, detail) => {
        console.log(`${LOG} [insert] ${state} — ${detail.message}`, detail.info ?? '');
        panel.minuta.setInsertState?.(state, detail.message);
      },
      onError: (detail) => {
        console.warn(`${LOG} [insert] ERRO em ${detail.failedAt}:`, detail.message);
        panel.minuta.setInsertError?.(detail.failedAt, detail.message, detail.userHint);
      },
      onDone: (detail) => {
        console.log(`${LOG} [insert] done — ${detail.message}`);
        panel.minuta.setInsertDone?.(detail.message);
      },
    });
  });
}

function wireOtimizarAction(panel: PanelController): void {
  panel.onOtimizarRequest((modeloText) => {
    console.log(`${LOG} [otimizar] recebido modelo (${modeloText.length} chars).`);
    panel.otimizar.reset();
    panel.otimizar.setProgress(0, 1, 'preparando…');
    void otimizarModelo(modeloText, {
      onStarted: () => panel.otimizar.startStreaming(),
      onChunk: (delta) => panel.otimizar.appendChunk(delta),
      onDone: () => panel.otimizar.done(),
      onError: (msg) => panel.otimizar.error(msg),
    });
  });
}

function wireChatAction(panel: PanelController): ChatSession {
  const session = createChatSession(
    () => currentArvore,
    () => panel.getSelectedDocIds(),
    panel.chat,
  );
  panel.chat.onSend((text) => { void session.send(text); });
  return session;
}

function feedPanelFromCurrentPage(panel: PanelController): ArvoreProcesso | null {
  try {
    const arvore = parseArvore(document.documentElement.outerHTML);
    if (arvore.nos.length > 0) {
      panel.setArvore(arvore);
      currentArvore = arvore;
      console.log(`${LOG} árvore parseada:`, {
        numeroProcesso: arvore.numeroProcesso,
        totalNos: arvore.nos.length,
        totalAcoes: arvore.acoes.length,
      });
      triggerTypesDiscovery();
      return arvore;
    }
  } catch (err) {
    console.error(`${LOG} erro ao parsear árvore:`, err);
  }
  return null;
}

let typesDiscoveryStarted = false;
function triggerTypesDiscovery(): void {
  if (typesDiscoveryStarted) return;
  typesDiscoveryStarted = true;
  void discoverDocumentTypes().catch((err) => {
    console.warn(`${LOG} falha na descoberta de tipos:`, err);
  });
}

/** Procura um iframe same-origin cujo documento contenha a árvore serializada. */
function findArvoreFrameDoc(): Document | null {
  const iframes = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'));
  for (const iframe of iframes) {
    try {
      const doc = iframe.contentDocument;
      if (!doc) continue;
      const html = doc.documentElement?.outerHTML ?? '';
      if (/new\s+infraArvoreNo\s*\(/.test(html)) return doc;
    } catch {
      // Cross-origin — ignorar.
    }
  }
  return null;
}

/**
 * Reordena `nos` em DFS a partir das raízes, garantindo que cada filho
 * apareça logo após seu pai. Necessário porque `ifrPasta` entrega os
 * documentos de uma pasta em bloco, e na ordem de expansão eles ficariam
 * todos ao final do array — quebrando o indent/agrupamento visual do painel.
 */
function orderByTree(arvore: ArvoreProcesso): ArvoreProcesso {
  const byId = new Map<string, NoArvore>();
  for (const n of arvore.nos) byId.set(n.id, n);

  const childrenOf = new Map<string, NoArvore[]>();
  const roots: NoArvore[] = [];
  for (const n of arvore.nos) {
    if (n.pai && byId.has(n.pai)) {
      const list = childrenOf.get(n.pai) ?? [];
      list.push(n);
      childrenOf.set(n.pai, list);
    } else {
      roots.push(n);
    }
  }

  const ordered: NoArvore[] = [];
  const visited = new Set<string>();
  const visit = (n: NoArvore): void => {
    if (visited.has(n.id)) return;
    visited.add(n.id);
    ordered.push(n);
    const kids = childrenOf.get(n.id);
    if (kids) for (const k of kids) visit(k);
  };
  for (const r of roots) visit(r);
  // Salvaguarda contra ciclos ou pais perdidos: preserva todo nó não visitado.
  for (const n of arvore.nos) {
    if (!visited.has(n.id)) {
      visited.add(n.id);
      ordered.push(n);
    }
  }
  return { ...arvore, nos: ordered };
}

/**
 * Mescla duas árvores em uma, dedup por `id`, preferindo o nó com `.src`.
 * Acoes mantém combinação por (idNo|tipo). A ordem final segue DFS pelo campo
 * `pai`, para que documentos de uma pasta sempre apareçam imediatamente sob
 * ela (independente da ordem em que foram coletados por `expandOnePasta`).
 */
function mergeArvores(base: ArvoreProcesso, extra: ArvoreProcesso): ArvoreProcesso {
  const byId = new Map<string, NoArvore>();
  for (const n of base.nos) byId.set(n.id, n);
  for (const n of extra.nos) {
    const existing = byId.get(n.id);
    if (!existing) byId.set(n.id, n);
    else if (!existing.src && n.src) byId.set(n.id, n);
  }
  const acoesById = new Map<string, { idNo: string; tipo: string; descricao: string }>();
  for (const a of base.acoes) acoesById.set(`${a.idNo}|${a.tipo}`, a);
  for (const a of extra.acoes) acoesById.set(`${a.idNo}|${a.tipo}`, a);
  return orderByTree({
    nos: Array.from(byId.values()),
    acoes: Array.from(acoesById.values()),
    numeroProcesso: base.numeroProcesso ?? extra.numeroProcesso,
  });
}

/**
 * Envia uma requisição de expansão da pasta `pastaId` para o bridge MAIN world
 * rodando dentro de `targetWin` e aguarda a resposta.
 *
 * O bridge (src/content/sei-main-world.ts) roda no contexto da página, o que
 * permite invocar `window.__lnkPastaClicado(...)` diretamente — essa é a
 * única maneira de acionar as pastas do SEI sem violar o CSP `script-src`
 * (que bloqueia navegação via `javascript:` URLs em clicks sintéticos).
 */
function requestPastaExpand(
  targetWin: Window,
  pastaId: string,
  timeoutMs = 4000,
): Promise<{ ok: boolean; method?: string; error?: string }> {
  return new Promise((resolve) => {
    const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    let settled = false;

    const onMessage = (e: MessageEvent): void => {
      const data = e.data as { __seirtao?: string; nonce?: string; ok?: boolean; method?: string; error?: string } | null;
      if (!data || data.__seirtao !== 'expand-pasta-result' || data.nonce !== nonce) return;
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
      resolve({ ok: !!data.ok, method: data.method, error: data.error });
    };

    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      resolve({ ok: false, error: 'timeout (bridge não respondeu)' });
    }, timeoutMs);

    window.addEventListener('message', onMessage);
    try {
      targetWin.postMessage({ __seirtao: 'expand-pasta', nonce, pastaId }, '*');
    } catch (err) {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
  });
}

/**
 * Localiza o sub-iframe `ifrPasta` dentro de um documento `ifrArvore`.
 * SEI 5.0.4 nomeia esse iframe `ifrPasta`; versões antigas às vezes usam
 * `ifrVisualizacaoPasta` ou id similar — tentamos variações.
 */
function findIfrPasta(doc: Document): HTMLIFrameElement | null {
  return doc.querySelector<HTMLIFrameElement>(
    'iframe[name="ifrPasta"], iframe#ifrPasta, iframe[name*="asta"], iframe[id*="asta"]',
  );
}

function describeFrameUrl(f: HTMLIFrameElement | null): string {
  if (!f) return '(null)';
  try { return f.contentDocument?.location.href ?? f.src ?? '(no-url)'; } catch { return f.src ?? '(no-url)'; }
}

/**
 * Expande uma única PASTA: pede ao bridge que invoque `__lnkPastaClicado`,
 * aguarda o sub-iframe `ifrPasta` navegar para a página `procedimento_paginar`
 * da pasta em questão, e parseia seus `Nos[]` (cada pasta traz sua própria
 * serialização infraArvoreNo com os DOCUMENTOs internos).
 */
async function expandOnePasta(
  hiddenDoc: Document,
  hiddenWin: Window,
  pastaId: string,
): Promise<ArvoreProcesso | null> {
  const beforeFrame = findIfrPasta(hiddenDoc);
  const beforeUrl = describeFrameUrl(beforeFrame);

  const ack = await requestPastaExpand(hiddenWin, pastaId);
  if (!ack.ok) {
    console.warn(`${LOG}/expander bridge falhou para pasta ${pastaId}: ${ack.error ?? '(sem detalhe)'}.`);
    return null;
  }

  // SEI atualiza ifrPasta.src = '...&no_pai=PASTA_ID&...' depois do `__lnkPastaClicado`
  // retornar. Em seguida dispara a navegação: `load` do ifrPasta indica DOM pronto.
  const deadline = Date.now() + 8000;
  let target: HTMLIFrameElement | null = null;
  while (Date.now() < deadline) {
    const f = findIfrPasta(hiddenDoc);
    if (f) {
      const cur = describeFrameUrl(f);
      if (cur !== beforeUrl && (cur.includes(`no_pai=${pastaId}`) || cur.includes(`id_pasta=${pastaId}`) || cur.includes(`'${pastaId}'`))) {
        target = f;
        break;
      }
    }
    await new Promise((r) => window.setTimeout(r, 120));
  }

  if (!target) {
    console.warn(`${LOG}/expander ifrPasta não navegou para pasta ${pastaId} após 8s (anterior=${beforeUrl.slice(0, 80)}).`);
    return null;
  }

  // Aguarda `load` se ainda estiver carregando.
  try {
    const rs = target.contentDocument?.readyState;
    if (rs !== 'complete') {
      await new Promise<void>((resolve) => {
        const t = window.setTimeout(resolve, 6000);
        target!.addEventListener('load', () => { window.clearTimeout(t); resolve(); }, { once: true });
      });
    }
  } catch { /* cross-origin safety */ }

  // Deixa o JS inline do SEI rodar e preencher Nos[]/Nos[].src antes de parsear.
  await new Promise((r) => window.setTimeout(r, 150));

  const doc = target.contentDocument;
  if (!doc) {
    console.warn(`${LOG}/expander contentDocument do ifrPasta inacessível para ${pastaId}.`);
    return null;
  }
  try {
    const sub = parseArvore(doc.documentElement.outerHTML);
    console.log(`${LOG}/expander pasta ${pastaId} ifrPasta url=${describeFrameUrl(target).slice(0, 100)} — ${sub.nos.length} nós parseados.`);
    return sub;
  } catch (err) {
    console.warn(`${LOG}/expander erro parseando ifrPasta de ${pastaId}:`, err);
    return null;
  }
}

/**
 * Expande a árvore do processo SEM invalidar a sessão:
 *   1. cria um iframe invisível same-origin apontando para a URL atual do ifrArvore;
 *   2. para cada PASTA, pede ao bridge MAIN world (dentro do iframe) que
 *      invoque `__lnkPastaClicado('X')` — o que faz o SEI navegar o sub-iframe
 *      interno `ifrPasta` para `acao=procedimento_paginar&no_pai=X`;
 *   3. aguarda `ifrPasta` carregar, parseia seus `Nos[]` e mescla no resultado
 *      (cada `ifrPasta` traz os DOCUMENTOs daquela pasta com `.src` já populado);
 *   4. remove o iframe ao final.
 *
 * Rodar concorrente ou reaproveitar hash manualmente (via fetch) faz o SEI
 * redirecionar para `sip.trf5.jus.br/sip/login.php?msg=Tamanho de hash inválido`
 * e invalidar a sessão inteira — então o procedimento aqui é estritamente
 * sequencial e usa apenas mecanismos nativos da página.
 */
async function expandViaHiddenIframe(
  iframeUrl: string,
  initial: ArvoreProcesso,
): Promise<ArvoreProcesso> {
  const pastaIds = initial.nos.filter((n) => n.tipo === 'PASTA').map((n) => n.id);
  if (pastaIds.length === 0) return initial;

  const hidden = document.createElement('iframe');
  hidden.setAttribute('aria-hidden', 'true');
  hidden.setAttribute('tabindex', '-1');
  hidden.title = 'SEIrtão — extrator de árvore (oculto)';
  Object.assign(hidden.style, {
    position: 'fixed',
    width: '1px',
    height: '1px',
    opacity: '0',
    top: '-9999px',
    left: '-9999px',
    border: '0',
    pointerEvents: 'none',
  } as CSSStyleDeclaration);

  const waitHiddenLoad = (timeoutMs = 15000): Promise<void> =>
    new Promise((resolve, reject) => {
      let done = false;
      const timer = window.setTimeout(() => {
        if (done) return;
        done = true;
        hidden.removeEventListener('load', onLoad);
        reject(new Error('timeout'));
      }, timeoutMs);
      const onLoad = (): void => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        resolve();
      };
      hidden.addEventListener('load', onLoad, { once: true });
    });

  console.log(`${LOG}/expander criando iframe oculto — ${pastaIds.length} pastas:`, pastaIds);
  const loadInitial = waitHiddenLoad();
  hidden.src = iframeUrl;
  document.body.appendChild(hidden);

  let merged = initial;
  try {
    await loadInitial;
    console.log(`${LOG}/expander iframe oculto carregado — url=${hidden.contentDocument?.location.href}`);

    for (const pastaId of pastaIds) {
      const doc = hidden.contentDocument;
      const win = hidden.contentWindow;
      if (!doc || !win) {
        console.warn(`${LOG}/expander contentDocument/Window perdido ao iterar ${pastaId}.`);
        break;
      }
      const sub = await expandOnePasta(doc, win, pastaId);
      if (!sub || sub.nos.length === 0) continue;
      const antes = merged.nos.length;
      merged = mergeArvores(merged, sub);
      console.log(
        `${LOG}/expander pasta ${pastaId} mesclada — subtree=${sub.nos.length}, total=${merged.nos.length} (+${merged.nos.length - antes}).`,
      );
    }
  } finally {
    try { hidden.remove(); } catch { /* ignore */ }
  }

  return merged;
}

function feedPanelFromInnerFrames(panel: PanelController, retries = 20): void {
  const doc = findArvoreFrameDoc();
  if (doc) {
    try {
      const arvore = parseArvore(doc.documentElement.outerHTML);
      if (arvore.nos.length > 0) {
        panel.setArvore(arvore);
        currentArvore = arvore;
        console.log(`${LOG} árvore parseada de iframe interno:`, {
          numeroProcesso: arvore.numeroProcesso,
          totalNos: arvore.nos.length,
          totalAcoes: arvore.acoes.length,
        });
        triggerTypesDiscovery();
        const iframeUrl = doc.location?.href ?? '';
        if (iframeUrl) {
          expandViaHiddenIframe(iframeUrl, arvore).then((full) => {
            if (full.nos.length > arvore.nos.length) {
              console.log(
                `${LOG} árvore expandida via iframe oculto: ${arvore.nos.length} → ${full.nos.length} (+${full.nos.length - arvore.nos.length}).`,
              );
              panel.setArvore(full);
              currentArvore = full;
            } else {
              console.log(`${LOG} expansão não trouxe novos nós (${full.nos.length}).`);
            }
          }).catch((err) => {
            console.warn(`${LOG} falha na expansão via iframe oculto:`, err);
          });
        }
        return;
      }
    } catch (err) {
      console.error(`${LOG} erro ao parsear árvore do iframe:`, err);
    }
  }
  if (retries > 0) {
    window.setTimeout(() => feedPanelFromInnerFrames(panel, retries - 1), 500);
  } else {
    console.warn(`${LOG} árvore não encontrada em nenhum iframe após tentativas.`);
  }
}

function logArvoreVisualizar(): void {
  try {
    const urls = extractActionUrlsFromDocument(document);
    console.log(`${LOG} URLs de ação (${Object.keys(urls).length}):`, urls);
  } catch (err) {
    console.error(`${LOG} erro ao extrair URLs de ação:`, err);
  }
}

function logEditorMontar(): void {
  const editores = Array.from(document.querySelectorAll<HTMLElement>('[id^="txaEditor_"]'));
  console.log(`${LOG} editor_montar — ${editores.length} instâncias CKEditor:`, editores.map((el) => el.id));
}

/**
 * Ações do SEI em que faz sentido oferecer o assistente — todas envolvem
 * um processo aberto. Fora delas (controle_processos, base_conhecimento,
 * painel_controle, etc.), o botão não é montado para não poluir a navbar.
 */
const ACOES_COM_PROCESSO = new Set<string>([
  'procedimento_trabalhar',
  'procedimento_visualizar',
]);

export function bootSeirtao(): boolean {
  console.log(`${LOG} content script carregou — host="${window.location.host}", url="${window.location.href}"`);
  if (!isSeiPage()) {
    console.log(`${LOG} host "${window.location.host}" não casa com sei.trf5.jus.br — saindo.`);
    return false;
  }

  const acao = getAcao();
  const frame = isTopFrame() ? 'top' : (window.name || 'inner');
  console.log(`${LOG} SEI detectado — acao="${acao}", frame="${frame}"`);

  // Frames internos só fazem telemetria/parse silencioso.
  if (!isTopFrame()) {
    if (acao === 'arvore_visualizar') logArvoreVisualizar();
    else if (acao === 'editor_montar') logEditorMontar();
    return true;
  }

  // Frame top: só monta a UI se estivermos dentro de um processo.
  if (!acao || !ACOES_COM_PROCESSO.has(acao)) {
    console.log(`${LOG} tela atual (acao="${acao}") não é de processo aberto — UI não será montada.`);
    return true;
  }

  waitForNavbar().then((navbar) => {
    if (!navbar) {
      console.warn(`${LOG} navbar não encontrada após 8s. IDs candidatos no DOM:`, dumpHeaderIds());
      return;
    }
    console.log(`${LOG} navbar encontrada — id="${navbar.id}", tag="${navbar.tagName}"`);
    const panel = tryMountUI(acao, navbar);
    if (!panel) return;

    wireResumirAction(panel);
    wireMinutarAction(panel);
    wireOtimizarAction(panel);
    wireChatAction(panel);

    // No SEI a árvore pode estar no próprio top (acao=procedimento_visualizar)
    // ou em um iframe interno (acao=procedimento_trabalhar + ifrArvore).
    if (acao === 'procedimento_visualizar') {
      feedPanelFromCurrentPage(panel);
    } else if (acao === 'procedimento_trabalhar') {
      feedPanelFromInnerFrames(panel);
    }
  });

  return true;
}
