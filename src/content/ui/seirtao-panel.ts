/**
 * Sidebar direita do seirtao.
 *
 * Painel deslizante que abre/fecha via clique no botão da navbar do SEI.
 * Usa um host isolado em Shadow DOM para não colidir com o CSS do SEI.
 * Todo o markup fica dentro do shadow root; a única pegada no documento
 * hospedeiro é o `<div id="seirtao-panel-host">` fixado na viewport.
 */

import type { ArvoreProcesso, NoArvore } from '../adapters/sei';
import { invalidateDocsCache } from '../sei-docs-cache';
import { ATOS_ADMINISTRATIVOS, parseMinutarResult } from '../../shared/prompts';
import { discoverDocumentTypes, peekDocumentTypes } from '../sei-document-types';

const HOST_ID = 'seirtao-panel-host';
/**
 * Largura responsiva do painel: `clamp(min, preferred, max)`.
 *
 *  - mínimo 560px: garante que as duas colunas (aside ~300px + main) caibam
 *    sem quebra em telas pequenas do SEI;
 *  - preferido 64vw: aproveita a largura útil quando o monitor é largo;
 *  - máximo 920px: evita ocupar a tela inteira em monitores >=1440px.
 *
 * Mantemos em CSS para deixar o navegador fazer o ajuste. O `host.style.width`
 * é preenchido com a largura efetiva do painel (medida via `getBoundingClientRect`)
 * para que o retângulo de `pointer-events` acompanhe o tamanho real.
 */
const PANEL_CSS_WIDTH = 'clamp(560px, 64vw, 920px)';

export type StreamState = 'idle' | 'fetching' | 'streaming' | 'done' | 'error';

/** API controlada pelo orquestrador de streaming (resumo / minuta). */
export interface StreamController {
  reset(): void;
  setProgress(done: number, total: number, current: string): void;
  startStreaming(): void;
  appendChunk(delta: string): void;
  done(): void;
  error(message: string): void;
  /** Retorna o texto acumulado desde o último `reset()`. */
  getText(): string;
  /** Registra callback invocado ao final do stream com o texto acumulado. */
  onCompleted(handler: (text: string) => void): void;
  /** Registra callback invocado quando o estado muda (após cada setState). */
  onStateChange(handler: (state: StreamState) => void): void;
  /** `true` enquanto o stream está em fetching ou streaming. */
  isBusy(): boolean;
  /**
   * Fase D.2 — quando o stream-box tem stepper de inserção embutido
   * (hoje só o minuta-box), estes callbacks atualizam os 4 passos visuais
   * conforme o orquestrador da Fase C progride pelo state machine.
   * São no-ops para stream-boxes sem stepper (ex.: resumo-box).
   */
  setInsertState?(internalState: string, message: string): void;
  setInsertError?(failedAt: string, message: string, userHint: string): void;
  setInsertDone?(message: string): void;
}

/**
 * API da 1ª rodada do fluxo "Minutar próximo ato".
 *
 * Compartilha o shape de callbacks do `StreamController` (para plugar no
 * mesmo runner de chat), mas a UX é diferente: o texto cru do modelo não
 * é exibido; em vez disso, quando `done()` é chamado, o painel parseia
 * ATO SUGERIDO + JUSTIFICATIVA e apresenta em cartão, seguido dos botões
 * de escolha do ato e orientações.
 */
export interface TriageController {
  reset(): void;
  setProgress(done: number, total: number, current: string): void;
  startStreaming(): void;
  appendChunk(delta: string): void;
  done(): void;
  error(message: string): void;
}

/**
 * API do chat livre: controlada pelo orquestrador (sei-chat.ts) e
 * consumida pelo painel. O orquestrador dispara `appendUserMessage`
 * quando recebe o `onSend`, depois `startAssistantMessage` + uma
 * sequência de `appendAssistantChunk` + `finishAssistantMessage`.
 */
export interface ChatController {
  /** Registra handler acionado quando usuário envia uma pergunta. */
  onSend(handler: (text: string) => void): void;
  appendUserMessage(text: string): void;
  startAssistantMessage(): void;
  appendAssistantChunk(delta: string): void;
  finishAssistantMessage(): void;
  errorAssistantMessage(message: string): void;
  setBusy(busy: boolean, status?: string): void;
  setStatus(status: string): void;
  reset(): void;
}

/**
 * Nível de acesso de um documento administrativo no SEI.
 *
 *  - `publico` é o default legal (Lei 12.527/2011 — LAI);
 *  - `restrito` exige hipótese legal explícita (ex.: "Informação Pessoal
 *    — art. 31 LAI", "Segredo de Justiça — CPC art. 189");
 *  - `sigiloso` é reservado a casos muito específicos do SEI e exige
 *    confirmação adicional do usuário.
 */
export type NivelAcessoTipo = 'publico' | 'restrito' | 'sigiloso';

export interface NivelAcesso {
  tipo: NivelAcessoTipo;
  /** Obrigatório quando `tipo === 'restrito'`. Rotula a hipótese legal. */
  hipotese?: string;
}

/**
 * Resultado do cartão de pré-inserção (Fase D.1): tudo que o orquestrador
 * da Fase C precisa para criar o documento no SEI. O `text` pode diferir
 * da minuta original porque o usuário tem permissão de editar no cartão.
 */
export interface InsertConfirmResult {
  /** Minuta a injetar no CKEditor (pode ter sido editada no cartão). */
  text: string;
  /** Tipo de ato escolhido (ex.: "Despacho", "Ofício"). */
  atoTipo: string;
  /** Descrição do documento (vai para o campo "Descrição" do SEI). */
  descricao: string;
  /** Nível de acesso confirmado pelo usuário. */
  nivelAcesso: NivelAcesso;
  /** Número do processo corrente (quando disponível). */
  numeroProcesso: string | null;
}

export interface PanelController {
  open(): void;
  close(): void;
  toggle(): void;
  setArvore(arvore: ArvoreProcesso): void;
  isOpen(): boolean;
  /** Registra handler para o clique em "Analisar processo administrativo". */
  onResumirClick(handler: () => void): void;
  /** Registra handler para o clique em "Minutar próximo ato". */
  onMinutarClick(handler: () => void): void;
  /**
   * Registra handler para a geração da minuta de um ato específico,
   * disparada pelos botões da zona de refinamento abaixo do minuta-box
   * após a triagem (fase A do fluxo de minutar).
   */
  onMinutarAtoClick(handler: (atoLabel: string, orientations: string | undefined) => void): void;
  /**
   * Ids dos documentos atualmente marcados na seção "Documentos".
   * Só inclui nós do tipo DOCUMENTO com src válido (baixáveis).
   */
  getSelectedDocIds(): Set<string>;
  /**
   * Registra handler acionado **somente** após o usuário confirmar o
   * cartão de pré-inserção (Fase D.1). O handler recebe todos os
   * metadados validados pelo usuário + a minuta (possivelmente editada).
   * O clique bruto no botão "Inserir no processo" abre o cartão; não
   * dispara este handler sem confirmação.
   */
  onInserirMinutaConfirmed(handler: (result: InsertConfirmResult) => void): void;
  /**
   * Registra handler acionado quando o usuário clica "Analisar modelo"
   * dentro da caixa de otimização, recebendo o texto colado.
   */
  onOtimizarRequest(handler: (modeloText: string) => void): void;
  /** API de stream da análise do processo. */
  resumo: StreamController;
  /** API de triagem (1ª rodada do "Minutar próximo ato"). */
  triage: TriageController;
  /** API de stream da minuta final (2ª rodada). */
  minuta: StreamController;
  /** API de stream da otimização de modelo. */
  otimizar: StreamController;
  /** API do chat livre. */
  chat: ChatController;
}

