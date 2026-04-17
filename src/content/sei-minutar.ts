/**
 * Orquestrador do botão "Minutar próximo ato" do painel do SEIrtão.
 *
 * Wrapper fino sobre `runChatOnProcesso`, usando o `MINUTAR_PROXIMO_ATO_PROMPT`
 * de shared/prompts.ts. A saída vem em três blocos fixos (ATO SUGERIDO /
 * JUSTIFICATIVA / MINUTA) — a UI pode, em iteração futura, extrair só a
 * seção MINUTA com regex para um botão "Copiar só a minuta".
 */

import {
  MINUTAR_PROXIMO_ATO_PROMPT,
  buildMinutaOnlyPrompt,
} from '../shared/prompts';
import { runChatOnProcesso, type ChatRunCallbacks } from './sei-chat-runner';
import type { ArvoreProcesso } from './adapters/sei';

export type MinutarCallbacks = ChatRunCallbacks;

export async function minutarProximoAto(
  arvore: ArvoreProcesso,
  cbs: MinutarCallbacks,
  allowedIds: Set<string> | null = null,
): Promise<void> {
  return runChatOnProcesso(arvore, MINUTAR_PROXIMO_ATO_PROMPT, cbs, allowedIds);
}

/**
 * Segunda rodada: gera APENAS o corpo da minuta para um ato já escolhido
 * pelo usuário (pode ser o sugerido na triagem, outro dos 8 atos do
 * catálogo ou um tipo de documento discoverado via Fase B).
 * `orientations` é livre (textarea "Orientações adicionais" do painel).
 */
export async function minutarAtoEspecifico(
  arvore: ArvoreProcesso,
  atoLabel: string,
  orientations: string | undefined,
  cbs: MinutarCallbacks,
  allowedIds: Set<string> | null = null,
): Promise<void> {
  const prompt = buildMinutaOnlyPrompt(atoLabel, orientations);
  return runChatOnProcesso(arvore, prompt, cbs, allowedIds);
}
