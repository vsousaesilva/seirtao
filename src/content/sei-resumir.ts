/**
 * Orquestrador do botão "Analisar processo administrativo" do painel.
 * Wrapper fino sobre `runChatOnProcesso`, usando o prompt `resumir` das
 * QUICK_ACTIONS (análise estruturada do processo administrativo).
 */

import { QUICK_ACTIONS } from '../shared/prompts';
import { runChatOnProcesso, type ChatRunCallbacks } from './sei-chat-runner';
import type { ArvoreProcesso } from './adapters/sei';

export type ResumirCallbacks = ChatRunCallbacks;

export async function resumirProcesso(
  arvore: ArvoreProcesso,
  cbs: ResumirCallbacks,
  allowedIds: Set<string> | null = null,
): Promise<void> {
  const prompt = QUICK_ACTIONS.find((q) => q.id === 'resumir')?.prompt
    ?? 'Analise o processo administrativo com base nos documentos fornecidos.';
  return runChatOnProcesso(arvore, prompt, cbs, allowedIds);
}