export function mountPanel(): PanelController {
  let host = document.getElementById(HOST_ID) as HTMLDivElement | null;
  if (host) {
    return (host as unknown as { _seirtaoController: PanelController })._seirtaoController;
  }

  host = document.createElement('div');
  host.id = HOST_ID;
  Object.assign(host.style, {
    position: 'fixed',
    top: '0',
    right: '0',
    width: '0',
    height: '100vh',
    zIndex: '2147483647',
    pointerEvents: 'none',
  } as CSSStyleDeclaration);
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = renderShell();

  const panel = shadow.getElementById('panel') as HTMLDivElement;
  const btnClose = shadow.getElementById('btn-close') as HTMLButtonElement;
  const statusEl = shadow.getElementById('status') as HTMLDivElement;
  const listEl = shadow.getElementById('doc-list') as HTMLUListElement;
  const docFilter = shadow.getElementById('doc-filter') as HTMLInputElement;
  const docCounter = shadow.getElementById('doc-counter') as HTMLSpanElement;
  const btnDocsAll = shadow.getElementById('docs-all') as HTMLButtonElement;
  const btnDocsNone = shadow.getElementById('docs-none') as HTMLButtonElement;

  let isOpen = false;
  let currentNumeroProcesso: string | null = null;
  const selectedDocIds = new Set<string>();
  const allSelectableIds = new Set<string>();
  const collapsedFolders = new Set<string>();

  const updateDocCounter = (): void => {
    docCounter.textContent = `${selectedDocIds.size} de ${allSelectableIds.size} selecionados`;
  };

  const applyFolderState = (): void => {
    listEl.querySelectorAll<HTMLLIElement>('li.doc-item').forEach((li) => {
      const raw = li.getAttribute('data-ancestors') ?? '';
      const ancestors = raw.split(',').filter(Boolean);
      const hidden = ancestors.some((id) => collapsedFolders.has(id));
      li.classList.toggle('h-folder', hidden);
    });
  };

  const open = (): void => {
    isOpen = true;
    panel.style.transform = 'translateX(0)';
    const rect = panel.getBoundingClientRect();
    const w = rect.width > 0 ? rect.width : 560;
    host!.style.width = `${w}px`;
    host!.style.pointerEvents = 'auto';
  };
  const close = (): void => {
    isOpen = false;
    panel.style.transform = 'translateX(100%)';
    host!.style.width = '0';
    host!.style.pointerEvents = 'none';
  };
  const toggle = (): void => { if (isOpen) close(); else open(); };

  btnClose.addEventListener('click', close);

  const resumirHandlers: Array<() => void> = [];
  const minutarHandlers: Array<() => void> = [];
  const minutarAtoHandlers: Array<(atoLabel: string, orientations: string | undefined) => void> = [];
  const inserirConfirmedHandlers: Array<(result: InsertConfirmResult) => void> = [];
  const otimizarRequestHandlers: Array<(modeloText: string) => void> = [];

  /**
   * Último ato escolhido pelo usuário (via cartão de triagem ou
   * autocomplete "Escolher outro ato…"). Consumido pelo cartão de
   * pré-inserção para mostrar "Ato: X" e também servir como `atoTipo`
   * no `InsertConfirmResult`.
   */
  let lastAtoLabel: string | null = null;

  const resumoCtl = wireStreamBox(shadow, {
    boxId: 'resumo-box',
    triggerId: 'act-resumir',
    defaultLabel: 'Analisar processo administrativo',
    busyLabel: 'Gerando análise…',
    fileStem: 'analise',
    subject: 'SEIrtão — análise de processo administrativo',
    handlers: resumirHandlers,
    getProcessoNumber: () => currentNumeroProcesso,
  });

  // Cartão de pré-inserção (Fase D.1). Precisa ser criado antes do
  // `minutaCtl` porque o stream-box da minuta recebe o `onInserirClick`
  // que abre este cartão.
  const insertDialog = wireInsertConfirmDialog(shadow, {
    getProcessoNumber: () => currentNumeroProcesso,
    getAtoLabel: () => lastAtoLabel,
    confirmedHandlers: inserirConfirmedHandlers,
  });

  const minutaCtl = wireStreamBox(shadow, {
    boxId: 'minuta-box',
    triggerId: 'act-minutar',
    defaultLabel: 'Minutar próximo ato',
    busyLabel: 'Gerando minuta…',
    fileStem: 'minuta',
    subject: 'SEIrtão — minuta do próximo ato administrativo',
    handlers: minutarHandlers,
    getProcessoNumber: () => currentNumeroProcesso,
    manageTrigger: false,
    onInserirClick: (text: string) => { insertDialog.open(text); },
  });

  const triageCtl = wireMinutaTriage(shadow, {
    handlers: minutarHandlers,
    atoHandlers: minutarAtoHandlers,
    getMinutaState: () => minutaCtl,
  });

  // Rastreia o ato escolhido para exposição ao cartão de pré-inserção.
  minutarAtoHandlers.push((ato) => { lastAtoLabel = ato; });

  // ── Otimizar modelo do SEI ────────────────────────────────────────────
  // O clique em "Analisar modelo" (dentro da caixa de entrada) é o trigger
  // do stream-box — lê o textarea e dispara os handlers externos. O botão
  // principal `#act-otimizar` (topo) rola e foca o textarea, e reseta o
  // stream-box se ele estiver em um estado final (done/error).
  const otimizarHandlers: Array<() => void> = [];
  const otimizarCtl = wireStreamBox(shadow, {
    boxId: 'otimizar-box',
    triggerId: 'otimizar-analyze',
    defaultLabel: 'Analisar modelo',
    busyLabel: 'Otimizando…',
    fileStem: 'modelo-otimizado',
    subject: 'SEIrtão — modelo otimizado',
    handlers: otimizarHandlers,
    getProcessoNumber: () => currentNumeroProcesso,
  });

  const otimizarInput = shadow.getElementById('otimizar-input') as HTMLDivElement;
  const otimizarTextarea = shadow.getElementById('otimizar-textarea') as HTMLTextAreaElement;

  // A caixa de entrada do otimizador é opt-in: só aparece depois que o
  // usuário clica `#act-otimizar` no topo. O stream-box final (`#otimizar-box`)
  // aparece quando o stream começa e volta a sumir quando resetado.
  otimizarCtl.onStateChange((state) => {
    if (state !== 'idle') otimizarInput.dataset['visible'] = 'false';
  });

  otimizarHandlers.push(() => {
    const text = otimizarTextarea.value.trim();
    if (!text) {
      otimizarTextarea.focus();
      return;
    }
    otimizarRequestHandlers.forEach((h) => {
      try { h(text); }
      catch (err) { console.error('[SEIrtão] erro em onOtimizarRequest:', err); }
    });
  });

  (shadow.getElementById('act-otimizar') as HTMLButtonElement).addEventListener('click', () => {
    // Revela a caixa de entrada e reseta o stream-box se ele estiver em
    // estado final. Não limpa o textarea (para o usuário iterar ajustes).
    if (otimizarCtl.isBusy()) return;
    otimizarCtl.reset();
    otimizarInput.dataset['visible'] = 'true';
    otimizarInput.scrollIntoView({ behavior: 'smooth', block: 'start' });
    otimizarTextarea.focus();
  });

  const chatCtl = wireChat(shadow, () => currentNumeroProcesso);

  const applyDocFilter = (): void => {
    const q = docFilter.value.trim().toLowerCase();
    const items = listEl.querySelectorAll<HTMLLIElement>('li.doc-item');
    items.forEach((li) => {
      const label = li.dataset['search'] ?? '';
      li.classList.toggle('h-filter', !!q && !label.includes(q));
    });
  };

  listEl.addEventListener('click', (ev) => {
    const folderEl = (ev.target as HTMLElement).closest<HTMLLIElement>('li.doc-folder');
    if (!folderEl || !listEl.contains(folderEl)) return;
    const id = folderEl.dataset['folderId'];
    if (!id) return;
    if (collapsedFolders.has(id)) collapsedFolders.delete(id);
    else collapsedFolders.add(id);
    folderEl.classList.toggle('collapsed', collapsedFolders.has(id));
    applyFolderState();
  });

  listEl.addEventListener('change', (ev) => {
    const target = ev.target as HTMLInputElement;
    if (target.matches('input[type="checkbox"][data-doc-id]')) {
      const id = target.dataset['docId']!;
      if (target.checked) selectedDocIds.add(id);
      else selectedDocIds.delete(id);
      updateDocCounter();
    }
  });

  btnDocsAll.addEventListener('click', () => {
    selectedDocIds.clear();
    allSelectableIds.forEach((id) => selectedDocIds.add(id));
    listEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-doc-id]')
      .forEach((cb) => { if (!cb.disabled) cb.checked = true; });
    updateDocCounter();
  });
  btnDocsNone.addEventListener('click', () => {
    selectedDocIds.clear();
    listEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-doc-id]')
      .forEach((cb) => { cb.checked = false; });
    updateDocCounter();
  });
  docFilter.addEventListener('input', applyDocFilter);

  const controller: PanelController = {
    open,
    close,
    toggle,
    isOpen: () => isOpen,
    onResumirClick(handler) { resumirHandlers.push(handler); },
    onMinutarClick(handler) { minutarHandlers.push(handler); },
    onMinutarAtoClick(handler) { minutarAtoHandlers.push(handler); },
    onInserirMinutaConfirmed(handler) { inserirConfirmedHandlers.push(handler); },
    onOtimizarRequest(handler) { otimizarRequestHandlers.push(handler); },
    getSelectedDocIds: () => new Set(selectedDocIds),
    resumo: resumoCtl,
    triage: triageCtl,
    minuta: minutaCtl,
    otimizar: otimizarCtl,
    chat: chatCtl,
    setArvore(arvore) {
      if (currentNumeroProcesso && currentNumeroProcesso !== arvore.numeroProcesso) {
        invalidateDocsCache();
      }
      currentNumeroProcesso = arvore.numeroProcesso;
      const tipos = arvore.nos.reduce<Record<string, number>>((acc, n) => {
        acc[n.tipo] = (acc[n.tipo] ?? 0) + 1;
        return acc;
      }, {});
      statusEl.innerHTML = `
        <div class="row"><span class="k">Processo</span><span class="v">${escapeHtml(arvore.numeroProcesso ?? '—')}</span></div>
        <div class="row"><span class="k">Documentos</span><span class="v">${tipos['DOCUMENTO'] ?? 0}</span></div>
        <div class="row"><span class="k">Pastas</span><span class="v">${tipos['PASTA'] ?? 0}</span></div>
      `;

      // Indexa nós por id para calcular ancestrais PASTA a partir de `pai`.
      const byId = new Map<string, NoArvore>();
      arvore.nos.forEach((n) => byId.set(n.id, n));
      const folderAncestorsOf = (n: NoArvore): string[] => {
        const out: string[] = [];
        let cur: NoArvore | undefined = n;
        const seen = new Set<string>();
        while (cur && cur.pai && byId.has(cur.pai) && !seen.has(cur.id)) {
          seen.add(cur.id);
          const parent: NoArvore = byId.get(cur.pai)!;
          if (parent.tipo === 'PASTA') out.push(parent.id);
          cur = parent;
        }
        return out;
      };

      selectedDocIds.clear();
      allSelectableIds.clear();
      collapsedFolders.clear();

      let docsTotal = 0;
      let docsComSrc = 0;

      const itemsHtml: string[] = [];
      for (const n of arvore.nos) {
        if (n.tipo !== 'PASTA' && n.tipo !== 'DOCUMENTO') continue;
        const ancestors = folderAncestorsOf(n);
        const indent = ancestors.length * 14;
        const search = `${n.label} ${n.tooltip}`.toLowerCase();
        const ancAttr = ancestors.length ? ` data-ancestors="${escapeHtml(ancestors.join(','))}"` : '';
        if (n.tipo === 'PASTA') {
          itemsHtml.push(
            `<li class="doc-item doc-folder" data-folder-id="${escapeHtml(n.id)}"${ancAttr} ` +
            `data-search="${escapeHtml(search)}" ` +
            `style="padding-left:${indent + 6}px" title="${escapeHtml(n.tooltip)}">` +
            `<span class="folder-label">${escapeHtml(n.label)}</span></li>`
          );
        } else {
          docsTotal++;
          const hasSrc = !!n.src;
          if (hasSrc) docsComSrc++;
          allSelectableIds.add(n.id);
          selectedDocIds.add(n.id);
          itemsHtml.push(
            `<li class="doc-item doc-file${hasSrc ? '' : ' no-src'}"${ancAttr} ` +
            `data-search="${escapeHtml(search)}" ` +
            `style="padding-left:${indent + 6}px" title="${escapeHtml(n.tooltip)}">` +
            `<label><input type="checkbox" data-doc-id="${escapeHtml(n.id)}" checked />` +
            `<span>${escapeHtml(n.label)}</span></label></li>`
          );
        }
      }
      listEl.innerHTML = itemsHtml.join('');
      console.log('[SEIrtão/panel] documentos:', {
        total: docsTotal,
        comSrc: docsComSrc,
        semSrc: docsTotal - docsComSrc,
        pastas: arvore.nos.filter((n) => n.tipo === 'PASTA').length,
      });
      docFilter.value = '';
      applyFolderState();
      updateDocCounter();
    },
  };
  (host as unknown as { _seirtaoController: PanelController })._seirtaoController = controller;
  return controller;
}

interface StreamBoxWiring {
  boxId: string;
  triggerId: string;
  defaultLabel: string;
  busyLabel: string;
  /** Radical usado para nomear os arquivos baixados (.doc / .pdf). */
  fileStem: string;
  /** Assunto padrão do e-mail gerado. */
  subject: string;
  handlers: Array<() => void>;
  getProcessoNumber(): string | null;
  /**
   * Quando false, o stream controller não manipula o estado do botão
   * trigger (disabled / label). Usado para o minuta-box, cujo botão
   * `#act-minutar` é gerenciado pelo `wireMinutaTriage` (que abrange os
   * dois estados do fluxo — triagem e geração da minuta final).
   */
  manageTrigger?: boolean;
  /**
   * Se fornecido, injeta um botão extra "Inserir no processo" na toolbar
   * do stream-box, posicionado antes do botão "E-mail". Acionado apenas
   * quando há texto acumulado; chama o callback passando o texto atual.
   *
   * No fluxo da minuta, este callback abre o cartão de pré-inserção
   * (Fase D.1); a Fase C só roda **depois** que o usuário confirma.
   */
  onInserirClick?: (text: string) => void;
}

/**
 * Conecta um box de streaming (resumo ou minuta) aos seus controles:
 * botão de disparo, barra de progresso, área de saída e toolbar de 5 ações.
 */
