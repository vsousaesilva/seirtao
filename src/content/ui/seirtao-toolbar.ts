/**
 * Injeta um botão SEIrtão destacado na barra superior direita do SEI.
 *
 * Alvo: `#divInfraBarraSistemaPadraoD` (onde ficam Controle de Processos,
 * Novidades, Unidade, etc.). O botão é um pill azul institucional com
 * ícone + texto "SEIrtão" — intencionalmente mais largo que os ícones
 * nativos do SEI para sinalizar claramente ao servidor onde está o
 * assistente. Só é montado quando há um processo aberto (gate feito em
 * `sei-bootstrap.ts`).
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
      gap: 8px;
      padding: 6px 14px 6px 10px;
      min-height: 30px;
      background: linear-gradient(135deg, #1351B4 0%, #0C326F 100%);
      color: #ffffff !important;
      border-radius: 999px;
      box-shadow: 0 2px 8px rgba(12,50,111,0.25), inset 0 1px 0 rgba(255,255,255,0.18);
      font-family: "Inter","Rawline",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.3px;
      text-decoration: none !important;
      line-height: 1;
      cursor: pointer;
      transition: transform 140ms ease, box-shadow 140ms ease, filter 140ms ease;
      white-space: nowrap;
    }
    #${BUTTON_ID} > a.seirtao-pill:hover,
    #${BUTTON_ID} > a.seirtao-pill:focus-visible {
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(12,50,111,0.35), inset 0 1px 0 rgba(255,255,255,0.22);
      filter: brightness(1.05);
      outline: none;
    }
    #${BUTTON_ID} > a.seirtao-pill:active {
      transform: translateY(0);
      box-shadow: 0 2px 6px rgba(12,50,111,0.30), inset 0 1px 0 rgba(255,255,255,0.14);
    }
    #${BUTTON_ID} > a.seirtao-pill > img {
      width: 20px;
      height: 20px;
      border-radius: 5px;
      flex-shrink: 0;
      display: block;
      background: rgba(255,255,255,0.12);
      padding: 2px;
    }
    #${BUTTON_ID} > a.seirtao-pill > span.seirtao-label {
      color: #ffffff;
      font-weight: 600;
    }
    #${BUTTON_ID} > a.seirtao-pill > span.seirtao-badge {
      display: inline-block;
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      padding: 2px 6px;
      border-radius: 999px;
      background: rgba(255,205,7,0.95);
      color: #0C326F;
      margin-left: 2px;
      line-height: 1.1;
    }
    /* Em layouts estreitos do SEI, o próprio SEI esconde elementos com
       classes d-none d-md-block. Aqui queremos manter o pill sempre
       visível — ele substitui tanto o modo desktop quanto o mobile. */
    @media (max-width: 767px) {
      #${BUTTON_ID} > a.seirtao-pill {
        padding: 6px 10px 6px 8px;
        font-size: 12px;
      }
      #${BUTTON_ID} > a.seirtao-pill > span.seirtao-badge { display: none; }
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
      <span class="seirtao-badge">beta</span>
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
