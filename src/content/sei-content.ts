/**
 * Entry point do content script do SEIrtão.
 *
 * Intencionalmente minimalista — não arrasta dependências pesadas
 * (pdfjs, tesseract, UI do paidegua). Só monta o bootstrap do SEI,
 * que por sua vez carrega a UI (botão na navbar + sidebar) sob demanda.
 */

import { bootSeirtao } from './sei-bootstrap';

try {
  bootSeirtao();
} catch (err) {
  console.error('[SEIrtão] erro no bootstrap:', err);
}