function wireStreamBox(shadow: ShadowRoot, w: StreamBoxWiring): StreamController {
  const box = shadow.getElementById(w.boxId) as HTMLDivElement;
  const trigger = shadow.getElementById(w.triggerId) as HTMLButtonElement;
  const triggerLabel = trigger.querySelector<HTMLSpanElement>('.btn-label')!;
  const progFill = box.querySelector<HTMLDivElement>('.stream-progress-fill')!;
  const progText = box.querySelector<HTMLDivElement>('.stream-progress-text')!;
  const outputEl = box.querySelector<HTMLDivElement>('.stream-output')!;
  const errorEl = box.querySelector<HTMLDivElement>('.stream-error')!;
  const btnCopy = box.querySelector<HTMLButtonElement>('[data-act="copy"]')!;
  const btnDoc = box.querySelector<HTMLButtonElement>('[data-act="doc"]')!;
  const btnPdf = box.querySelector<HTMLButtonElement>('[data-act="pdf"]')!;
  const btnReset = box.querySelector<HTMLButtonElement>('[data-act="reset"]')!;
  const btnMail = box.querySelector<HTMLButtonElement>('[data-act="mail"]')!;

  const stepper = box.querySelector<HTMLDivElement>('.insert-stepper');
  const stepperStatus = stepper?.querySelector<HTMLDivElement>('.insert-stepper-status') ?? null;
  const stepperDone = stepper?.querySelector<HTMLDivElement>('.insert-stepper-done') ?? null;
  const stepperFail = stepper?.querySelector<HTMLDivElement>('.insert-stepper-fail') ?? null;
  const stepperFailMsg = stepper?.querySelector<HTMLDivElement>('.insert-stepper-fail-msg') ?? null;
  const stepperFailHint = stepper?.querySelector<HTMLDivElement>('.insert-stepper-fail-hint') ?? null;

  let state: StreamState = 'idle';
  let accumulated = '';
  const completedHandlers: Array<(text: string) => void> = [];
  const stateHandlers: Array<(state: StreamState) => void> = [];
  const manageTrigger = w.manageTrigger ?? true;

  const setState = (next: StreamState): void => {
    state = next;
    box.dataset['state'] = next;
    if (manageTrigger) {
      const busy = next === 'fetching' || next === 'streaming';
      trigger.disabled = busy;
      triggerLabel.textContent = busy ? w.busyLabel : w.defaultLabel;
    }
    stateHandlers.forEach((h) => {
      try { h(next); } catch (err) { console.error('[SEIrtão] erro em onStateChange:', err); }
    });
  };

  if (manageTrigger) {
    trigger.addEventListener('click', () => {
      if (state === 'fetching' || state === 'streaming') return;
      w.handlers.forEach((h) => h());
    });
  }

  if (w.onInserirClick) {
    const onInserirClick = w.onInserirClick;
    const btnInserir = document.createElement('button');
    btnInserir.type = 'button';
    btnInserir.dataset['act'] = 'inserir';
    btnInserir.title = 'Inserir a minuta como novo documento no processo';
    btnInserir.textContent = 'Inserir no processo';
    const toolbar = box.querySelector<HTMLDivElement>('.stream-toolbar')!;
    const btnMailRef = toolbar.querySelector<HTMLButtonElement>('[data-act="mail"]');
    toolbar.insertBefore(btnInserir, btnMailRef);
    btnInserir.addEventListener('click', () => {
      if (!accumulated) return;
      try { onInserirClick(accumulated); }
      catch (err) { console.error('[SEIrtão] erro em onInserirClick:', err); }
    });
  }

  btnCopy.addEventListener('click', () => {
    if (!accumulated) return;
    navigator.clipboard?.writeText(accumulated).then(
      () => { btnCopy.textContent = 'Copiado!'; window.setTimeout(() => { btnCopy.textContent = 'Copiar'; }, 1500); },
      () => { btnCopy.textContent = 'Falhou'; window.setTimeout(() => { btnCopy.textContent = 'Copiar'; }, 1500); },
    );
  });

  btnDoc.addEventListener('click', () => {
    if (!accumulated) return;
    const filename = buildFilename(w.fileStem, w.getProcessoNumber(), 'doc');
    downloadAsDoc(accumulated, filename, w.subject);
  });

  btnPdf.addEventListener('click', () => {
    if (!accumulated) return;
    const filename = buildFilename(w.fileStem, w.getProcessoNumber(), 'pdf');
    openPrintWindow(accumulated, filename, w.subject);
  });

  btnMail.addEventListener('click', () => {
    if (!accumulated) return;
    const numero = w.getProcessoNumber();
    const subject = numero ? `${w.subject} — ${numero}` : w.subject;
    const maxBody = 1800;
    const body = accumulated.length > maxBody
      ? accumulated.slice(0, maxBody) + '\n\n[…texto truncado para caber no corpo do e-mail. O texto completo está disponível no painel do SEIrtão.]'
      : accumulated;
    const href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
  });

  const resetStepper = (): void => {
    if (!stepper) return;
    stepper.dataset['visible'] = 'false';
    stepper.dataset['phase'] = 'idle';
    stepper.querySelectorAll<HTMLLIElement>('.insert-step').forEach((li) => {
      li.classList.remove('insert-step--active', 'insert-step--done', 'insert-step--error');
    });
    if (stepperStatus) stepperStatus.textContent = '';
    if (stepperDone) stepperDone.dataset['visible'] = 'false';
    if (stepperFail) stepperFail.dataset['visible'] = 'false';
    if (stepperFailMsg) stepperFailMsg.textContent = '';
    if (stepperFailHint) stepperFailHint.textContent = '';
  };

  const reset = (): void => {
    accumulated = '';
    outputEl.textContent = '';
    errorEl.textContent = '';
    progFill.style.width = '0%';
    progText.textContent = '';
    resetStepper();
    setState('idle');
  };

  btnReset.addEventListener('click', reset);

  const STEP_FOR_INTERNAL: Record<string, 'incluir' | 'tipo' | 'cadastrar' | 'editor' | 'injetar' | null> = {
    'idle': null,
    'clicking-incluir': 'incluir',
    'await-tipo': 'incluir',
    'selecting-tipo': 'tipo',
    'await-cadastrar': 'tipo',
    'filling-cadastrar': 'cadastrar',
    'submitting': 'cadastrar',
    'await-editor': 'editor',
    'injecting': 'injetar',
    'done': 'injetar',
    'error': null,
  };
  const STEP_ORDER: Array<'incluir' | 'tipo' | 'cadastrar' | 'editor' | 'injetar'> = [
    'incluir', 'tipo', 'cadastrar', 'editor', 'injetar',
  ];
  const markStepper = (activeStep: 'incluir' | 'tipo' | 'cadastrar' | 'editor' | 'injetar' | null): void => {
    if (!stepper) return;
    const steps = stepper.querySelectorAll<HTMLLIElement>('.insert-step');
    const idx = activeStep ? STEP_ORDER.indexOf(activeStep) : -1;
    steps.forEach((li) => {
      const id = li.dataset['step'] as typeof STEP_ORDER[number];
      const i = STEP_ORDER.indexOf(id);
      li.classList.remove('insert-step--active', 'insert-step--done', 'insert-step--error');
      if (idx === -1) return;
      if (i < idx) li.classList.add('insert-step--done');
      else if (i === idx) li.classList.add('insert-step--active');
    });
  };

  return {
    reset,
    setProgress(done, total, current) {
      setState('fetching');
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      progFill.style.width = `${pct}%`;
      progText.textContent = `Lendo ${done}/${total} — ${current}`;
    },
    startStreaming() {
      setState('streaming');
      progText.textContent = 'Gerando conteúdo…';
      progFill.style.width = '100%';
    },
    appendChunk(delta) {
      if (state !== 'streaming') setState('streaming');
      accumulated += delta;
      outputEl.textContent = accumulated;
      outputEl.scrollTop = outputEl.scrollHeight;
    },
    done() {
      setState('done');
      progText.textContent = `Pronto — ${accumulated.length.toLocaleString('pt-BR')} caracteres.`;
      const text = accumulated;
      completedHandlers.forEach((h) => {
        try { h(text); } catch (err) { console.error('[SEIrtão] erro em onCompleted:', err); }
      });
    },
    error(message) {
      setState('error');
      errorEl.textContent = message;
    },
    getText() { return accumulated; },
    onCompleted(handler) { completedHandlers.push(handler); },
    onStateChange(handler) { stateHandlers.push(handler); },
    isBusy() { return state === 'fetching' || state === 'streaming'; },
    setInsertState(internalState, message) {
      if (!stepper) return;
      stepper.dataset['visible'] = 'true';
      stepper.dataset['phase'] = internalState;
      if (stepperDone) stepperDone.dataset['visible'] = 'false';
      if (stepperFail) stepperFail.dataset['visible'] = 'false';
      markStepper(STEP_FOR_INTERNAL[internalState] ?? null);
      if (stepperStatus) stepperStatus.textContent = message;
      if (internalState === 'done') {
        stepper.querySelectorAll<HTMLLIElement>('.insert-step').forEach((li) => {
          li.classList.remove('insert-step--active');
          li.classList.add('insert-step--done');
        });
        if (stepperDone) stepperDone.dataset['visible'] = 'true';
      }
    },
    setInsertError(failedAt, message, userHint) {
      if (!stepper) return;
      stepper.dataset['visible'] = 'true';
      stepper.dataset['phase'] = 'error';
      const step = STEP_FOR_INTERNAL[failedAt] ?? null;
      if (step) {
        const li = stepper.querySelector<HTMLLIElement>(`.insert-step[data-step="${step}"]`);
        li?.classList.add('insert-step--error');
        li?.classList.remove('insert-step--active');
      }
      if (stepperStatus) stepperStatus.textContent = '';
      if (stepperFail) stepperFail.dataset['visible'] = 'true';
      if (stepperFailMsg) stepperFailMsg.textContent = message;
      if (stepperFailHint) stepperFailHint.textContent = userHint;
    },
    setInsertDone(message) {
      if (!stepper) return;
      stepper.dataset['visible'] = 'true';
      stepper.dataset['phase'] = 'done';
      stepper.querySelectorAll<HTMLLIElement>('.insert-step').forEach((li) => {
        li.classList.remove('insert-step--active', 'insert-step--error');
        li.classList.add('insert-step--done');
      });
      if (stepperStatus) stepperStatus.textContent = message;
      if (stepperDone) stepperDone.dataset['visible'] = 'true';
    },
  };
}

/**
 * Liga toda a experiência da 1ª rodada do "Minutar próximo ato":
 *
 *  1. cuida do botão `#act-minutar` (label/disabled);
 *  2. recebe progresso + stream silencioso via `TriageController`;
 *  3. quando termina, parseia ATO + JUSTIFICATIVA e exibe em cartão;
 *  4. mostra os botões [Gerar minuta deste ato] / [Escolher outro ato];
 *  5. se o usuário escolher outro ato, abre autocomplete catálogo+tipos;
 *  6. depois do ato escolhido, abre painel de orientações com dois
 *     botões: [Sem orientações — gerar] / [Gerar com orientações].
 *  7. finalmente dispara `minutarAtoHandlers` com (ato, orientações?),
 *     que o bootstrap usa para chamar `minutarAtoEspecifico` e alimentar
 *     o `#minuta-box` (streambox final).
 *
 * Retorna um `TriageController` consumido pelo bootstrap para plugar o
 * runner de chat à UI desta primeira rodada.
 */
function wireMinutaTriage(
  shadow: ShadowRoot,
  w: {
    handlers: Array<() => void>;
    atoHandlers: Array<(atoLabel: string, orientations: string | undefined) => void>;
    getMinutaState: () => StreamController;
  },
): TriageController {
  const root = shadow.getElementById('minuta-triage') as HTMLDivElement;
  const trigger = shadow.getElementById('act-minutar') as HTMLButtonElement;
  const triggerLabel = trigger.querySelector<HTMLSpanElement>('.btn-label')!;

  const progFill = root.querySelector<HTMLDivElement>('.stream-progress-fill')!;
  const progText = root.querySelector<HTMLDivElement>('.stream-progress-text')!;
  const errorEl = root.querySelector<HTMLDivElement>('.stream-error')!;
  const atoValueEl = root.querySelector<HTMLDivElement>('.triage-ato')!;
  const justValueEl = root.querySelector<HTMLDivElement>('.triage-justificativa')!;
  const btnGerarSug = root.querySelector<HTMLButtonElement>('[data-act="gerar-sugerido"]')!;
  const btnEscolherOutro = root.querySelector<HTMLButtonElement>('[data-act="escolher-outro"]')!;

  const picker = root.querySelector<HTMLDivElement>('.minuta-refine-picker')!;
  const pickerInput = root.querySelector<HTMLInputElement>('#minuta-refine-ato')!;
  const pickerList = root.querySelector<HTMLDivElement>('#minuta-refine-suggestions')!;
  const btnPickerCancel = root.querySelector<HTMLButtonElement>('[data-act="picker-cancel"]')!;
  const btnPickerGo = root.querySelector<HTMLButtonElement>('[data-act="picker-go"]')!;

  const orientPanel = root.querySelector<HTMLDivElement>('.minuta-refine-orient')!;
  const orientAtoNameEl = root.querySelector<HTMLSpanElement>('.orient-ato-name')!;
  const orientText = root.querySelector<HTMLTextAreaElement>('#minuta-refine-orient-text')!;
  const btnOrientBack = root.querySelector<HTMLButtonElement>('[data-act="orient-back"]')!;
  const btnOrientSkip = root.querySelector<HTMLButtonElement>('[data-act="orient-skip"]')!;
  const btnOrientGo = root.querySelector<HTMLButtonElement>('[data-act="orient-go"]')!;

  let accumulated = '';
  let suggestedAtoLabel: string | null = null;
  let chosenAtoLabel: string | null = null;
  let pickerChoice: string | null = null;
  let triageBusy = false;

  const show = (el: HTMLElement): void => { el.setAttribute('data-visible', 'true'); };
  const hide = (el: HTMLElement): void => { el.setAttribute('data-visible', 'false'); };

  const setRootState = (next: 'idle' | 'fetching' | 'streaming' | 'done' | 'error'): void => {
    root.dataset['state'] = next;
  };

  const updateTriggerUI = (): void => {
    const minutaBusy = w.getMinutaState().isBusy();
    if (triageBusy) {
      trigger.disabled = true;
      triggerLabel.textContent = 'Analisando processo…';
    } else if (minutaBusy) {
      trigger.disabled = true;
      triggerLabel.textContent = 'Gerando minuta…';
    } else {
      trigger.disabled = false;
      triggerLabel.textContent = 'Minutar próximo ato';
    }
  };

  trigger.addEventListener('click', () => {
    if (triageBusy) return;
    if (w.getMinutaState().isBusy()) return;
    // Reset visual completo ao iniciar nova triagem.
    accumulated = '';
    suggestedAtoLabel = null;
    chosenAtoLabel = null;
    pickerChoice = null;
    atoValueEl.textContent = '';
    justValueEl.textContent = '';
    errorEl.textContent = '';
    progFill.style.width = '0%';
    progText.textContent = 'Analisando processo…';
    hide(picker);
    hide(orientPanel);
    setRootState('fetching');
    show(root);
    triageBusy = true;
    updateTriggerUI();
    w.handlers.forEach((h) => h());
  });

  const fire = (ato: string, orientations: string | undefined): void => {
    chosenAtoLabel = ato;
    hide(picker);
    hide(orientPanel);
    // Esconde o cartão da triagem — agora a stream final toma o palco.
    setRootState('idle');
    hide(root);
    w.atoHandlers.forEach((h) => {
      try { h(ato, orientations); } catch (err) { console.error('[SEIrtão] erro em onMinutarAtoClick:', err); }
    });
  };

  const openOrient = (ato: string): void => {
    chosenAtoLabel = ato;
    orientAtoNameEl.textContent = ato;
    orientText.value = '';
    hide(picker);
    show(orientPanel);
    orientText.focus();
  };

  const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const getAllCandidates = (): string[] => {
    const catalog = ATOS_ADMINISTRATIVOS.map((a) => a.label);
    const discovered = peekDocumentTypes() ?? [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of [...catalog, ...discovered]) {
      const key = n.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(n);
    }
    return out;
  };

  const renderSuggestions = (query: string): void => {
    const candidates = getAllCandidates();
    const normalized = query.trim().toLowerCase();
    let filtered = candidates;
    if (normalized) {
      const rx = new RegExp(escapeRe(normalized), 'i');
      filtered = candidates.filter((c) => rx.test(c));
    }
    if (filtered.length === 0) {
      pickerList.innerHTML =
        `<div class="minuta-refine-empty">Nenhum ato/tipo encontrado. Você pode digitar um nome livre e clicar "Continuar".</div>`;
      pickerChoice = normalized ? query.trim() : null;
      btnPickerGo.disabled = !pickerChoice;
      return;
    }
    pickerList.innerHTML = filtered
      .slice(0, 80)
      .map(
        (name) =>
          `<button type="button" class="minuta-refine-suggestion" data-name="${escapeHtml(name)}" role="option">${escapeHtml(name)}</button>`,
      )
      .join('');
  };

  btnGerarSug.addEventListener('click', () => {
    if (suggestedAtoLabel) openOrient(suggestedAtoLabel);
  });

  btnEscolherOutro.addEventListener('click', () => {
    hide(orientPanel);
    show(picker);
    pickerInput.value = '';
    pickerChoice = null;
    btnPickerGo.disabled = true;
    renderSuggestions('');
    void discoverDocumentTypes().then((types) => {
      if (types.length > 0 && picker.getAttribute('data-visible') === 'true') {
        renderSuggestions(pickerInput.value);
      }
    });
    pickerInput.focus();
  });

  pickerInput.addEventListener('input', () => {
    pickerChoice = pickerInput.value.trim() || null;
    btnPickerGo.disabled = !pickerChoice;
    renderSuggestions(pickerInput.value);
  });

  pickerList.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('.minuta-refine-suggestion');
    if (!btn) return;
    const name = btn.dataset['name'];
    if (!name) return;
    pickerInput.value = name;
    pickerChoice = name;
    btnPickerGo.disabled = false;
  });

  btnPickerCancel.addEventListener('click', () => { hide(picker); });
  btnPickerGo.addEventListener('click', () => {
    if (!pickerChoice) return;
    openOrient(pickerChoice);
  });

  btnOrientBack.addEventListener('click', () => { hide(orientPanel); });
  btnOrientSkip.addEventListener('click', () => {
    const ato = chosenAtoLabel ?? suggestedAtoLabel;
    if (!ato) { alert('SEIrtão — escolha antes um ato.'); return; }
    fire(ato, undefined);
  });
  btnOrientGo.addEventListener('click', () => {
    const text = orientText.value.trim();
    const ato = chosenAtoLabel ?? suggestedAtoLabel;
    if (!ato) { alert('SEIrtão — escolha antes um ato.'); return; }
    fire(ato, text || undefined);
  });

  // Hook-in: mantém o label do #act-minutar sincronizado com o estado da
  // 2ª rodada (minuta-box), que é gerenciado por outro controller.
  w.getMinutaState().onStateChange(() => { updateTriggerUI(); });

  return {
    reset() {
      accumulated = '';
      suggestedAtoLabel = null;
      chosenAtoLabel = null;
      pickerChoice = null;
      atoValueEl.textContent = '';
      justValueEl.textContent = '';
      errorEl.textContent = '';
      progFill.style.width = '0%';
      progText.textContent = '';
      hide(picker);
      hide(orientPanel);
      setRootState('idle');
      hide(root);
      triageBusy = false;
      updateTriggerUI();
    },
    setProgress(done, total, current) {
      setRootState('fetching');
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      progFill.style.width = `${pct}%`;
      progText.textContent = `Analisando processo… ${done}/${total} — ${current}`;
      show(root);
    },
    startStreaming() {
      setRootState('streaming');
      progText.textContent = 'Analisando processo…';
      progFill.style.width = '100%';
    },
    appendChunk(delta) {
      accumulated += delta;
    },
    done() {
      triageBusy = false;
      updateTriggerUI();
      const parsed = parseMinutarResult(accumulated);
      if (parsed && parsed.ato) {
        suggestedAtoLabel = parsed.ato;
        atoValueEl.textContent = parsed.ato;
        justValueEl.textContent = parsed.justificativa || '(sem justificativa)';
        btnGerarSug.textContent = `Gerar minuta deste ato: ${parsed.ato}`;
        setRootState('done');
      } else {
        errorEl.textContent = 'Não foi possível identificar o ato sugerido no texto retornado pelo modelo. Use "Escolher outro ato…" abaixo.';
        atoValueEl.textContent = '—';
        justValueEl.textContent = accumulated.slice(0, 600) || '(resposta vazia)';
        btnGerarSug.textContent = 'Gerar minuta deste ato';
        setRootState('error');
      }
      show(root);
    },
    error(message) {
      triageBusy = false;
      updateTriggerUI();
      setRootState('error');
      errorEl.textContent = message;
      show(root);
    },
  };
}

