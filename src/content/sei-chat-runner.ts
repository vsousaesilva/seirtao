/**
 * Runner genérico de análise por streaming para o SEIrtão.
 *
 * Fornece três primitivas reusáveis:
 *   - `fetchDocsAsProcesso(arvore, allowedIds, onProgress)` — baixa em
 *     paralelo os documentos elegíveis e devolve `ProcessoDocumento[]`
 *     no shape esperado pelo background/provider.
 *   - `streamFromBackend(payload, cbs)` — abre a chat-port com o service
 *     worker e faz o streaming dos chunks.
 *   - `runChatOnProcesso(arvore, prompt, cbs, allowedIds?)` — conveniência
 *     para ações single-shot (resumir/minutar): compõe as duas primitivas
 *     com uma única mensagem de usuário contendo `prompt`.
 *
 * O chat livre (`sei-chat.ts`) usa as primitivas separadamente para
 * poder cachear os documentos entre turnos e preservar o histórico.
 */

import {
  CHAT_PORT_MSG,
  CONTEXT_LIMITS,
  PORT_NAMES,
} from '../shared/constants';
import type {
  ChatMessage,
  ChatStartPayload,
  ProcessoDocumento,
} from '../shared/types';
import { fetchDocumentoTexto, type ArvoreProcesso, type NoArvore } from './adapters/sei';

const LOG = '[SEIrtão/runner]';
const FETCH_CONCURRENCY = 4;

export interface ChatRunCallbacks {
  onProgress(done: number, total: number, current: string): void;
  onChunk(delta: string): void;
  onDone(): void;
  onError(message: string): void;
}

export interface StreamCallbacks {
  onChunk(delta: string): void;
  onDone(): void;
  onError(message: string): void;
}

async function parallelMap<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

function toProcessoDocumento(no: NoArvore, texto: string): ProcessoDocumento {
  return {
    id: no.id,
    tipo: no.label.split(/\s+/)[0] ?? 'Documento',
    descricao: no.label,
    dataMovimentacao: '',
    mimeType: 'text/html',
    url: no.src ?? '',
    textoExtraido: texto,
  };
}

/**
 * Trunca texto por documento e pelo total conforme CONTEXT_LIMITS.
 * Aplicado antes de qualquer envio ao LLM para não estourar o context
 * window do provedor.
 */
export function applyContextLimits(docs: ProcessoDocumento[]): ProcessoDocumento[] {
  const capped = docs.map((d) => {
    const t = d.textoExtraido ?? '';
    if (t.length <= CONTEXT_LIMITS.PER_DOCUMENT_HARD_CAP) return d;
    return { ...d, textoExtraido: t.slice(0, CONTEXT_LIMITS.PER_DOCUMENT_HARD_CAP) + '\n…[truncado]' };
  });
  let acc = 0;
  const out: ProcessoDocumento[] = [];
  for (const d of capped) {
    const len = (d.textoExtraido ?? '').length;
    if (acc + len > CONTEXT_LIMITS.MAX_DOCUMENTS_CHARS) {
      const remain = Math.max(0, CONTEXT_LIMITS.MAX_DOCUMENTS_CHARS - acc);
      if (remain > 1000) {
        out.push({ ...d, textoExtraido: (d.textoExtraido ?? '').slice(0, remain) + '\n…[truncado pelo total]' });
      }
      break;
    }
    out.push(d);
    acc += len;
  }
  return out;
}

/**
 * Baixa em paralelo o texto de todos os documentos elegíveis da árvore.
 *
 * `allowedIds`: se fornecido, restringe aos ids listados; se `null`,
 * pega todos os nós `DOCUMENTO` com `src`. Documentos que falham ou
 * retornam vazio são descartados silenciosamente (com aviso no console).
 */
