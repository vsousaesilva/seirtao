/**
 * Injeta um botão SEIrtão discreto na barra superior direita do SEI.
 *
 * Alvo: `#divInfraBarraSistemaPadraoD` (onde ficam Controle de Processos,
 * Novidades, Unidade, etc.). O botão adota a paleta institucional do SEI
 * (azul govbr #1351B4 / #0C326F) com acabamento chapado, bordas pouco
 * arredondadas e altura compatível com os itens nativos da barra —
 * sinaliza presença sem competir visualmente com a UI do SEI. Só é
 * montado quando há um processo aberto (gate feito em `sei-bootstrap.ts`).
 */

const BUTTON_ID = 'seirtao-nav-button';
const STYLE_ID = 'seirtao-nav-button-style';

export interface ToolbarController {
  onClick(handler: () => void): void;
}

/** Injeta o stylesheet do botão uma única vez no `<head>` do documento. */
function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${BUTTON_ID} {
      display: inline-flex;
      align-items: center;
      margin: 0 6px;
      padding: 0;
      background: transparent;
      border: 0;
    }
    #${BUTTON_ID} > a.seirtao-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      min-height: 24px;
      background: #1351B4;
      color: #ffffff !important;
      border: 1px solid #0C326F;
      border-radius: 3px;
      font-family: "Rawline","Segoe UI",Tahoma,Verdana,Arial,sans-serif;
      font-size: 12px;
      font-weight: 500;
      letter-spacing: 0.1px;
      text-decoration: none !important;
      line-height: 1.2;
      cursor: pointer;
      transition: background-color 120ms ease, border-color 120ms ease;
      white-space: nowrap;
    }
    #${BUTTON_ID} > a.seirtao-pill:hover,
    #${BUTTON_ID} > a.seirtao-pill:focus-visible {
      background: #0C326F;
      border-color: #071D3F;
      outline: none;
    }
    #${BUTTON_ID} > a.seirtao-pill:active {
      background: #071D3F;
    }
    #${BUTTON_ID} > a.seirtao-pill > img {
      width: 16px;
      height: 16px;
      border-radius: 2px;
      flex-shrink: 0;
      display: block;
    }
    #${BUTTON_ID} > a.seirtao-pill > span.seirtao-label {
      color: #ffffff;
      font-weight: 500;
    }
    /* Em layouts estreitos do SEI, o próprio SEI esconde elementos com
       classes d-none d-md-block. Aqui queremos manter o botão sempre
       visível — ele substitui tanto o modo desktop quanto o mobile. */
    @media (max-width: 767px) {
      #${BUTTON_ID} > a.seirtao-pill {
        padding: 3px 8px;
        font-size: 11.5px;
      }
    }
  `;
  document.head.appendChild(style);
}

export function mountToolbarButton(navRight?: HTMLElement | null): ToolbarController | null {
  if (document.getElementById(BUTTON_ID)) {
    const existing = document.getElementById(BUTTON_ID) as HTMLElement;
    return (existing as unknown as { _ctrl: ToolbarController })._ctrl;
  }

  const target = navRight ?? document.getElementById('divInfraBarraSistemaPadraoD');
  if (!target) return null;

  ensureStyle();

  const iconUrl = chrome.runtime.getURL('icons/icon32.png');

  const wrapper = document.createElement('div');
  wrapper.id = BUTTON_ID;
  wrapper.className = 'nav-item d-flex infraAcaoBarraSistema';
  wrapper.innerHTML = `
    <a class="seirtao-pill"
       href="javascript:void(0);"
       role="button"
       title="SEIrtão — assistente de análise do processo administrativo"
       aria-label="Abrir assistente SEIrtão"
       tabindex="80">
      <img src="${iconUrl}" alt="" />
      <span class="seirtao-label">SEIrtão</span>
    </a>
  `;

  // Insere no início da barra direita, logo antes de "Controle de Processos".
  target.prepend(wrapper);

  const handlers: Array<() => void> = [];
  wrapper.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    handlers.forEach((h) => h());
  });

  const ctrl: ToolbarController = {
    onClick(handler) { handlers.push(handler); },
  };
  (wrapper as unknown as { _ctrl: ToolbarController })._ctrl = ctrl;
  return ctrl;
}