/**
 * Hipóteses legais mais comuns para documentos com nível de acesso
 * "Restrito" no SEI/TRF5. A lista é curada: cobre 95% dos casos internos
 * da JFCE. Para hipóteses menos comuns o usuário continua o cadastro
 * manualmente no próprio SEI.
 */
const HIPOTESES_LEGAIS_RESTRITO: ReadonlyArray<string> = [
  'Informação Pessoal — art. 31 da Lei 12.527/2011 (LAI)',
  'Segredo de Justiça — art. 189 do CPC',
  'Sigilo Empresarial — art. 22 da Lei 12.527/2011 (LAI)',
  'Controle Interno / PAD — art. 150 da Lei 8.112/1990',
  'Investigação — art. 7º, §3º da Lei 12.527/2011 (LAI)',
];

/**
 * Cartão de pré-inserção (Fase D.1 — revisão humana obrigatória).
 *
 * Abre um overlay modal com:
 *  - resumo (processo + ato);
 *  - descrição editável (prefill: "{ato} — {data}");
 *  - radio de nível de acesso + dropdown de hipótese legal (quando restrito);
 *  - textarea com a minuta (permite ajuste final);
 *  - checklist de 3 confirmações obrigatórias;
 *  - botões Cancelar / Iniciar inserção (este fica `disabled` até que
 *    todos os requisitos sejam satisfeitos).
 *
 * Quando o usuário confirma, o cartão empacota tudo em `InsertConfirmResult`
 * e dispara `confirmedHandlers`. Nenhum byte é enviado ao SEI daqui — a
 * Fase C é que assume e executa os 4 passos.
 */
function wireInsertConfirmDialog(
  shadow: ShadowRoot,
  w: {
    getProcessoNumber: () => string | null;
    getAtoLabel: () => string | null;
    confirmedHandlers: Array<(result: InsertConfirmResult) => void>;
  },
): { open(text: string): void } {
  const overlay = shadow.getElementById('insert-overlay') as HTMLDivElement;
  const dialog = shadow.getElementById('insert-dialog') as HTMLDivElement;
  const numeroEl = dialog.querySelector<HTMLSpanElement>('[data-field="numero"]')!;
  const atoEl = dialog.querySelector<HTMLSpanElement>('[data-field="ato"]')!;
  const descricaoEl = dialog.querySelector<HTMLInputElement>('[data-field="descricao"]')!;
  const textEl = dialog.querySelector<HTMLTextAreaElement>('[data-field="text"]')!;
  const hipoteseEl = dialog.querySelector<HTMLSelectElement>('[data-field="hipotese"]')!;
  const hipoteseWrap = dialog.querySelector<HTMLDivElement>('.insert-hipotese-wrap')!;
  const nivelRadios = Array.from(dialog.querySelectorAll<HTMLInputElement>('input[name="insert-nivel"]'));
  const checkboxes = Array.from(dialog.querySelectorAll<HTMLInputElement>('input[data-check]'));
  const btnCancel = dialog.querySelector<HTMLButtonElement>('[data-act="cancel"]')!;
  const btnClose = dialog.querySelector<HTMLButtonElement>('[data-act="close"]')!;
  const btnGo = dialog.querySelector<HTMLButtonElement>('[data-act="go"]')!;
  const warnEl = dialog.querySelector<HTMLDivElement>('.insert-warn')!;

  const getSelectedNivel = (): NivelAcessoTipo | null => {
    const checked = nivelRadios.find((r) => r.checked);
    return (checked?.value as NivelAcessoTipo | undefined) ?? null;
  };

  const refreshGoButtonState = (): void => {
    const nivel = getSelectedNivel();
    const allChecked = checkboxes.every((c) => c.checked);
    const hipoteseOk = nivel !== 'restrito' || hipoteseEl.value.trim().length > 0;
    const hasText = textEl.value.trim().length > 0;
    btnGo.disabled = !(nivel && allChecked && hipoteseOk && hasText);
  };

  const refreshHipoteseVisibility = (): void => {
    const nivel = getSelectedNivel();
    if (nivel === 'restrito') {
      hipoteseWrap.setAttribute('data-visible', 'true');
    } else {
      hipoteseWrap.setAttribute('data-visible', 'false');
      hipoteseEl.value = '';
    }
    warnEl.textContent = nivel === 'sigiloso'
      ? 'Atenção: "Sigiloso" é reservado a processos que já possuem credencial de sigilo no SEI. Confirme antes de prosseguir.'
      : '';
  };

  const close = (): void => {
    overlay.setAttribute('data-visible', 'false');
  };

  const populateHipotesesSelect = (): void => {
    hipoteseEl.innerHTML =
      '<option value="">Selecione a hipótese legal…</option>' +
      HIPOTESES_LEGAIS_RESTRITO.map((h) => `<option value="${escapeHtml(h)}">${escapeHtml(h)}</option>`).join('');
  };

  populateHipotesesSelect();

  nivelRadios.forEach((r) => r.addEventListener('change', () => {
    refreshHipoteseVisibility();
    refreshGoButtonState();
  }));
  hipoteseEl.addEventListener('change', refreshGoButtonState);
  checkboxes.forEach((c) => c.addEventListener('change', refreshGoButtonState));
  textEl.addEventListener('input', refreshGoButtonState);

  btnCancel.addEventListener('click', close);
  btnClose.addEventListener('click', close);
  overlay.addEventListener('click', (ev) => {
    // Clique fora do dialog (no backdrop) cancela; clique no dialog não.
    if (ev.target === overlay) close();
  });

  btnGo.addEventListener('click', () => {
    if (btnGo.disabled) return;
    const nivel = getSelectedNivel();
    if (!nivel) return;
    const text = textEl.value.trim();
    const descricao = descricaoEl.value.trim();
    const atoTipo = w.getAtoLabel() ?? '';
    const numeroProcesso = w.getProcessoNumber();
    const hipotese = nivel === 'restrito' ? hipoteseEl.value.trim() : undefined;

    const result: InsertConfirmResult = {
      text,
      atoTipo,
      descricao,
      nivelAcesso: hipotese ? { tipo: nivel, hipotese } : { tipo: nivel },
      numeroProcesso,
    };

    close();
    w.confirmedHandlers.forEach((h) => {
      try { h(result); }
      catch (err) { console.error('[SEIrtão] erro em onInserirMinutaConfirmed:', err); }
    });
  });

  return {
    open(text: string): void {
      const numero = w.getProcessoNumber();
      const ato = w.getAtoLabel();
      numeroEl.textContent = numero ?? '—';
      atoEl.textContent = ato ?? '(não definido — escolha um ato antes)';

      // Prefill da descrição: "{ato} — dd/mm/aaaa".
      const today = new Date().toLocaleDateString('pt-BR');
      descricaoEl.value = ato ? `${ato} — ${today}` : today;

      textEl.value = text;

      // Reset dos radios + hipótese + checklist a cada abertura —
      // nunca herda estado de uma inserção anterior.
      nivelRadios.forEach((r) => { r.checked = false; });
      hipoteseEl.value = '';
      checkboxes.forEach((c) => { c.checked = false; });

      refreshHipoteseVisibility();
      refreshGoButtonState();
      overlay.setAttribute('data-visible', 'true');

      window.setTimeout(() => { descricaoEl.focus(); descricaoEl.select(); }, 60);
    },
  };
}

/** Monta nome de arquivo `{stem}-{numeroProcesso}.{ext}` com fallback. */
function buildFilename(stem: string, numero: string | null, ext: 'doc' | 'pdf'): string {
  const numeroSafe = (numero ?? 'processo').replace(/[^0-9A-Za-z-]+/g, '');
  return `${stem}-${numeroSafe}.${ext}`;
}

/**
 * Dispara download de um `.doc` (RTF-style HTML) com o texto do stream.
 * Word abre HTML com esse mimetype sem problema.
 */
function downloadAsDoc(text: string, filename: string, title: string): void {
  const html = buildPrintableHtml(text, title);
  const header =
    '<html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
    'xmlns:w="urn:schemas-microsoft-com:office:word" ' +
    'xmlns="http://www.w3.org/TR/REC-html40">';
  const blob = new Blob(['\ufeff', header, html, '</html>'], { type: 'application/msword' });
  triggerBlobDownload(blob, filename);
}

/**
 * Abre janela com o conteúdo e aciona `window.print()`. O usuário escolhe
 * "Salvar como PDF" no diálogo — solução sem dependências, comum em
 * extensões que não têm acesso ao jsPDF/puppeteer.
 */
function openPrintWindow(text: string, filename: string, title: string): void {
  const html = buildPrintableHtml(text, title, filename);
  const win = window.open('', '_blank', 'noopener,width=900,height=700');
  if (!win) {
    alert('SEIrtão — o navegador bloqueou a abertura de janela. Libere pop-ups para este site e tente de novo.');
    return;
  }
  win.document.open();
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(filename)}</title></head><body>${html}<script>setTimeout(function(){window.print();},300);</script></body></html>`);
  win.document.close();
}

/** Converte texto em HTML seguro, preservando quebras de linha. */
function buildPrintableHtml(text: string, title: string, filename?: string): string {
  const heading = escapeHtml(filename ?? title);
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`) // parágrafo simples
    .join('');
  return `
    <style>
      body { font-family: "Calibri","Segoe UI",Arial,sans-serif; font-size: 12pt; color: #111; line-height: 1.5; padding: 24px; }
      h1 { font-size: 14pt; border-bottom: 1px solid #888; padding-bottom: 6px; margin-bottom: 16px; }
      p { margin: 0 0 10pt; white-space: pre-wrap; word-wrap: break-word; }
    </style>
    <h1>${heading}</h1>
    ${paragraphs}
  `;
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Conecta a seção "Chat livre": mensagens, textarea, botão enviar e
 * botão limpar. O parsing do texto para Markdown é intencionalmente
 * omitido — mensagens são `textContent`, preservando `\n` com
 * `white-space: pre-wrap`.
 */
