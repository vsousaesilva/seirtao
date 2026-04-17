/**
 * Orquestrador do botão "Minutar próximo ato" do painel do SEIrtão.
 *
 * - 1ª rodada (`minutarProximoAto`): triagem + sugestão do ato.
 * - 2ª rodada (`minutarAtoEspecifico`): gera APENAS o corpo da minuta para
 *   o ato já escolhido pelo usuário. Antes de chamar o LLM, consulta o
 *   índice BM25 dos modelos cadastrados pelo usuário (via
 *   `chrome.runtime.sendMessage` ao service worker) e, quando encontra um
 *   modelo compatível, injeta-o no prompt como gabarito (atos de
 *   `rigidez='gabarito'`: informação, parecer, decisão) ou como referência
 *   de estilo (`rigidez='referencia'`: despacho, ordinatório, memorando,
 *   ofício). Sem modelo cadastrado ou sem match, cai no fallback
 *   `buildMinutaWithTemplatePrompt(ato, null, orientations)`.
 */

import { MESSAGE_CHANNELS } from '../shared/constants';
import {
  MINUTAR_PROXIMO_ATO_PROMPT,
  buildMinutaOnlyPrompt,
  buildMinutaWithTemplatePrompt,
  findAtoByLabel,
  type AtoAdministrativo,
} from '../shared/prompts';
import { runChatOnProcesso, type ChatRunCallbacks } from './sei-chat-runner';
import type { ArvoreProcesso } from './adapters/sei';

export type MinutarCallbacks = ChatRunCallbacks;

const LOG = '[SEIrtão/minutar]';

/** Score mínimo do top-1 BM25 para aceitar o modelo automaticamente. */
const MIN_SIMILARITY_AUTO = 40; // similaridade relativa (0..100)

export interface TemplateCandidate {
  id: number | undefined;
  relativePath: string;
  name: string;
  similarity: number;
  matchedFolderHint: boolean;
  /** Texto completo — já vem embutido na resposta do handler. */
  text: string;
}

interface TemplatesSearchResponse {
  ok: boolean;
  results?: Array<{
    id: number;
    relativePath: string;
    name: string;
    ext: string;
    charCount: number;
    score: number;
    similarity: number;
    matchedFolderHint: boolean;
    text: string;
  }>;
  error?: string;
}

interface TemplatesHasConfigResponse {
  ok: boolean;
  hasTemplates: boolean;
  error?: string;
}

export async function minutarProximoAto(
  arvore: ArvoreProcesso,
  cbs: MinutarCallbacks,
  allowedIds: Set<string> | null = null,
): Promise<void> {
  return runChatOnProcesso(arvore, MINUTAR_PROXIMO_ATO_PROMPT, cbs, allowedIds);
}

/**
 * Descobre se há modelos indexados no IndexedDB. Usa o handler
 * `TEMPLATES_HAS_CONFIG` do service worker. Em caso de falha, assume
 * `false` (fallback silencioso).
 */
export async function hasTemplatesConfigured(): Promise<boolean> {
  try {
    const resp = (await chrome.runtime.sendMessage({
      channel: MESSAGE_CHANNELS.TEMPLATES_HAS_CONFIG,
      payload: null,
    })) as TemplatesHasConfigResponse | undefined;
    return !!resp?.ok && !!resp.hasTemplates;
  } catch (err) {
    console.warn(`${LOG} TEMPLATES_HAS_CONFIG falhou:`, err);
    return false;
  }
}

/**
 * Consulta o handler `TEMPLATES_SEARCH` do service worker para obter os
 * top-K modelos compatíveis com o ato administrativo fornecido. A query
 * concatena `label` do ato + orientações do usuário, para que BM25 leve
 * em conta os termos específicos que o usuário quer ver na minuta.
 */
