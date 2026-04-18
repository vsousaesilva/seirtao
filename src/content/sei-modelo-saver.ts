/**
 * Salvador de modelos: injeta um modelo otimizado no banco "Modelos
 * Favoritos" da unidade atual do usuário no SEI.
 *
 * Segue o mesmo padrão de iframe oculto usado por `sei-document-types.ts`
 * e `sei-minutar-insert.ts`: descobre a URL do cadastrar a partir do menu
 * do SEI, abre em iframe invisível, preenche os campos, injeta o conteúdo
 * no CKEditor via bridge MAIN world e submete o formulário.
 *
 * Esta é uma implementação best-guess contra os nomes de campo mais comuns
 * do SEI (`txtNome`, `selSerie`, `txaDescricao`, `btnSalvar`). Em caso de
 * divergência de versão, os erros trazem `userHint` explicando como salvar
 * manualmente.
 */

import { minutaTextToHtml } from './sei-minutar-insert';

const LOG = '[SEIrtão/modelo-saver]';

// ─────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ─────────────────────────────────────────────────────────────────────────

export type SaverPhase =
  | 'idle'
  | 'locating'
  | 'loading-form'
  | 'filling'
  | 'awaiting-editor'
  | 'injecting'
  | 'submitting'
  | 'done'
  | 'error';

export interface SaverStatus { phase: SaverPhase; message: string }

export interface SaverError {
  phase: SaverPhase;
  message: string;
  userHint: string;
}

export interface SaverCallbacks {
  onState?(s: SaverStatus): void;
  onDone?(s: SaverStatus): void;
  onError?(e: SaverError): void;
}

export interface SaveModeloOptions {
  nome: string;
  descricao: string;
  tipoDocumento: string;
  conteudoTexto: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Utilitários
// ─────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

function collectSameOriginDocs(): Document[] {
  const out: Document[] = [document];
  const visit = (d: Document): void => {
    const frames = Array.from(d.querySelectorAll<HTMLIFrameElement>('iframe'));
    for (const f of frames) {
      try {
        const sub = f.contentDocument;
        if (sub && !out.includes(sub)) {
          out.push(sub);
          visit(sub);
        }
      } catch { /* cross-origin */ }
    }
  };
  visit(document);
  return out;
}

async function waitUntil(
  iframe: HTMLIFrameElement,
  predicate: (doc: Document, url: string) => boolean,
  timeoutMs: number,
  intervalMs = 250,
): Promise<{ ok: boolean; doc?: Document; url?: string }> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    let doc: Document | null = null;
    let url = iframe.src;
    try {
      doc = iframe.contentDocument;
      url = doc?.location.href ?? iframe.src;
    } catch { /* cross-origin */ }
    if (doc && doc.readyState !== 'loading') {
      try {
        if (predicate(doc, url)) return { ok: true, doc, url };
      } catch { /* retry */ }
    }
    await sleep(intervalMs);
  }
  return { ok: false };
}

// ─────────────────────────────────────────────────────────────────────────
// Descoberta da URL de cadastro de modelos favoritos
// ─────────────────────────────────────────────────────────────────────────

/**
 * Varre TODOS os documentos same-origin (top + iframes aninhados) em busca
 * de um link que leve ao gerenciamento de Modelos Favoritos. Pontua as
 * candidatas por especificidade da `acao=` e do texto. A melhor candidata
 * tem sua `acao=` reescrita para `md_gen_modelo_favorito_cadastrar`,
 * preservando `infra_hash` e demais parâmetros de sessão.
 */