function wireChat(shadow: ShadowRoot, getProcessoNumber: () => string | null): ChatController {
  const messagesEl = shadow.getElementById('chat-messages') as HTMLDivElement;
  const formEl = shadow.getElementById('chat-form') as HTMLFormElement;
  const inputEl = shadow.getElementById('chat-input') as HTMLTextAreaElement;
  const btnSend = shadow.getElementById('chat-send') as HTMLButtonElement;
  const btnClear = shadow.getElementById('chat-clear') as HTMLButtonElement;
  const btnMic = shadow.getElementById('chat-mic') as HTMLButtonElement;
  const micLabel = btnMic.querySelector<HTMLSpanElement>('.mic-label')!;
  const statusEl = shadow.getElementById('chat-status') as HTMLDivElement;

  wireMicrophone(btnMic, micLabel, inputEl, statusEl);

  const handlers: Array<(text: string) => void> = [];
  let currentAssistantWrap: HTMLDivElement | null = null;
  let currentAssistantBody: HTMLDivElement | null = null;
  let assistantAccumulated = '';

  const submit = (): void => {
    const text = inputEl.value.trim();
    if (!text) return;
    if (btnSend.disabled) return;
    handlers.forEach((h) => h(text));
  };

  formEl.addEventListener('submit', (ev) => {
    ev.preventDefault();
    submit();
  });

  inputEl.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      submit();
    }
  });

  btnClear.addEventListener('click', () => {
    messagesEl.innerHTML = '';
    statusEl.textContent = '';
    currentAssistantWrap = null;
    currentAssistantBody = null;
    assistantAccumulated = '';
  });

  const appendMessage = (role: 'user' | 'assistant', text: string): { wrap: HTMLDivElement; body: HTMLDivElement } => {
    const wrap = document.createElement('div');
    wrap.className = `chat-msg ${role}`;
    const roleEl = document.createElement('div');
    roleEl.className = 'chat-role';
    roleEl.textContent = role === 'user' ? 'Você' : 'SEIrtão';
    const bodyEl = document.createElement('div');
    bodyEl.className = 'chat-body';
    bodyEl.textContent = text;
    wrap.appendChild(roleEl);
    wrap.appendChild(bodyEl);
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return { wrap, body: bodyEl };
  };

  const buildAssistantToolbar = (text: string): HTMLDivElement => {
    const bar = document.createElement('div');
    bar.className = 'chat-msg-actions';

    const mk = (label: string, act: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chat-msg-act';
      b.dataset['act'] = act;
      b.textContent = label;
      return b;
    };

    const btnCopy = mk('Copiar', 'copy');
    const btnDoc = mk('Baixar .doc', 'doc');
    const btnPdf = mk('Baixar PDF', 'pdf');
    const btnMail = mk('E-mail', 'mail');

    btnCopy.addEventListener('click', () => {
      navigator.clipboard?.writeText(text).then(
        () => { btnCopy.textContent = 'Copiado!'; window.setTimeout(() => { btnCopy.textContent = 'Copiar'; }, 1500); },
        () => { btnCopy.textContent = 'Falhou'; window.setTimeout(() => { btnCopy.textContent = 'Copiar'; }, 1500); },
      );
    });
    btnDoc.addEventListener('click', () => {
      const filename = buildFilename('chat', getProcessoNumber(), 'doc');
      downloadAsDoc(text, filename, 'SEIrtão — resposta do chat');
    });
    btnPdf.addEventListener('click', () => {
      const filename = buildFilename('chat', getProcessoNumber(), 'pdf');
      openPrintWindow(text, filename, 'SEIrtão — resposta do chat');
    });
    btnMail.addEventListener('click', () => {
      const numero = getProcessoNumber();
      const subject = numero
        ? `SEIrtão — resposta do chat — ${numero}`
        : 'SEIrtão — resposta do chat';
      const maxBody = 1800;
      const body = text.length > maxBody
        ? text.slice(0, maxBody) + '\n\n[…texto truncado para caber no corpo do e-mail. O texto completo está disponível no painel do SEIrtão.]'
        : text;
      const href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.location.href = href;
    });

    bar.appendChild(btnCopy);
    bar.appendChild(btnDoc);
    bar.appendChild(btnPdf);
    bar.appendChild(btnMail);
    return bar;
  };

  return {
    onSend(handler) { handlers.push(handler); },
    appendUserMessage(text) {
      appendMessage('user', text);
      inputEl.value = '';
    },
    startAssistantMessage() {
      const { wrap, body } = appendMessage('assistant', '');
      currentAssistantWrap = wrap;
      currentAssistantBody = body;
      assistantAccumulated = '';
    },
    appendAssistantChunk(delta) {
      if (!currentAssistantBody) {
        const { wrap, body } = appendMessage('assistant', '');
        currentAssistantWrap = wrap;
        currentAssistantBody = body;
        assistantAccumulated = '';
      }
      assistantAccumulated += delta;
      currentAssistantBody.textContent = assistantAccumulated;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    },
    finishAssistantMessage() {
      if (currentAssistantWrap && assistantAccumulated.trim().length > 0) {
        currentAssistantWrap.appendChild(buildAssistantToolbar(assistantAccumulated));
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
      currentAssistantWrap = null;
      currentAssistantBody = null;
      assistantAccumulated = '';
    },
    errorAssistantMessage(message) {
      if (!currentAssistantBody) {
        const { wrap, body } = appendMessage('assistant', '');
        currentAssistantWrap = wrap;
        currentAssistantBody = body;
      }
      currentAssistantBody!.textContent = `[ERRO] ${message}`;
      currentAssistantBody!.style.background = '#FDECEA';
      currentAssistantBody!.style.borderColor = '#c0392b';
      currentAssistantBody!.style.color = '#7B1F15';
      currentAssistantWrap = null;
      currentAssistantBody = null;
      assistantAccumulated = '';
    },
    setBusy(busy, status) {
      btnSend.disabled = busy;
      inputEl.disabled = busy;
      btnClear.disabled = busy;
      if (typeof status === 'string') statusEl.textContent = status;
      else if (!busy) statusEl.textContent = '';
    },
    setStatus(status) { statusEl.textContent = status; },
    reset() {
      messagesEl.innerHTML = '';
      statusEl.textContent = '';
      currentAssistantWrap = null;
      currentAssistantBody = null;
      assistantAccumulated = '';
    },
  };
}

/**
 * Acopla o botão do microfone ao textarea usando a Web Speech API.
 *
 * O texto ditado é inserido no textarea (o usuário ainda precisa clicar
 * "Enviar" — assim pode revisar/corrigir antes de mandar). Resultados
 * interim aparecem em tempo real e são substituídos pelo final quando o
 * provider de reconhecimento fecha o segmento.
 *
 * Requer contexto seguro (HTTPS) + permissão de microfone. Se a API não
 * estiver disponível, o botão fica desabilitado com tooltip explicativo.
 */
function wireMicrophone(
  btn: HTMLButtonElement,
  label: HTMLSpanElement,
  input: HTMLTextAreaElement,
  statusEl: HTMLDivElement,
): void {
  const Ctor = (window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }).SpeechRecognition ?? (window as unknown as {
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }).webkitSpeechRecognition;

  if (!Ctor) {
    btn.disabled = true;
    btn.classList.add('unavailable');
    btn.title = 'Reconhecimento de voz indisponível neste navegador. Use Chrome/Edge em HTTPS.';
    return;
  }

  let recognition: SpeechRecognitionLike | null = null;
  let listening = false;
  let baseText = '';
  let finalAppended = '';

  const stop = (): void => {
    if (recognition) {
      try { recognition.stop(); } catch { /* ignore */ }
    }
  };

  const setIdle = (): void => {
    listening = false;
    btn.classList.remove('listening');
    label.textContent = 'Ditar';
  };

  const start = (): void => {
    recognition = new Ctor();
    recognition.lang = 'pt-BR';
    recognition.interimResults = true;
    recognition.continuous = true;

    baseText = input.value;
    finalAppended = '';

    recognition.onresult = (ev: SpeechRecognitionEventLike) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results.item(i);
        if (!res) continue;
        const alt = res.item(0);
        if (!alt) continue;
        if (res.isFinal) finalAppended += alt.transcript;
        else interim += alt.transcript;
      }
      const sep = baseText && !/\s$/.test(baseText) ? ' ' : '';
      input.value = baseText + sep + finalAppended + interim;
    };
    recognition.onerror = (ev: { error?: string }) => {
      console.warn('[SEIrtão/chat] erro no reconhecimento de voz:', ev.error);
      statusEl.textContent = `Falha na dictação: ${ev.error ?? 'erro desconhecido'}.`;
      setIdle();
    };
    recognition.onend = () => {
      baseText = input.value;
      setIdle();
    };

    try {
      recognition.start();
      listening = true;
      btn.classList.add('listening');
      label.textContent = 'Parar';
      statusEl.textContent = 'Ouvindo… fale em português. Clique em "Parar" quando terminar.';
    } catch (err) {
      console.warn('[SEIrtão/chat] não foi possível iniciar o reconhecimento:', err);
      statusEl.textContent = 'Não foi possível iniciar o microfone.';
      setIdle();
    }
  };

  btn.addEventListener('click', () => {
    if (listening) stop();
    else start();
  });
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  item(index: number): { transcript: string } | undefined;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; item(index: number): SpeechRecognitionResultLike | undefined };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c] as string));
}

