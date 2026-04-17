/**
 * Sessão de chat livre do SEIrtão.
 *
 * Diferente de `sei-resumir` e `sei-minutar` (ações de 1 turno), o chat
 * conversa com o usuário em múltiplos turnos sobre o mesmo processo.
 *
 * Os documentos do processo vêm do cache compartilhado (`sei-docs-cache`),
 * o mesmo usado por resumir/minutar — se uma ação anterior já baixou a
 * seleção atual, o chat reusa sem refetch.
 *
 * O histórico de mensagens é enviado integralmente a cada turno — o
 * provedor/background é stateless entre chamadas.
 */

import type { ArvoreProcesso } from './adapters/sei';
import { getActiveSettings, streamFromBackend } from './sei-chat-runner';
import { getOrFetchDocs } from './sei-docs-cache';
import type {
  ChatMessage,
  ChatStartPayload,
  ProcessoDocumento,
} from '../shared/types';
import type { ChatController } from './ui/seirtao-panel';

const LOG = '[SEIrtão/chat]';

export interface ChatSession {
  /** Envia uma pergunta do usuário. Concorrente pendente é ignorado. */
  send(text: string): Promise<void>;
  /** Limpa cache e histórico (botão "Nova" no painel). */
  reset(): void;
}

export function createChatSession(
  getArvore: () => ArvoreProcesso | null,
  getSelectedDocIds: () => Set<string>,
  view: ChatController,
): ChatSession {
  let history: ChatMessage[] = [];
  let busy = false;

  const ensureDocs = async (ids: Set<string>): Promise<ProcessoDocumento[] | null> => {
    const arvore = getArvore();
    if (!arvore) return null;

    view.setStatus('Preparando documentos selecionados…');
    const docs = await getOrFetchDocs(arvore, ids, (done, total, current) => {
      if (current === 'cache') {
        view.setStatus(`${total} documentos no contexto (cache).`);
      } else {
        view.setStatus(`Lendo ${done}/${total} — ${current}`);
      }
    });
    if (docs.length === 0) return [];

    view.setStatus(`${docs.length} documentos no contexto (~${docs.reduce((s, d) => s + (d.textoExtraido?.length ?? 0), 0).toLocaleString('pt-BR')} caracteres).`);
    return docs;
  };

  const send = async (text: string): Promise<void> => {
    if (busy) return;
    if (!text.trim()) return;

    const arvore = getArvore();
    if (!arvore) {
      view.appendUserMessage(text);
      view.startAssistantMessage();
      view.errorAssistantMessage('Árvore do processo ainda não foi carregada.');
      return;
    }

    const ids = getSelectedDocIds();
    if (ids.size === 0) {
      view.appendUserMessage(text);
      view.startAssistantMessage();
      view.errorAssistantMessage('Nenhum documento selecionado. Marque ao menos um documento na seção "Documentos".');
      return;
    }

    busy = true;
    view.setBusy(true);
    view.appendUserMessage(text);

    try {
      const docs = await ensureDocs(ids);
      if (!docs) {
        view.startAssistantMessage();
        view.errorAssistantMessage('Árvore do processo indisponível.');
        return;
      }
      if (docs.length === 0) {
        view.startAssistantMessage();
        view.errorAssistantMessage('Nenhum documento devolveu texto legível. Pode ser PDF digitalizado (precisa de OCR).');
        return;
      }

      const settings = await getActiveSettings();
      if (!settings) {
        view.startAssistantMessage();
        view.errorAssistantMessage('Não foi possível ler as configurações do provedor. Verifique o popup.');
        return;
      }

      history.push({ role: 'user', content: text, timestamp: Date.now() });

      const payload: ChatStartPayload = {
        provider: settings.activeProvider as ChatStartPayload['provider'],
        model: settings.models[settings.activeProvider] ?? '',
        messages: history.slice(),
        documents: docs,
        numeroProcesso: arvore.numeroProcesso,
      };

      console.log(`${LOG} turno ${history.length} — enviando (${docs.length} docs, histórico: ${history.length} msgs)`);

      await new Promise<void>((resolve) => {
        let assistantText = '';
        let started = false;
        streamFromBackend(payload, {
          onChunk: (delta) => {
            if (!started) {
              view.startAssistantMessage();
              started = true;
            }
            assistantText += delta;
            view.appendAssistantChunk(delta);
          },
          onDone: () => {
            if (!started) view.startAssistantMessage();
            view.finishAssistantMessage();
            history.push({ role: 'assistant', content: assistantText, timestamp: Date.now() });
            resolve();
          },
          onError: (msg) => {
            if (!started) view.startAssistantMessage();
            view.errorAssistantMessage(msg);
            // Remove última mensagem user para o histórico não ficar com um
            // turno incompleto — usuário pode editar e reenviar.
            history.pop();
            resolve();
          },
        });
      });
    } catch (err) {
      console.error(`${LOG} erro inesperado:`, err);
      view.startAssistantMessage();
      view.errorAssistantMessage(err instanceof Error ? err.message : String(err));
      history.pop();
    } finally {
      busy = false;
      view.setBusy(false);
    }
  };

  const reset = (): void => {
    history = [];
    view.reset();
  };

  return { send, reset };
}
