/**
 * Cache de documentos extraídos do processo, compartilhado entre todas as
 * ações do SEIrtão (resumir, minutar, chat, futuras ações). Antes cada ação
 * baixava o texto dos documentos do zero em toda invocação; agora a primeira
 * ação paga o custo e as seguintes reusam — a menos que a seleção de
 * documentos ou o processo mude.
 *
 * Chave do cache: `${numeroProcesso ?? '?'}|${ids.sort().join(',')}`. Qualquer
 * alteração na lista de ids (adição ou remoção) troca a chave e força re-fetch.
 * Chamadas concorrentes pra mesma chave compartilham a mesma Promise (dedup).
 */

import type { ArvoreProcesso } from './adapters/sei';
import type { ProcessoDocumento } from '../shared/types';
import {
  applyContextLimits,
  fetchDocsAsProcesso,
} from './sei-chat-runner';

const LOG = '[SEIrtão/cache]';

export type ProgressCb = (done: number, total: number, current: string) => void;

interface CacheEntry {
  key: string;
  docs: ProcessoDocumento[];
}

let entry: CacheEntry | null = null;
let inflight: { key: string; promise: Promise<ProcessoDocumento[]> } | null = null;

function computeKey(arvore: ArvoreProcesso, ids: Set<string>): string {
  const sorted = Array.from(ids).sort();
  return `${arvore.numeroProcesso ?? '?'}|${sorted.join(',')}`;
}

/**
 * Obtém os documentos da seleção atual, reutilizando cache quando a chave
 * bater. `onProgress` só é chamado em caso de miss — em hit o callback
 * recebe um pulso final informando a contagem já disponível.
 */
export async function getOrFetchDocs(
  arvore: ArvoreProcesso,
  selectedIds: Set<string>,
  onProgress: ProgressCb,
): Promise<ProcessoDocumento[]> {
  const key = computeKey(arvore, selectedIds);

  if (entry && entry.key === key) {
    const total = entry.docs.length;
    console.log(`${LOG} HIT — ${total} docs reaproveitados (key=${key.slice(0, 60)}…).`);
    onProgress(total, total, 'cache');
    return entry.docs;
  }

  if (inflight && inflight.key === key) {
    console.log(`${LOG} aguardando fetch em voo para mesma key.`);
    return inflight.promise;
  }

  console.log(`${LOG} MISS — baixando documentos (${selectedIds.size} ids, key=${key.slice(0, 60)}…).`);
  const promise = (async (): Promise<ProcessoDocumento[]> => {
    const docs = await fetchDocsAsProcesso(arvore, selectedIds, onProgress);
    if (docs.length === 0) return [];
    const trimmed = applyContextLimits(docs);
    entry = { key, docs: trimmed };
    console.log(`${LOG} armazenados ${trimmed.length} docs (~${trimmed.reduce((s, d) => s + (d.textoExtraido?.length ?? 0), 0).toLocaleString('pt-BR')} chars).`);
    return trimmed;
  })();

  inflight = { key, promise };
  try {
    return await promise;
  } finally {
    if (inflight && inflight.key === key) inflight = null;
  }
}

/** Retorna os documentos em cache, se a chave bater com a seleção passada. */
export function peekDocs(arvore: ArvoreProcesso, selectedIds: Set<string>): ProcessoDocumento[] | null {
  if (!entry) return null;
  return entry.key === computeKey(arvore, selectedIds) ? entry.docs : null;
}

/** Invalida tudo (ex.: quando a árvore do processo é recarregada). */
export function invalidateDocsCache(): void {
  entry = null;
  inflight = null;
}