export async function searchTemplatesForAto(
  ato: AtoAdministrativo,
  orientations: string | undefined,
  topK = 3,
): Promise<TemplateCandidate[]> {
  const query = `${ato.label} ${orientations ?? ''}`.trim();
  try {
    const resp = (await chrome.runtime.sendMessage({
      channel: MESSAGE_CHANNELS.TEMPLATES_SEARCH,
      payload: {
        query,
        opts: {
          topK,
          folderHints: Array.from(ato.folderHints),
          excludeTerms: Array.from(ato.excludeTerms),
          minScore: 0.1,
        },
      },
    })) as TemplatesSearchResponse | undefined;
    if (!resp?.ok || !resp.results) return [];
    return resp.results.map((r) => ({
      id: r.id,
      relativePath: r.relativePath,
      name: r.name,
      similarity: r.similarity,
      matchedFolderHint: r.matchedFolderHint,
      text: r.text,
    }));
  } catch (err) {
    console.warn(`${LOG} TEMPLATES_SEARCH falhou:`, err);
    return [];
  }
}

/**
 * Escolhe o template a ser usado como base da minuta, considerando:
 *   1. Override explícito do usuário (escolha no seletor do painel):
 *      - `'__none__'` → sem modelo;
 *      - qualquer outro valor → usa o candidato com esse `relativePath`.
 *   2. Autoseleção: se o top-1 bater `MIN_SIMILARITY_AUTO`, usa-o.
 *   3. Caso contrário, null (fallback sem modelo).
 */
function pickTemplate(
  candidates: TemplateCandidate[],
  override: string | undefined,
): TemplateCandidate | null {
  if (override === '__none__') return null;
  if (override) {
    const hit = candidates.find((c) => c.relativePath === override);
    if (hit) return hit;
  }
  const top = candidates[0];
  if (top && top.similarity >= MIN_SIMILARITY_AUTO) return top;
  return null;
}

/**
 * Segunda rodada: gera APENAS o corpo da minuta para um ato já escolhido
 * pelo usuário (pode ser o sugerido na triagem, outro dos 8 atos do
 * catálogo ou um tipo de documento descoberto via Fase B).
 *
 * `orientations` é o texto livre do textarea "Orientações adicionais"
 * do painel. `templateOverride` é opcional: quando o usuário escolhe
 * manualmente um modelo no seletor, passamos o `relativePath` aqui — ou
 * `'__none__'` para forçar geração sem modelo.
 */
export async function minutarAtoEspecifico(
  arvore: ArvoreProcesso,
  atoLabel: string,
  orientations: string | undefined,
  cbs: MinutarCallbacks,
  allowedIds: Set<string> | null = null,
  templateOverride?: string,
): Promise<void> {
  const ato = findAtoByLabel(atoLabel);

  // Se o rótulo não casa com nenhum ato do catálogo (ex.: tipo de documento
  // descoberto via Fase B que não tem equivalente direto), mantém o
  // comportamento antigo — prompt genérico sem suporte a modelos.
  if (!ato) {
    console.log(`${LOG} ato "${atoLabel}" fora do catálogo — usando prompt genérico.`);
    const prompt = buildMinutaOnlyPrompt(atoLabel, orientations);
    return runChatOnProcesso(arvore, prompt, cbs, allowedIds);
  }

  const hasTemplates = await hasTemplatesConfigured();

  let picked: TemplateCandidate | null = null;
  if (hasTemplates) {
    const candidates = await searchTemplatesForAto(ato, orientations, 3);
    picked = pickTemplate(candidates, templateOverride);

    if (picked) {
      const modoTxt = ato.rigidez === 'gabarito' ? 'gabarito' : 'referência';
      cbs.onProgress(
        0,
        1,
        `modelo (${modoTxt}): ${picked.name} — ${picked.similarity.toFixed(0)}% compatível`,
      );
    } else if (templateOverride === '__none__') {
      cbs.onProgress(0, 1, 'gerando sem modelo (escolha do usuário)');
    } else if (candidates.length > 0) {
      cbs.onProgress(
        0,
        1,
        `nenhum modelo passou no limiar de ${MIN_SIMILARITY_AUTO}% — gerando sem modelo`,
      );
    } else {
      cbs.onProgress(0, 1, 'nenhum modelo compatível encontrado — gerando sem modelo');
    }
  }

  const prompt = buildMinutaWithTemplatePrompt(
    ato,
    picked ? { relativePath: picked.relativePath, text: picked.text } : null,
    orientations,
  );
  return runChatOnProcesso(arvore, prompt, cbs, allowedIds);
}
