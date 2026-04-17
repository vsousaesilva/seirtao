/**
 * Orquestrador do botão "Otimizar modelo do SEI".
 *
 * Ação single-shot sobre um TEXTO cru (minuta-modelo colada pelo usuário):
 * não depende da árvore do processo nem dos documentos selecionados.
 *
 * Fluxo:
 *  1. recebe o texto do modelo do painel;
 *  2. monta mensagem única com `OTIMIZAR_MODELO_PROMPT` + o modelo;
 *  3. chama `streamFromBackend` com `documents: []` (sem contexto extra);
 *  4. os chunks do LLM voltam pelo mesmo contrato usado por resumir/minutar.
 *
 * A saída esperada tem 2 blocos — MODELO OTIMIZADO e VARIÁVEIS
 * IDENTIFICADAS — mas este orquestrador não parseia: a UI apresenta o
 * texto cru no stream-box padrão (com toolbar copiar/.doc/PDF/e-mail).
 */

import { OTIMIZAR_MODELO_PROMPT } from '../shared/prompts';
import { getActiveSettings, streamFromBackend } from './sei-chat-runner';
import type { ChatMessage, ChatStartPayload } from '../shared/types';

const LOG = '[SEIrtão/otimizar]';

export interface OtimizarCallbacks {
  onStarted(): void;
  onChunk(delta: string): void;
  onDone(): void;
  onError(message: string): void;
}

/** Limite defensivo: modelos muito grandes são truncados antes de enviar. */
const MAX_MODEL_CHARS = 40_000;

export async function otimizarModelo(
  modeloText: string,
  cbs: OtimizarCallbacks,
): Promise<void> {
  try {
    const texto = (modeloText ?? '').trim();
    if (!texto) {
      cbs.onError('Cole o texto do modelo antes de pedir a otimização.');
      return;
    }

    const truncado = texto.length > MAX_MODEL_CHARS
      ? texto.slice(0, MAX_MODEL_CHARS) + '\n\n[…texto truncado pelo SEIrtão para caber no contexto.]'
      : texto;

    const settings = await getActiveSettings();
    if (!settings) {
      cbs.onError('Não foi possível ler as configurações do provedor. Verifique o popup.');
      return;
    }

    const userMessage: ChatMessage = {
      role: 'user',
      content:
        OTIMIZAR_MODELO_PROMPT +
        '\n\n───\n\nMODELO DE ENTRADA (texto a ser otimizado):\n\n' +
        truncado,
      timestamp: Date.now(),
    };

    const payload: ChatStartPayload = {
      provider: settings.activeProvider as ChatStartPayload['provider'],
      model: settings.models[settings.activeProvider] ?? '',
      messages: [userMessage],
      documents: [],
      numeroProcesso: null,
    };

    console.log(`${LOG} enviando modelo ao LLM (${truncado.length} chars).`);
    cbs.onStarted();
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
