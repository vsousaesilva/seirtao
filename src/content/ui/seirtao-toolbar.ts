/**
 * Injeta o botão SEIrtão na barra superior direita do SEI.
 *
 * Alvo: `#divInfraBarraSistemaPadraoD` (onde ficam Controle de Processos,
 * Novidades, Unidade, etc.). Segue o mesmo padrão visual do FAB do
 * pAIdegua — gradiente institucional govbr (#1351B4 → #0C326F), formato
 * pill com cantos arredondados, sombra sutil e detalhe amarelo (#FFCD07)
 * como acento institucional — adaptado para inline dentro da toolbar do
 * SEI. Só é montado quando há um processo aberto (gate em
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
      padding: 5px 14px 5px 10px;
      min-height: 28px;
      background: linear-gradient(135deg, #1351B4 0%, #0C326F 100%);
      color: #ffffff !important;
      border: 0;
      border-radius: 999px;
      font-family: "Rawline","Raleway","Segoe UI",Tahoma,Verdana,Arial,sans-serif;
      font-size: 12.5px;
      font-weight: 600;
      letter-spacing: 0.15px;
      text-decoration: none !important;
      line-height: 1.2;
      cursor: pointer;
      box-shadow:
        0 4px 12px rgba(19, 81, 180, 0.32),
        0 1px 3px rgba(12, 50, 111, 0.18),
        inset 0 1px 0 rgba(255, 255, 255, 0.22);
      transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease;
      white-space: nowrap;
    }
    #${BUTTON_ID} > a.seirtao-pill:hover {
      background: linear-gradient(135deg, #0C326F 0%, #1351B4 100%);
      box-shadow:
        0 6px 16px rgba(19, 81, 180, 0.42),
        0 2px 5px rgba(12, 50, 111, 0.22),
        inset 0 1px 0 rgba(255, 255, 255, 0.28);
      transform: translateY(-1px);
    }
    #${BUTTON_ID} > a.seirtao-pill:focus-visible {
      outline: 2px solid rgba(255, 205, 7, 0.85);
      outline-offset: 2px;
    }
    #${BUTTON_ID} > a.seirtao-pill:active {
      transform: translateY(0);
      box-shadow:
        0 2px 6px rgba(19, 81, 180, 0.28),
        inset 0 1px 2px rgba(12, 50, 111, 0.25);
    }
    #${BUTTON_ID} > a.seirtao-pill > .seirtao-pill-icon {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.16);
      border: 1px solid rgba(255, 255, 255, 0.22);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      position: relative;
    }
    #${BUTTON_ID} > a.seirtao-pill > .seirtao-pill-icon > img {
      width: 14px;
      height: 14px;
      display: block;
    }
    #${BUTTON_ID} > a.seirtao-pill > .seirtao-pill-icon::after {
      content: "";
      position: absolute;
      bottom: -1px;
      right: -1px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #FFCD07;
      box-shadow: 0 0 0 1.5px #0C326F;
    }
    #${BUTTON_ID} > a.seirtao-pill > span.seirtao-label {
      color: #ffffff;
      font-weight: 600;
    }
    @media (max-width: 767px) {
      #${BUTTON_ID} > a.seirtao-pill {
        padding: 4px 12px 4px 8px;
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
      <span class="seirtao-pill-icon" aria-hidden="true">
        <img src="${iconUrl}" alt="" />
      </span>
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