function renderShell(): string {
  return `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: "Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }

      /* ─────── Layout raiz do painel (grid 2 colunas) ─────── */
      #panel {
        position: absolute;
        top: 0; right: 0;
        width: ${PANEL_CSS_WIDTH};
        height: 100vh;
        background: #F6F8FC;
        color: #16243A;
        box-shadow: -12px 0 32px rgba(12,50,111,0.22);
        transform: translateX(100%);
        transition: transform 260ms cubic-bezier(0.2, 0.7, 0.1, 1);
        font-size: 13px;
        display: grid;
        grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
        grid-template-rows: auto minmax(0, 1fr) auto;
        grid-template-areas:
          "header  header"
          "side    main"
          "footer  footer";
      }
      @media (max-width: 720px) {
        #panel {
          grid-template-columns: minmax(0, 1fr);
          grid-template-rows: auto auto minmax(0, 1fr) auto;
          grid-template-areas:
            "header"
            "side"
            "main"
            "footer";
        }
      }

      /* ─────── Header ─────── */
      header {
        grid-area: header;
        background: linear-gradient(135deg, #1351B4 0%, #0C326F 100%);
        color: #ffffff;
        padding: 14px 18px;
        display: flex; align-items: center; justify-content: space-between;
        border-bottom: 2px solid #0A2552;
      }
      header .brand h1 { margin: 0; font-size: 16px; font-weight: 700; letter-spacing: 0.4px; }
      header .brand .sub { font-size: 11px; opacity: 0.9; margin-top: 2px; }
      #btn-close {
        background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.18);
        color: #ffffff; width: 28px; height: 28px; border-radius: 8px;
        font-size: 18px; cursor: pointer; line-height: 1;
        display: inline-flex; align-items: center; justify-content: center;
        transition: background 120ms, color 120ms, border-color 120ms;
      }
      #btn-close:hover { background: rgba(255,255,255,0.16); color: #FFCD07; border-color: rgba(255,205,7,0.5); }

      /* ─────── Colunas ─────── */
      .side-col {
        grid-area: side;
        overflow-y: auto;
        padding: 14px 14px 20px;
        border-right: 1px solid rgba(19,81,180,0.14);
        background: linear-gradient(180deg, rgba(19,81,180,0.035), rgba(19,81,180,0.00) 200px);
        display: flex; flex-direction: column; gap: 14px;
      }
      .main-col {
        grid-area: main;
        overflow-y: auto;
        padding: 14px 16px 20px;
        display: flex; flex-direction: column; gap: 10px;
      }
      /* ─────── Seções (cartões) ─────── */
      .panel-section {
        display: flex; flex-direction: column; gap: 6px;
      }
      .panel-section > h2 {
        margin: 0; padding: 0;
        font-size: 10.5px; letter-spacing: 0.8px;
        color: #0C326F; font-weight: 700;
        text-transform: uppercase;
      }
      .panel-section > h2 .count {
        margin-left: 6px; font-weight: 600; color: #5B6B82;
      }

      /* ─────── Status do processo ─────── */
      #status {
        background: #ffffff;
        border: 1px solid rgba(19,81,180,0.14);
        border-radius: 10px;
        padding: 8px 10px;
        display: flex; flex-direction: column; gap: 2px;
      }
      #status .row {
        display: flex; justify-content: space-between; align-items: center;
        padding: 3px 0;
      }
      #status .row + .row { border-top: 1px dotted rgba(19,81,180,0.12); }
      #status .k { color: #5B6B82; font-size: 10.5px; }
      #status .v { font-weight: 600; font-size: 12px; }

      /* ─────── Botões de ação principal (sidebar) ─────── */
      .actions { display: flex; flex-direction: column; gap: 6px; }
      .actions button.main-action {
        background: #ffffff; color: #16243A;
        border: 1px solid rgba(19,81,180,0.22);
        padding: 10px 12px; border-radius: 10px;
        font-size: 12.5px; cursor: pointer;
        text-align: left;
        transition: background 140ms, border-color 140ms, box-shadow 140ms, transform 140ms;
      }
      .actions button.main-action:hover:not(:disabled) {
        background: rgba(19,81,180,0.05); border-color: #1351B4;
        box-shadow: 0 3px 10px rgba(12,50,111,0.10);
        transform: translateY(-1px);
      }
      .actions button.main-action:disabled { opacity: 0.6; cursor: not-allowed; }
      .actions button.main-action .btn-label {
        display: block; font-weight: 600; font-size: 12.5px; color: #0C326F;
      }
      .actions button.main-action .hint {
        display: block; font-weight: 400; font-size: 11px; color: #5B6B82;
        margin-top: 3px; line-height: 1.4;
      }

      /* ─────── Toolbar de documentos ─────── */
      .doc-toolbar {
        display: flex; align-items: center; gap: 6px;
        flex-wrap: wrap;
      }
      .doc-toolbar button {
        background: #ffffff; color: #16243A;
        border: 1px solid rgba(19,81,180,0.22);
        padding: 4px 10px; border-radius: 8px;
        font-size: 11px; font-weight: 600;
        cursor: pointer;
        transition: background 120ms, border-color 120ms;
      }
      .doc-toolbar button:hover { background: rgba(19,81,180,0.06); border-color: #1351B4; }
      .doc-toolbar input.doc-filter {
        flex: 1; min-width: 100px;
        padding: 4px 10px; font-size: 11px;
        border: 1px solid rgba(19,81,180,0.22); border-radius: 8px;
        background: #ffffff; color: #16243A;
      }
      .doc-toolbar input.doc-filter:focus { outline: none; border-color: #1351B4; box-shadow: 0 0 0 2px rgba(19,81,180,0.14); }
      .doc-toolbar .doc-counter {
        font-size: 10.5px; color: #5B6B82; white-space: nowrap;
        flex-basis: 100%; margin-top: 2px;
      }

      /* ─────── Lista de documentos ─────── */
      ul#doc-list {
        list-style: none; padding: 0; margin: 0;
        max-height: 50vh; overflow-y: auto;
        border: 1px solid rgba(19,81,180,0.14); border-radius: 10px;
        background: #ffffff;
      }
      ul#doc-list li.doc-item {
        padding: 5px 10px; font-size: 11.5px;
        border-bottom: 1px dotted rgba(19,81,180,0.08);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      ul#doc-list li.doc-item:last-child { border-bottom: 0; }
      ul#doc-list li.doc-item.h-folder,
      ul#doc-list li.doc-item.h-filter { display: none; }
      ul#doc-list li.doc-folder {
        background: rgba(19,81,180,0.05);
        font-weight: 700; color: #0C326F;
        letter-spacing: 0.3px;
        font-size: 11px;
        cursor: pointer; user-select: none;
      }
      ul#doc-list li.doc-folder:hover { background: rgba(19,81,180,0.09); }
      ul#doc-list li.doc-folder .folder-label::before {
        content: "▾ "; color: #1351B4; display: inline-block; width: 1em;
      }
      ul#doc-list li.doc-folder.collapsed .folder-label::before { content: "▸ "; }
      ul#doc-list li.doc-file label {
        display: flex; align-items: center; gap: 6px; cursor: pointer;
        overflow: hidden; text-overflow: ellipsis;
      }
      ul#doc-list li.doc-file input[type="checkbox"] {
        margin: 0; flex-shrink: 0; accent-color: #1351B4;
      }
      ul#doc-list li.doc-file span {
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      ul#doc-list li.doc-file.no-src { opacity: 0.5; font-style: italic; }
      ul#doc-list li.doc-file.no-src span::after {
        content: " — sem link"; font-size: 10px; color: #5B6B82;
      }

      /* ─────── Chat livre ─────── */
      .chat-section {
        background: #ffffff;
        border: 1px solid rgba(19,81,180,0.14);
        border-radius: 10px;
        padding: 10px 12px;
        display: flex; flex-direction: column; gap: 8px;
      }
      #chat-box { display: flex; flex-direction: column; gap: 6px; }
      #chat-messages {
        background: #F6F8FC; border: 1px solid rgba(19,81,180,0.12); border-radius: 8px;
        padding: 8px 10px; max-height: 320px; min-height: 80px; overflow-y: auto;
        font-size: 12px; line-height: 1.5; color: #16243A;
        display: flex; flex-direction: column; gap: 10px;
      }
      #chat-messages:empty::before {
        content: "Faça uma pergunta sobre o processo — o SEIrtão usa os documentos selecionados como contexto.";
        color: #5B6B82; font-style: italic; font-size: 11.5px;
      }
      .chat-msg { display: flex; flex-direction: column; }
      .chat-msg .chat-role {
        font-size: 10px; font-weight: 700; letter-spacing: 0.5px;
        text-transform: uppercase; margin-bottom: 2px;
      }
      .chat-msg.user .chat-role { color: #0C326F; }
      .chat-msg.assistant .chat-role { color: #1351B4; }
      .chat-msg .chat-body {
        white-space: pre-wrap; word-wrap: break-word;
        padding: 6px 10px; border-radius: 8px; font-size: 12px;
      }
      .chat-msg.user .chat-body { background: rgba(19,81,180,0.08); }
      .chat-msg.assistant .chat-body { background: #ffffff; border: 1px solid rgba(19,81,180,0.14); }
      .chat-msg-actions {
        display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;
      }
      .chat-msg-act {
        background: #ffffff; color: #16243A;
        border: 1px solid rgba(19,81,180,0.22);
        padding: 3px 10px; border-radius: 6px;
        font-size: 10.5px; font-weight: 600;
        cursor: pointer;
        font-family: "Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }
      .chat-msg-act:hover { background: rgba(19,81,180,0.06); border-color: #1351B4; }
      #chat-form { display: flex; flex-direction: column; gap: 6px; }
      #chat-input {
        width: 100%; min-height: 68px; resize: vertical;
        padding: 8px 10px; font-size: 12.5px; line-height: 1.4;
        border: 1px solid rgba(19,81,180,0.22); border-radius: 8px;
        background: #ffffff; color: #16243A;
        font-family: "Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }
      #chat-input:focus { outline: none; border-color: #1351B4; box-shadow: 0 0 0 2px rgba(19,81,180,0.14); }
      #chat-controls { display: flex; gap: 6px; justify-content: flex-end; align-items: center; }
      #chat-controls button {
        background: #ffffff; color: #16243A;
        border: 1px solid rgba(19,81,180,0.22);
        padding: 6px 14px; border-radius: 8px;
        font-size: 11.5px; font-weight: 600;
        cursor: pointer;
        transition: background 120ms, border-color 120ms;
      }
      #chat-controls button:hover { background: rgba(19,81,180,0.06); border-color: #1351B4; }
      #chat-controls button#chat-send {
        background: linear-gradient(135deg, #1351B4 0%, #0C326F 100%); color: #ffffff;
        border-color: #0C326F;
      }
      #chat-controls button#chat-send:hover { filter: brightness(1.08); }
      #chat-controls button:disabled { opacity: 0.6; cursor: not-allowed; }
      #chat-controls button#chat-mic {
        display: inline-flex; align-items: center; gap: 4px;
      }
      #chat-controls button#chat-mic svg { flex-shrink: 0; }
      #chat-controls button#chat-mic.listening {
        background: #FDECEA; color: #c0392b; border-color: #c0392b;
        animation: mic-pulse 1.2s ease-in-out infinite;
      }
      #chat-controls button#chat-mic.unavailable { opacity: 0.5; cursor: not-allowed; }
      @keyframes mic-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(192,57,43,0.5); }
        50%      { box-shadow: 0 0 0 6px rgba(192,57,43,0); }
      }
      #chat-status {
        font-size: 10.5px; color: #5B6B82;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }

      /* ─────── Stream boxes (resumo + minuta) ─────── */
      .stream-box {
        background: #ffffff;
        border: 1px solid rgba(19,81,180,0.14);
        border-radius: 10px;
        padding: 10px 12px;
        display: flex; flex-direction: column; gap: 8px;
      }
      .stream-box[data-state="idle"] { display: none; }
      .stream-box[data-state="error"] .stream-progress,
      .stream-box[data-state="error"] .stream-output,
      .stream-box[data-state="error"] .stream-toolbar { display: none; }
      .stream-box:not([data-state="error"]) .stream-error { display: none; }
      .stream-box-title {
        font-size: 10.5px; font-weight: 700; color: #0C326F;
        letter-spacing: 0.5px; text-transform: uppercase;
      }
      .stream-progress {
        padding: 8px 10px;
        background: #F6F8FC; border: 1px solid rgba(19,81,180,0.12); border-radius: 8px;
      }
      .stream-progress-bar {
        width: 100%; height: 6px; background: rgba(19,81,180,0.10); border-radius: 4px; overflow: hidden;
      }
      .stream-progress-fill {
        height: 100%; width: 0%;
        background: linear-gradient(90deg, #1351B4, #0C326F);
        transition: width 120ms ease;
      }
      .stream-progress-text {
        margin-top: 6px; font-size: 10.5px; color: #5B6B82;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .stream-output {
        padding: 10px 12px;
        background: #F6F8FC; border: 1px solid rgba(19,81,180,0.12); border-radius: 8px;
        max-height: 420px; overflow-y: auto;
        white-space: pre-wrap; word-wrap: break-word;
        font-size: 12.5px; line-height: 1.55; color: #16243A;
      }
      .stream-error {
        padding: 10px 12px;
        background: #FDECEA; border: 1px solid #c0392b; border-radius: 8px;
        color: #7B1F15; font-size: 11.5px; line-height: 1.4;
      }
      .stream-toolbar {
        display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end;
      }
      .stream-toolbar button {
        background: #ffffff; color: #16243A;
        border: 1px solid rgba(19,81,180,0.22);
        padding: 5px 12px; border-radius: 8px;
        font-size: 11px; font-weight: 600;
        cursor: pointer;
        transition: background 120ms, border-color 120ms;
      }
      .stream-toolbar button:hover { background: rgba(19,81,180,0.06); border-color: #1351B4; }
      .stream-toolbar button[data-act="inserir"] {
        background: linear-gradient(135deg, #1351B4 0%, #0C326F 100%); color: #ffffff;
        border-color: #0C326F;
      }
      .stream-toolbar button[data-act="inserir"]:hover { filter: brightness(1.08); }

      /* ─────── Insert stepper (Fase D.2 — automação das 4 etapas do SEI) ─────── */
      .insert-stepper {
        background: #ffffff;
        border: 1px solid rgba(19,81,180,0.18);
        border-radius: 10px;
        padding: 10px 12px;
        display: flex; flex-direction: column; gap: 8px;
      }
      .insert-stepper[data-visible="false"] { display: none; }
      .insert-stepper-title {
        font-size: 11px; font-weight: 700; letter-spacing: 0.04em;
        text-transform: uppercase; color: #0C326F;
      }
      .insert-steps {
        list-style: none; margin: 0; padding: 0;
        display: flex; flex-direction: column; gap: 6px;
      }
      .insert-step {
        display: flex; align-items: center; gap: 10px;
        font-size: 12px; color: #16243A;
        padding: 4px 2px;
      }
      .insert-step-icon {
        width: 16px; height: 16px; flex-shrink: 0;
        border-radius: 50%;
        border: 1.5px solid rgba(19,81,180,0.35);
        background: #ffffff;
        position: relative;
        transition: background 150ms, border-color 150ms;
      }
      .insert-step--active .insert-step-icon {
        border-color: #1351B4;
        background: #1351B4;
        animation: insert-pulse 1.1s ease-in-out infinite;
      }
      .insert-step--done .insert-step-icon {
        border-color: #15803D; background: #15803D;
      }
      .insert-step--done .insert-step-icon::after {
        content: ''; position: absolute;
        left: 4px; top: 1px; width: 4px; height: 8px;
        border: solid #ffffff; border-width: 0 2px 2px 0;
        transform: rotate(45deg);
      }
      .insert-step--error .insert-step-icon {
        border-color: #B91C1C; background: #B91C1C;
      }
      .insert-step--error .insert-step-icon::after {
        content: '!'; position: absolute; inset: 0;
        display: flex; align-items: center; justify-content: center;
        color: #ffffff; font-size: 10px; font-weight: 800;
      }
      .insert-step--active .insert-step-label { font-weight: 600; color: #0C326F; }
      .insert-step--done .insert-step-label { color: #15803D; }
      .insert-step--error .insert-step-label { color: #B91C1C; font-weight: 600; }
      @keyframes insert-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(19,81,180,0.45); }
        50%      { box-shadow: 0 0 0 6px rgba(19,81,180,0); }
      }
      .insert-stepper-status {
        font-size: 11px; color: #4B5563; font-style: italic;
        min-height: 1.3em;
      }
      .insert-stepper-result { display: none; padding: 10px 12px; border-radius: 8px; }
      .insert-stepper-result[data-visible="true"] { display: block; }
      .insert-stepper-done {
        background: rgba(21,128,61,0.08);
        border: 1px solid rgba(21,128,61,0.35);
      }
      .insert-stepper-done .insert-stepper-result-title {
        font-size: 12px; font-weight: 700; color: #15803D;
        margin-bottom: 4px;
      }
      .insert-stepper-done .insert-stepper-result-title::before {
        content: '✓ '; font-weight: 800;
      }
      .insert-stepper-done .insert-stepper-result-body {
        font-size: 12px; color: #14532D; line-height: 1.45;
      }
      .insert-stepper-fail {
        background: rgba(185,28,28,0.06);
        border: 1px solid rgba(185,28,28,0.30);
      }
      .insert-stepper-fail .insert-stepper-result-title {
        font-size: 12px; font-weight: 700; color: #B91C1C;
        margin-bottom: 4px;
      }
      .insert-stepper-fail .insert-stepper-result-title::before {
        content: '⚠ '; font-weight: 800;
      }
      .insert-stepper-fail-msg { font-size: 12px; color: #7F1D1D; }
      .insert-stepper-fail-hint {
        font-size: 11px; color: #4B5563; font-style: italic; margin-top: 4px;
      }

      /* ─────── Otimizar modelo — caixa de entrada (textarea + botão) ─────── */
      .otimizar-input {
        background: #ffffff;
        border: 1px solid rgba(19,81,180,0.18);
        border-radius: 10px;
        padding: 12px;
        display: flex; flex-direction: column; gap: 10px;
      }
      .otimizar-input[data-visible="false"] { display: none; }
      .otimizar-input-title {
        font-size: 12px; font-weight: 700; letter-spacing: 0.04em;
        text-transform: uppercase; color: #0C326F;
      }
      .otimizar-input-hint {
        font-size: 12px; color: #4B5563; line-height: 1.45;
      }
      .otimizar-input-hint code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 11px;
        background: rgba(19,81,180,0.08);
        color: #0C326F;
        padding: 1px 5px; border-radius: 4px;
      }
      #otimizar-textarea {
        width: 100%; min-height: 180px; resize: vertical;
        padding: 10px 12px; border-radius: 8px;
        border: 1px solid rgba(19,81,180,0.22);
        background: #F6F8FC; color: #16243A;
        font-family: inherit; font-size: 12px; line-height: 1.5;
        box-sizing: border-box;
      }
      #otimizar-textarea:focus {
        outline: none; border-color: #1351B4;
        box-shadow: 0 0 0 3px rgba(19,81,180,0.14);
      }
      .otimizar-input-actions {
        display: flex; justify-content: flex-end;
      }
      .otimizar-analyze-btn {
        background: linear-gradient(135deg, #1351B4 0%, #0C326F 100%); color: #ffffff;
        border: 1px solid #0C326F;
        padding: 8px 16px; border-radius: 8px;
        font-size: 12px; font-weight: 600;
        cursor: pointer;
        transition: filter 120ms;
      }
      .otimizar-analyze-btn:hover:not(:disabled) { filter: brightness(1.08); }
      .otimizar-analyze-btn:disabled { opacity: 0.6; cursor: not-allowed; }

      /* Stream-box da otimização começa escondido — só aparece ao iniciar o fluxo. */
      #otimizar-box[data-state="idle"] { display: none; }

      /* ─────── Triage box (1ª rodada do "Minutar próximo ato") ─────── */
      .triage-box {
        background: #ffffff;
        border: 1px solid rgba(19,81,180,0.14); border-radius: 10px;
        padding: 10px 12px;
        display: flex; flex-direction: column; gap: 8px;
      }
      .triage-box[data-visible="false"] { display: none; }
      .triage-box[data-state="idle"] .stream-progress,
      .triage-box[data-state="idle"] .stream-error,
      .triage-box[data-state="idle"] .triage-result { display: none; }
      .triage-box[data-state="fetching"] .stream-error,
      .triage-box[data-state="fetching"] .triage-result { display: none; }
      .triage-box[data-state="streaming"] .stream-error,
      .triage-box[data-state="streaming"] .triage-result { display: none; }
      .triage-box[data-state="done"] .stream-progress,
      .triage-box[data-state="done"] .stream-error { display: none; }
      .triage-box[data-state="error"] .stream-progress { display: none; }
      .triage-result {
        display: flex; flex-direction: column; gap: 8px;
        padding: 10px 12px; background: #F6F8FC;
        border: 1px solid rgba(19,81,180,0.12); border-radius: 8px;
      }
      .triage-section { display: flex; flex-direction: column; gap: 2px; }
      .triage-label {
        font-size: 10.5px; font-weight: 700; color: #0C326F;
        text-transform: uppercase; letter-spacing: 0.5px;
      }
      .triage-value {
        font-size: 12.5px; color: #16243A; line-height: 1.45;
        white-space: pre-wrap; word-wrap: break-word;
      }
      .triage-actions {
        display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px;
      }
      .triage-actions .minuta-refine-btn-primary { flex: 1; min-width: 220px; }
      .minuta-refine-actions { display: flex; flex-wrap: wrap; gap: 6px; }
      .minuta-refine-btn {
        background: #ffffff; color: #16243A;
        border: 1px solid rgba(19,81,180,0.22);
        padding: 7px 12px; border-radius: 8px;
        font-size: 11.5px; font-weight: 600;
        cursor: pointer;
        font-family: "Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }
      .minuta-refine-btn:hover { background: rgba(19,81,180,0.06); border-color: #1351B4; }
      .minuta-refine-btn-primary {
        background: linear-gradient(135deg, #1351B4 0%, #0C326F 100%);
        color: #ffffff; border: 1px solid #0C326F;
        padding: 9px 14px; border-radius: 8px;
        font-size: 12px; font-weight: 600;
        cursor: pointer; text-align: left;
        font-family: "Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }
      .minuta-refine-btn-primary:hover:not(:disabled) { filter: brightness(1.08); }
      .minuta-refine-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
      .minuta-refine-panel {
        display: flex; flex-direction: column; gap: 6px;
        padding: 10px; background: #F6F8FC;
        border: 1px solid rgba(19,81,180,0.12); border-radius: 8px;
      }
      .minuta-refine-panel[data-visible="false"] { display: none; }
      .minuta-refine-label {
        font-size: 11px; color: #16243A; font-weight: 600;
      }
      .minuta-refine-input, .minuta-refine-textarea {
        width: 100%; box-sizing: border-box;
        padding: 7px 10px; font-size: 12px;
        border: 1px solid rgba(19,81,180,0.22); border-radius: 8px;
        background: #ffffff; color: #16243A;
        font-family: "Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }
      .minuta-refine-input:focus, .minuta-refine-textarea:focus {
        outline: none; border-color: #1351B4; box-shadow: 0 0 0 2px rgba(19,81,180,0.14);
      }
      .minuta-refine-textarea { resize: vertical; min-height: 64px; line-height: 1.4; }
      .minuta-refine-suggestions {
        max-height: 180px; overflow-y: auto;
        display: flex; flex-direction: column; gap: 2px;
        background: #ffffff; border: 1px solid rgba(19,81,180,0.12); border-radius: 8px;
        padding: 4px;
      }
      .minuta-refine-suggestion {
        background: #ffffff; color: #16243A;
        border: 1px solid rgba(19,81,180,0.12); border-radius: 6px;
        padding: 5px 10px; font-size: 11.5px; text-align: left;
        cursor: pointer;
        font-family: "Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }
      .minuta-refine-suggestion:hover { background: rgba(19,81,180,0.08); border-color: #1351B4; }
      .minuta-refine-empty {
        font-size: 11px; color: #5B6B82; font-style: italic; padding: 6px;
      }
      .minuta-refine-footer {
        display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap;
      }

      /* ─────── Footer ─────── */
      footer {
        grid-area: footer;
        padding: 8px 18px;
        font-size: 10px; color: #5B6B82;
        border-top: 1px solid rgba(19,81,180,0.14);
        text-align: center;
        background: rgba(255,255,255,0.6);
      }

      /* ─────── Cartão de pré-inserção (Fase D.1) ─────── */
      .insert-overlay {
        position: absolute;
        inset: 0;
        background: rgba(12,50,111,0.48);
        backdrop-filter: blur(3px);
        display: flex; align-items: center; justify-content: center;
        z-index: 100;
        padding: 24px 18px;
      }
      .insert-overlay[data-visible="false"] { display: none; }
      .insert-dialog {
        background: #ffffff;
        border-radius: 14px;
        box-shadow: 0 12px 48px rgba(12,50,111,0.38);
        width: 100%; max-width: 640px;
        max-height: calc(100vh - 48px);
        display: flex; flex-direction: column;
        overflow: hidden;
      }
      .insert-dialog-header {
        background: linear-gradient(135deg, #1351B4 0%, #0C326F 100%);
        color: #ffffff;
        padding: 12px 18px;
        display: flex; align-items: center; justify-content: space-between;
      }
      .insert-dialog-header h3 {
        margin: 0; font-size: 14px; font-weight: 700; letter-spacing: 0.3px;
      }
      .insert-close {
        background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.18);
        color: #ffffff; width: 26px; height: 26px; border-radius: 7px;
        font-size: 16px; cursor: pointer; line-height: 1;
        display: inline-flex; align-items: center; justify-content: center;
      }
      .insert-close:hover { background: rgba(255,255,255,0.18); color: #FFCD07; }
      .insert-dialog-body {
        padding: 14px 18px;
        overflow-y: auto;
        display: flex; flex-direction: column; gap: 12px;
        color: #16243A; font-size: 12.5px;
      }
      .insert-meta {
        background: #F6F8FC;
        border: 1px solid rgba(19,81,180,0.12);
        border-radius: 10px;
        padding: 8px 12px;
        display: flex; flex-direction: column; gap: 3px;
      }
      .insert-meta-row {
        display: flex; justify-content: space-between; align-items: baseline;
        gap: 10px;
      }
      .insert-meta-row + .insert-meta-row { border-top: 1px dotted rgba(19,81,180,0.12); padding-top: 3px; }
      .insert-meta-k { color: #5B6B82; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; }
      .insert-meta-v { font-weight: 600; font-size: 12.5px; color: #0C326F; }
      .insert-field {
        display: flex; flex-direction: column; gap: 4px;
      }
      .insert-fieldset {
        border: 1px solid rgba(19,81,180,0.14);
        border-radius: 10px;
        padding: 10px 12px;
        margin: 0;
      }
      .insert-fieldset legend { padding: 0 4px; }
      .insert-field-label {
        font-size: 10.5px; font-weight: 700; color: #0C326F;
        text-transform: uppercase; letter-spacing: 0.5px;
      }
      .insert-input, .insert-textarea {
        width: 100%; box-sizing: border-box;
        padding: 8px 10px; font-size: 12.5px;
        border: 1px solid rgba(19,81,180,0.22); border-radius: 8px;
        background: #ffffff; color: #16243A;
        font-family: "Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }
      .insert-input:focus, .insert-textarea:focus {
        outline: none; border-color: #1351B4; box-shadow: 0 0 0 2px rgba(19,81,180,0.14);
      }
      .insert-textarea {
        resize: vertical; min-height: 180px; line-height: 1.5;
        font-size: 12px;
        white-space: pre-wrap;
      }
      .insert-radios {
        display: flex; gap: 16px; flex-wrap: wrap; margin-top: 4px;
      }
      .insert-radio {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 12.5px; cursor: pointer;
      }
      .insert-radio input[type="radio"] { accent-color: #1351B4; }
      .insert-hipotese-wrap {
        display: flex; flex-direction: column; gap: 4px;
        margin-top: 8px;
      }
      .insert-hipotese-wrap[data-visible="false"] { display: none; }
      .insert-warn {
        margin-top: 6px;
        font-size: 11px; color: #8A5A00;
        font-weight: 600;
      }
      .insert-warn:empty { display: none; }
      .insert-checklist {
        display: flex; flex-direction: column; gap: 6px;
        padding: 10px 12px;
        background: rgba(255, 205, 7, 0.08);
        border: 1px solid rgba(255, 205, 7, 0.4);
        border-radius: 10px;
      }
      .insert-check {
        display: flex; align-items: flex-start; gap: 8px;
        font-size: 11.5px; color: #16243A; line-height: 1.45;
        cursor: pointer;
      }
      .insert-check input[type="checkbox"] {
        margin-top: 2px; flex-shrink: 0; accent-color: #1351B4;
      }
      .insert-check strong { color: #7B1F15; }
      .insert-dialog-footer {
        padding: 10px 18px;
        border-top: 1px solid rgba(19,81,180,0.14);
        display: flex; gap: 8px; justify-content: flex-end;
        background: #F6F8FC;
      }
    </style>
    <div id="panel" role="complementary" aria-label="SEIrtão — painel lateral">
      <header>
        <div class="brand">
          <h1>SEIrtão</h1>
          <div class="sub">assistente SEI — JFCE</div>
        </div>
        <button id="btn-close" title="Fechar" aria-label="Fechar">×</button>
      </header>

      <aside class="side-col">
        <section class="panel-section">
          <h2>Processo</h2>
          <div id="status"><div class="row"><span class="k">Aguardando…</span><span class="v">—</span></div></div>
        </section>

        <section class="panel-section">
          <h2>Ações</h2>
          <div class="actions">
            <button id="act-resumir" class="main-action" type="button">
              <span class="btn-label">Analisar processo administrativo</span>
              <span class="hint">Lê todos os documentos e gera análise estruturada (objeto, instrução, fundamentação, pendências, próximas providências).</span>
            </button>
            <button id="act-minutar" class="main-action" type="button">
              <span class="btn-label">Minutar próximo ato</span>
              <span class="hint">Sugere o ato cabível (despacho, informação, parecer, decisão, ato ordinatório, memorando, ofício) e produz a minuta pronta.</span>
            </button>
            <button id="act-otimizar" class="main-action" type="button">
              <span class="btn-label">Otimizar modelo do SEI</span>
              <span class="hint">Analisa um modelo existente e propõe variáveis (@tag@), remoção de redundâncias e ajustes de clareza para uso reutilizável.</span>
            </button>
          </div>
        </section>

        <section class="panel-section">
          <h2>Documentos</h2>
          <div class="doc-toolbar">
            <button id="docs-all" type="button" title="Marcar todos os documentos">Todos</button>
            <button id="docs-none" type="button" title="Desmarcar todos os documentos">Nenhum</button>
            <input id="doc-filter" type="search" class="doc-filter" placeholder="Filtrar…" />
            <span id="doc-counter" class="doc-counter">0 de 0 selecionados</span>
          </div>
          <ul id="doc-list"><li class="doc-item" style="color:#1351B4">Aguardando árvore…</li></ul>
        </section>
      </aside>

      <section class="main-col" id="main-col">
        ${renderStreamBox('resumo-box', 'Análise do processo')}
        ${renderMinutaTriage()}
        ${renderStreamBox('minuta-box', 'Minuta', { withInsertStepper: true })}
        ${renderOtimizarInput()}
        ${renderStreamBox('otimizar-box', 'Modelo otimizado')}

        <section class="panel-section chat-section">
          <h2>Chat livre</h2>
          <div id="chat-box">
            <div id="chat-messages"></div>
            <div id="chat-status"></div>
            <form id="chat-form">
              <textarea id="chat-input" placeholder="Pergunte algo sobre este processo (Enter envia, Shift+Enter pula linha)…"></textarea>
              <div id="chat-controls">
                <button id="chat-mic" type="button" title="Ditar a pergunta por voz (pt-BR)" aria-label="Ditar por voz">
                  <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zm7 9a7 7 0 01-6 6.92V21h-2v-2.08A7 7 0 015 12h2a5 5 0 0010 0h2z"/></svg>
                  <span class="mic-label">Ditar</span>
                </button>
                <button id="chat-clear" type="button" title="Limpar conversa">Nova</button>
                <button id="chat-send" type="submit" title="Enviar pergunta">Enviar</button>
              </div>
            </form>
          </div>
        </section>
      </section>

      <footer>v0.1.0 — MVP</footer>
      ${renderInsertConfirm()}
    </div>
  `;
}