function findCadastroUrl(): string | null {
  const docs = collectSameOriginDocs();
  const candidates: { score: number; url: URL }[] = [];

  for (const doc of docs) {
    const anchors = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'));
    for (const a of anchors) {
      const href = a.getAttribute('href') ?? '';
      if (!href.includes('controlador.php')) continue;
      let url: URL;
      try {
        url = new URL(href, doc.location?.href ?? window.location.href);
      } catch { continue; }
      const acao = url.searchParams.get('acao') ?? '';
      const text = (a.textContent ?? '').trim().toLowerCase();
      const title = (a.getAttribute('title') ?? '').toLowerCase();

      let score = 0;
      if (/md_gen_modelo_favorito_cadastrar/.test(acao)) score = 100;
      else if (/md_gen_modelo_favorito/.test(acao)) score = 90;
      else if (/md_gen_modelo/.test(acao)) score = 70;
      else if (/modelo/.test(acao) && /modelo/.test(text + title)) score = 50;
      else if (/modelos?\s+favoritos?/i.test(text)) score = 40;

      if (score > 0) candidates.push({ score, url });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  const best = new URL(candidates[0].url.toString());
  if (best.searchParams.get('acao') !== 'md_gen_modelo_favorito_cadastrar') {
    best.searchParams.set('acao', 'md_gen_modelo_favorito_cadastrar');
  }
  return best.toString();
}

// ─────────────────────────────────────────────────────────────────────────
// Bridge call para o CKEditor dentro do iframe
// ─────────────────────────────────────────────────────────────────────────

interface BridgeResponse {
  __seirtao: string; nonce: string; ok: boolean; error?: string;
  [k: string]: unknown;
}

function bridgeCall<T extends BridgeResponse>(
  target: Window,
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
      resolve({ __seirtao: expectedKind, nonce, ok: false, error: `timeout após ${timeoutMs}ms` } as T);
    }, timeoutMs);

    window.addEventListener('message', onMessage);
    try {
      target.postMessage({ ...payload, nonce }, '*');
    } catch (err) {
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve({
        __seirtao: expectedKind, nonce, ok: false,
        error: err instanceof Error ? err.message : String(err),
      } as T);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Extração do bloco "MODELO OTIMIZADO" (remove a seção de variáveis)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Remove o bloco "VARIÁVEIS IDENTIFICADAS" (e o cabeçalho "MODELO
 * OTIMIZADO", se houver) da saída bruta do otimizador. É o que queremos
 * realmente salvar como conteúdo do modelo no SEI.
 */
export function extractModeloTextFromOtimizador(raw: string): string {
  const varMatch = raw.match(/\n\s*VARI[ÁA]VEIS IDENTIFICADAS\s*\n/i);
  const body = varMatch ? raw.slice(0, varMatch.index ?? raw.length) : raw;
  return body
    .replace(/^\s*MODELO OTIMIZADO\s*\n/i, '')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────
// Orquestrador principal
// ─────────────────────────────────────────────────────────────────────────

export async function saveModeloFavorito(
  opts: SaveModeloOptions,
  cbs: SaverCallbacks = {},
): Promise<void> {
  const emit = (phase: SaverPhase, message: string): void => {
    console.log(`${LOG} [${phase}] ${message}`);
    cbs.onState?.({ phase, message });
  };
  const fail = (phase: SaverPhase, message: string, userHint: string): void => {
    console.warn(`${LOG} erro em ${phase}: ${message}`);
    cbs.onError?.({ phase, message, userHint });
  };

  const nome = opts.nome.trim();
  const descricao = opts.descricao.trim();
  const tipo = opts.tipoDocumento.trim();
  const conteudo = opts.conteudoTexto.trim();

  if (!nome) { fail('idle', 'Nome do modelo em branco.', 'Informe um nome para salvar.'); return; }
  if (!conteudo) { fail('idle', 'Conteúdo vazio.', 'Rode a otimização antes de salvar.'); return; }

  // 1. Localiza URL
  emit('locating', 'Procurando "Modelos Favoritos" no menu do SEI…');
  const cadastroUrl = findCadastroUrl();
  if (!cadastroUrl) {
    fail('locating',
      'Não encontrei link para "Modelos Favoritos" em nenhum menu do SEI.',
      'Abra Administração → Modelos → Modelos Favoritos ao menos uma vez nesta aba (para o menu carregar), ou verifique se seu perfil permite gerenciar modelos da unidade.');
    return;
  }
  console.log(`${LOG} URL cadastrar: ${cadastroUrl.slice(0, 140)}…`);

  // 2. Abre iframe oculto
  emit('loading-form', 'Abrindo formulário de cadastro…');
  const iframe = document.createElement('iframe');
  iframe.style.cssText =
    'position:fixed;left:-9999px;top:-9999px;width:1000px;height:700px;border:0;visibility:hidden;';
  iframe.src = cadastroUrl;
  document.body.appendChild(iframe);

  try {
    const formLoaded = await waitUntil(iframe, (doc) => {
      if (!doc.body) return false;
      // erro comum: SEI devolve a página de acesso-negado em vez do form
      const msgErro = doc.querySelector('#divInfraMsgErro, .infraMsgErro');
      if (msgErro && (msgErro.textContent ?? '').trim()) return true;
      return !!doc.querySelector(
        '#txtNome, input[name="txtNome"], #selSerie, select[name="selSerie"]',
      );
    }, 15_000);

    if (!formLoaded.ok) {
      fail('loading-form',
        'O formulário "Novo Modelo Favorito" não carregou dentro de 15s.',
        'A URL do cadastrar pode variar nesta versão do SEI. Abra manualmente Modelos Favoritos → Novo.');
      return;
    }
    const doc = formLoaded.doc!;

    // Acesso negado / erro precoce
    const earlyErr = doc.querySelector<HTMLElement>('#divInfraMsgErro, .infraMsgErro');
    if (earlyErr && (earlyErr.textContent ?? '').trim() &&
        !doc.querySelector('#txtNome, input[name="txtNome"]')) {
      const text = (earlyErr.textContent ?? '').trim().slice(0, 200);
      fail('loading-form',
        `O SEI retornou um erro ao abrir o cadastrar: ${text}`,
        'Seu perfil na unidade pode não ter permissão para cadastrar modelos favoritos. Procure o administrador da unidade no SEI.');
      return;
    }

    const win = iframe.contentWindow!;

    // 3. Preenche campos diretos
    emit('filling', 'Preenchendo nome, descrição e tipo…');
    const txtNome = doc.querySelector<HTMLInputElement>('#txtNome, input[name="txtNome"]');
    if (txtNome) {
      txtNome.value = nome;
      txtNome.dispatchEvent(new Event('input', { bubbles: true }));
      txtNome.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      console.warn(`${LOG} #txtNome ausente — seguindo sem nome.`);
    }

    const txaDesc = doc.querySelector<HTMLTextAreaElement>(
      '#txaDescricao, textarea[name="txaDescricao"], #txaObservacao, textarea[name="txaObservacao"]',
    );
    if (txaDesc && descricao) {
      txaDesc.value = descricao;
      txaDesc.dispatchEvent(new Event('input', { bubbles: true }));
      txaDesc.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Tipo de documento — select por texto (case-insensitive, exato > contém)
    if (tipo) {
      const selSerie = doc.querySelector<HTMLSelectElement>(
        '#selSerie, select[name="selSerie"], select[name*="erie" i], select[id*="Serie" i]',
      );
      if (selSerie) {
        const target = tipo.toLowerCase();
        let pickedValue: string | null = null;
        // 1ª passada: igualdade exata
        for (const opt of Array.from(selSerie.options)) {
          if ((opt.text ?? '').trim().toLowerCase() === target) {
            pickedValue = opt.value; break;
          }
        }
        // 2ª passada: contém
        if (pickedValue === null) {
          for (const opt of Array.from(selSerie.options)) {
            if ((opt.text ?? '').trim().toLowerCase().includes(target)) {
              pickedValue = opt.value; break;
            }
          }
        }
        if (pickedValue !== null) {
          selSerie.value = pickedValue;
          selSerie.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          console.warn(`${LOG} tipo "${tipo}" não casou nenhuma opção do select.`);
        }
      } else {
        console.warn(`${LOG} select de tipo de documento ausente — modelo será salvo sem tipo vinculado.`);
      }
    }

    // 4. Aguarda o CKEditor aparecer
    emit('awaiting-editor', 'Aguardando o editor do SEI inicializar…');
    const editorReady = await waitUntil(iframe, (d) => {
      return !!d.querySelector(
        '.ck-editor__editable[contenteditable="true"], [id^="txaEditor"], .cke_editable',
      );
    }, 15_000);
    if (!editorReady.ok) {
      fail('awaiting-editor',
        'O editor de texto do SEI não abriu na tela de cadastro.',
        'Este formulário pode exigir etapas adicionais (ex.: escolher o tipo antes do editor aparecer). Salve manualmente copiando o conteúdo.');
      return;
    }
    // folga extra para o CKEditor terminar a montagem de plugins
    await sleep(700);

    // 5. Injeta HTML via bridge
    emit('injecting', 'Injetando o modelo no editor…');
    const html = minutaTextToHtml(conteudo);
    const injectRes = await bridgeCall<BridgeResponse>(win, {
      __seirtao: 'ckeditor-set-data', html, mode: 'replace',
    }, 'ckeditor-set-data-result', 12_000);
    if (!injectRes.ok) {
      fail('injecting',
        `Falha ao injetar no CKEditor: ${injectRes.error ?? 'desconhecido'}.`,
        'Cole o conteúdo manualmente no editor da tela de cadastro.');
      return;
    }

    // 6. Submete — primeiro tenta botão nomeado, depois form.submit()
    emit('submitting', 'Enviando ao SEI…');
    const urlAntes = (() => { try { return iframe.contentDocument?.location.href ?? ''; } catch { return ''; } })();

    const btnSalvar = doc.querySelector<HTMLElement>(
      '#btnSalvar, #sbmSalvar, button#btnSalvar, input#sbmSalvar, input[type="submit"][value*="Salvar" i], button[type="submit"]',
    );
    if (btnSalvar) {
      try { btnSalvar.click(); }
      catch (err) { console.warn(`${LOG} click em Salvar falhou:`, err); }
    } else {
      const form = doc.querySelector<HTMLFormElement>('form');
      if (form) {
        try { form.submit(); }
        catch (err) {
          fail('submitting',
            'Botão Salvar e submit programático falharam.',
            'Clique em Salvar manualmente na tela aberta.');
          return;
        }
      } else {
        fail('submitting',
          'Botão "Salvar" não encontrado na tela.',
          'Clique em Salvar manualmente.');
        return;
      }
    }

    // 7. Aguarda resposta (navegação ou mensagem)
    const submitResult = await waitUntil(iframe, (d, url) => {
      if (url !== urlAntes) {
        // navegou: sucesso se foi para listar/gerenciar; aviso/erro também
        // interrompe a espera para lermos a mensagem.
        return true;
      }
      const err = d.querySelector('#divInfraMsgErro, .infraMsgErro');
      const avi = d.querySelector('#divInfraMsgAviso, .infraMsgAviso');
      return !!((err && (err.textContent ?? '').trim()) ||
                (avi && (avi.textContent ?? '').trim()));
    }, 15_000);

    if (!submitResult.ok) {
      fail('submitting',
        'O SEI não respondeu ao envio dentro de 15s.',
        'Verifique em Modelos Favoritos → Listar se o modelo foi cadastrado. Se não, repita manualmente.');
      return;
    }

    const postDoc = submitResult.doc!;
    const postUrl = submitResult.url ?? '';
    const errMsg = postDoc.querySelector<HTMLElement>('#divInfraMsgErro, .infraMsgErro');
    if (errMsg && (errMsg.textContent ?? '').trim()) {
      const text = (errMsg.textContent ?? '').trim().slice(0, 240);
      fail('submitting',
        `SEI recusou o cadastro: ${text}`,
        'Corrija o dado apontado pelo SEI e tente de novo, ou salve manualmente.');
      return;
    }

    // Sucesso: navegação para listar/gerenciar OU aviso sem erro
    const wentToListar = /md_gen_modelo_favorito_(listar|gerenciar)/.test(postUrl);
    const avisoMsg = postDoc.querySelector<HTMLElement>('#divInfraMsgAviso, .infraMsgAviso');
    const avisoText = (avisoMsg?.textContent ?? '').trim();

    if (wentToListar || avisoText) {
      const finalMsg = avisoText
        ? `Modelo "${nome}" salvo. SEI: ${avisoText.slice(0, 140)}`
        : `Modelo "${nome}" salvo nos Modelos Favoritos da unidade.`;
      emit('done', finalMsg);
      cbs.onDone?.({ phase: 'done', message: finalMsg });
      return;
    }

    // Caso ambíguo: URL mudou mas não para listar, sem mensagens explícitas.
    fail('submitting',
      'O SEI redirecionou para uma tela inesperada após o envio.',
      `Confira manualmente em Modelos Favoritos → Listar se o modelo "${nome}" aparece na lista.`);
  } finally {
    // Remove iframe após um pequeno atraso para não cortar logs de rede.
    window.setTimeout(() => { try { iframe.remove(); } catch { /* noop */ } }, 1500);
  }
}