export async function fetchDocsAsProcesso(
  arvore: ArvoreProcesso,
  allowedIds: Set<string> | null,
  onProgress: (done: number, total: number, current: string) => void,
): Promise<ProcessoDocumento[]> {
  const candidatos = arvore.nos.filter(
    (n) => n.tipo === 'DOCUMENTO' && !!n.src && (!allowedIds || allowedIds.has(n.id)),
  );
  if (candidatos.length === 0) return [];

  console.log(`${LOG} ${candidatos.length} documentos para baixar.`);
  onProgress(0, candidatos.length, 'preparando…');

  let done = 0;
  const textos = await parallelMap(candidatos, FETCH_CONCURRENCY, async (no) => {
    try {
      const texto = await fetchDocumentoTexto(no.src!);
      done++;
      onProgress(done, candidatos.length, no.label);
      return texto;
    } catch (err) {
      done++;
      console.warn(`${LOG} falha ao baixar doc ${no.id}:`, err);
      onProgress(done, candidatos.length, `(falhou) ${no.label}`);
      return '';
    }
  });

  return candidatos
    .map((no, i) => toProcessoDocumento(no, textos[i] ?? ''))
    .filter((d) => (d.textoExtraido ?? '').length > 0);
}

/**
 * Abre uma chat-port com o service worker e faz o streaming da resposta.
 * Centraliza a lógica de mensagens para ser reusada por resumir/minutar
 * (1 turno) e pelo chat livre (N turnos).
 */
export function streamFromBackend(payload: ChatStartPayload, cbs: StreamCallbacks): void {
  const port = chrome.runtime.connect({ name: PORT_NAMES.CHAT_STREAM });
  port.onMessage.addListener((msg: { type: string; delta?: string; error?: string }) => {
    if (msg.type === CHAT_PORT_MSG.CHUNK && typeof msg.delta === 'string') {
      cbs.onChunk(msg.delta);
    } else if (msg.type === CHAT_PORT_MSG.DONE) {
      cbs.onDone();
      port.disconnect();
    } else if (msg.type === CHAT_PORT_MSG.ERROR) {
      cbs.onError(msg.error ?? 'Erro desconhecido do provedor.');
      port.disconnect();
    }
  });
  port.postMessage({ type: CHAT_PORT_MSG.START, payload });
}

/** Lê settings do provedor ativo via canal do background. */
export async function getActiveSettings(): Promise<{ activeProvider: string; models: Record<string, string> } | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ channel: 'paidegua/get-settings', payload: null }, (resp) => {
      resolve(resp?.ok ? resp.settings : null);
    });
  });
}

/**
 * Executa um prompt contra os documentos selecionados do processo em
 * streaming. Usado por resumir/minutar — ações de 1 turno sem histórico.
 *
 * Usa o cache compartilhado `sei-docs-cache`: se outra ação já baixou os
 * mesmos documentos nesta sessão, reutiliza sem refetch.
 */
export async function runChatOnProcesso(
  arvore: ArvoreProcesso,
  prompt: string,
  cbs: ChatRunCallbacks,
  allowedIds: Set<string> | null = null,
): Promise<void> {
  try {
    const effectiveIds =
      allowedIds ??
      new Set(arvore.nos.filter((n) => n.tipo === 'DOCUMENTO' && !!n.src).map((n) => n.id));

    if (effectiveIds.size === 0) {
      cbs.onError('Nenhum documento selecionado.');
      return;
    }

    const { getOrFetchDocs } = await import('./sei-docs-cache');
    const trimmed = await getOrFetchDocs(arvore, effectiveIds, cbs.onProgress);

    if (trimmed.length === 0) {
      cbs.onError('Nenhum documento devolveu texto legível. Pode ser PDF digitalizado (precisa de OCR).');
      return;
    }

    console.log(`${LOG} enviando ${trimmed.length} docs ao LLM (~${trimmed.reduce((s, d) => s + (d.textoExtraido?.length ?? 0), 0)} chars).`);

    const initial: ChatMessage = {
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    };

    const settings = await getActiveSettings();
    if (!settings) {
      cbs.onError('Não foi possível ler as configurações do provedor. Verifique o popup.');
      return;
    }

    const payload: ChatStartPayload = {
      provider: settings.activeProvider as ChatStartPayload['provider'],
      model: settings.models[settings.activeProvider] ?? '',
      messages: [initial],
      documents: trimmed,
      numeroProcesso: arvore.numeroProcesso,
    };

    streamFromBackend(payload, {
      onChunk: cbs.onChunk,
      onDone: cbs.onDone,
      onError: cbs.onError,
    });
  } catch (err) {
    console.error(`${LOG} erro inesperado:`, err);
    cbs.onError(err instanceof Error ? err.message : String(err));
  }
}