/**
 * Overlay modal do cartão de pré-inserção (Fase D.1). Fica escondido
 * por default (`data-visible="false"`) e é mostrado por `wireInsertConfirmDialog.open()`.
 */
function renderInsertConfirm(): string {
  return `
    <div id="insert-overlay" class="insert-overlay" data-visible="false" role="presentation">
      <div id="insert-dialog" class="insert-dialog" role="dialog" aria-modal="true" aria-labelledby="insert-dialog-title">
        <div class="insert-dialog-header">
          <h3 id="insert-dialog-title">Revisar antes de inserir no SEI</h3>
          <button type="button" class="insert-close" data-act="close" aria-label="Fechar">×</button>
        </div>
        <div class="insert-dialog-body">
          <div class="insert-meta">
            <div class="insert-meta-row"><span class="insert-meta-k">Processo</span><span class="insert-meta-v" data-field="numero">—</span></div>
            <div class="insert-meta-row"><span class="insert-meta-k">Ato</span><span class="insert-meta-v" data-field="ato">—</span></div>
          </div>

          <label class="insert-field">
            <span class="insert-field-label">Descrição do documento</span>
            <input type="text" class="insert-input" data-field="descricao" maxlength="200"
              placeholder="Ex.: Despacho — 16/04/2026" />
          </label>

          <fieldset class="insert-field insert-fieldset">
            <legend class="insert-field-label">Nível de acesso (obrigatório)</legend>
            <div class="insert-radios">
              <label class="insert-radio"><input type="radio" name="insert-nivel" value="publico" /> <span>Público</span></label>
              <label class="insert-radio"><input type="radio" name="insert-nivel" value="restrito" /> <span>Restrito</span></label>
              <label class="insert-radio"><input type="radio" name="insert-nivel" value="sigiloso" /> <span>Sigiloso</span></label>
            </div>
            <div class="insert-hipotese-wrap" data-visible="false">
              <label class="insert-field-label" for="insert-hipotese">Hipótese legal (obrigatória para Restrito)</label>
              <select class="insert-input" data-field="hipotese" id="insert-hipotese"></select>
            </div>
            <div class="insert-warn"></div>
          </fieldset>

          <label class="insert-field">
            <span class="insert-field-label">Minuta (edite aqui se necessário antes da inserção)</span>
            <textarea class="insert-textarea" data-field="text" rows="12"></textarea>
          </label>

          <div class="insert-checklist">
            <label class="insert-check">
              <input type="checkbox" data-check="revisei" />
              <span>Revisei integralmente o conteúdo da minuta e ele está pronto para inserção.</span>
            </label>
            <label class="insert-check">
              <input type="checkbox" data-check="assinatura" />
              <span>Estou ciente de que o SEIrtão <strong>não</strong> salvará nem assinará o documento — essa ação é minha.</span>
            </label>
            <label class="insert-check">
              <input type="checkbox" data-check="nivel" />
              <span>Confirmo o nível de acesso escolhido e, quando aplicável, a hipótese legal correspondente.</span>
            </label>
          </div>
        </div>
        <div class="insert-dialog-footer">
          <button type="button" class="minuta-refine-btn" data-act="cancel">Cancelar</button>
          <button type="button" class="minuta-refine-btn-primary" data-act="go" disabled>Iniciar inserção no SEI</button>
        </div>
      </div>
    </div>
  `;
}

function renderStreamBox(id: string, title: string, opts?: { withInsertStepper?: boolean }): string {
  const stepper = opts?.withInsertStepper ? renderInsertStepper() : '';
  return `
    <div id="${id}" class="stream-box" data-state="idle">
      <div class="stream-box-title">${escapeHtml(title)}</div>
      <div class="stream-progress">
        <div class="stream-progress-bar"><div class="stream-progress-fill"></div></div>
        <div class="stream-progress-text"></div>
      </div>
      <div class="stream-output"></div>
      <div class="stream-error"></div>
      ${stepper}
      <div class="stream-toolbar">
        <button data-act="copy" title="Copiar para a área de transferência">Copiar</button>
        <button data-act="doc" title="Baixar como .doc (Word)">Baixar .doc</button>
        <button data-act="pdf" title="Abrir janela de impressão para salvar em PDF">Baixar PDF</button>
        <button data-act="reset" title="Limpar e começar de novo">Nova</button>
        <button data-act="mail" title="Enviar por e-mail (abre seu cliente padrão)">Enviar por e-mail</button>
      </div>
    </div>
  `;
}

/**
 * Fase D.2 — stepper visual dos 4 passos macro da automação de inserção
 * no SEI. Os 8+ sub-estados do state machine (clicking-incluir, await-tipo,
 * selecting-tipo, await-cadastrar, filling-cadastrar, submitting,
 * await-editor, injecting, done) são mapeados para 4 passos legíveis
 * pelo usuário; cada `<li>` tem `data-step` e ganha classes `active/done/error`.
 *
 * O banner de conclusão (Fase D.3) e o de erro moram no mesmo container
 * e ficam visíveis via `data-visible` no wrapper.
 */
function renderInsertStepper(): string {
  return `
    <div class="insert-stepper" data-visible="false" data-phase="idle">
      <div class="insert-stepper-title">Inserção no SEI</div>
      <ol class="insert-steps">
        <li class="insert-step" data-step="incluir">
          <span class="insert-step-icon" aria-hidden="true"></span>
          <span class="insert-step-label">Abrir "Incluir Documento"</span>
        </li>
        <li class="insert-step" data-step="tipo">
          <span class="insert-step-icon" aria-hidden="true"></span>
          <span class="insert-step-label">Selecionar o tipo do ato</span>
        </li>
        <li class="insert-step" data-step="cadastrar">
          <span class="insert-step-icon" aria-hidden="true"></span>
          <span class="insert-step-label">Preencher o cadastro</span>
        </li>
        <li class="insert-step" data-step="editor">
          <span class="insert-step-icon" aria-hidden="true"></span>
          <span class="insert-step-label">Abrir o editor do SEI</span>
        </li>
        <li class="insert-step" data-step="injetar">
          <span class="insert-step-icon" aria-hidden="true"></span>
          <span class="insert-step-label">Injetar a minuta no editor</span>
        </li>
      </ol>
      <div class="insert-stepper-status"></div>
      <div class="insert-stepper-result insert-stepper-done" data-visible="false">
        <div class="insert-stepper-result-title">Minuta inserida no SEI</div>
        <div class="insert-stepper-result-body">
          Revise e <strong>assine manualmente</strong> no próprio SEI.
          O SEIrtão nunca salva, assina ou publica o documento por você.
        </div>
      </div>
      <div class="insert-stepper-result insert-stepper-fail" data-visible="false">
        <div class="insert-stepper-result-title">Não foi possível concluir</div>
        <div class="insert-stepper-result-body">
          <div class="insert-stepper-fail-msg"></div>
          <div class="insert-stepper-fail-hint"></div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Caixa de entrada da otimização de modelo. Fica visível quando o
 * `#otimizar-box` (stream-box padrão) está em `idle`; some assim que o
 * fluxo começa a rodar e reaparece quando o usuário clica "Nova".
 *
 * O botão "Analisar modelo" é o trigger do stream-box (passado como
 * `triggerId: 'otimizar-analyze'` no `wireStreamBox`) — por isso segue
 * o mesmo contrato de `.btn-label` + disabled automático durante stream.
 */
function renderOtimizarInput(): string {
  return `
    <div id="otimizar-input" class="otimizar-input" data-visible="false">
      <div class="otimizar-input-title">Otimizar modelo do SEI</div>
      <div class="otimizar-input-hint">
        Cole abaixo o texto de uma minuta-modelo. O SEIrtão identifica dados
        variáveis (nomes, datas, números de processo, valores) e propõe tags
        <code>@NOME_DA_TAG@</code> para transformar a peça em um template
        reutilizável.
      </div>
      <textarea id="otimizar-textarea" rows="10"
        placeholder="Cole aqui o texto do modelo (despacho, ofício, informação etc.)…"></textarea>
      <div class="otimizar-input-actions">
        <button id="otimizar-analyze" type="button" class="otimizar-analyze-btn">
          <span class="btn-label">Analisar modelo</span>
        </button>
      </div>
    </div>
  `;
}

/**
 * Caixa da 1ª rodada do "Minutar próximo ato". Esta caixa concentra:
 *
 *  - o indicador "Analisando processo…" com barra de progresso, enquanto
 *    o runner lê/streama;
 *  - o cartão com ATO SUGERIDO + JUSTIFICATIVA, exibido quando o modelo
 *    conclui a triagem;
 *  - os botões "Gerar minuta deste ato" e "Escolher outro ato";
 *  - o autocomplete (catálogo + tipos do SEI) para troca de ato;
 *  - o painel de orientações, com "Sem orientações" e "Gerar com orientações".
 *
 * A minuta em si é gerada numa segunda rodada e vai para o `#minuta-box`
 * (o streambox padrão), exibido logo abaixo desta caixa.
 */
function renderMinutaTriage(): string {
  return `
    <div id="minuta-triage" class="triage-box" data-state="idle" data-visible="false">
      <div class="stream-progress">
        <div class="stream-progress-bar"><div class="stream-progress-fill"></div></div>
        <div class="stream-progress-text">Analisando processo…</div>
      </div>
      <div class="stream-error"></div>
      <div class="triage-result">
        <div class="triage-section">
          <div class="triage-label">Ato sugerido</div>
          <div class="triage-value triage-ato"></div>
        </div>
        <div class="triage-section">
          <div class="triage-label">Justificativa</div>
          <div class="triage-value triage-justificativa"></div>
        </div>
        <div class="triage-actions">
          <button type="button" class="minuta-refine-btn-primary" data-act="gerar-sugerido">Gerar minuta deste ato</button>
          <button type="button" class="minuta-refine-btn" data-act="escolher-outro">Escolher outro ato…</button>
        </div>
      </div>
      <div class="minuta-refine-panel minuta-refine-picker" data-visible="false">
        <label class="minuta-refine-label" for="minuta-refine-ato">Escolha um ato (digite para filtrar):</label>
        <input id="minuta-refine-ato" type="search" class="minuta-refine-input"
          placeholder="ex.: Despacho, Ofício, Parecer…" autocomplete="off" />
        <div class="minuta-refine-suggestions" id="minuta-refine-suggestions" role="listbox"></div>
        <div class="minuta-refine-footer">
          <button type="button" class="minuta-refine-btn" data-act="picker-cancel">Cancelar</button>
          <button type="button" class="minuta-refine-btn-primary" data-act="picker-go" disabled>Continuar</button>
        </div>
      </div>
      <div class="minuta-refine-panel minuta-refine-orient" data-visible="false">
        <div class="minuta-refine-label">Ato escolhido: <span class="orient-ato-name"></span></div>
        <label class="minuta-refine-label" for="minuta-refine-orient-text">Orientações adicionais (opcional):</label>
        <textarea id="minuta-refine-orient-text" class="minuta-refine-textarea"
          placeholder="Ex.: enfatizar a urgência, citar a Portaria X, incluir referência à Informação Y…" rows="3"></textarea>
        <div class="minuta-refine-footer">
          <button type="button" class="minuta-refine-btn" data-act="orient-back">Voltar</button>
          <button type="button" class="minuta-refine-btn" data-act="orient-skip">Sem orientações — gerar minuta</button>
          <button type="button" class="minuta-refine-btn-primary" data-act="orient-go">Gerar com orientações</button>
        </div>
      </div>
    </div>
  `;
}
