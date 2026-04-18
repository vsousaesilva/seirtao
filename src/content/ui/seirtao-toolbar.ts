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
      min-height: 30px;
      /* Fundo transparente para herdar a cor do header do SEI */
      background: transparent;
      color: #ffffff !important;
      border: 1.5px solid rgba(255, 255, 255, 0.85);
      border-radius: 8px;
      font-family: "Rawline","Raleway","Segoe UI",Tahoma,Verdana,Arial,sans-serif;
      font-size: 12.5px;
      font-weight: 600;
      letter-spacing: 0.2px;
      text-decoration: none !important;
      line-height: 1.2;
      cursor: pointer;
      box-shadow:
        0 4px 14px rgba(7, 29, 63, 0.35),
        inset 0 1px 0 rgba(255, 255, 255, 0.20);
      transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease, border-color 160ms ease;
      white-space: nowrap;
    }
    #${BUTTON_ID} > a.seirtao-pill:hover {
      background: rgba(255, 255, 255, 0.12);
      border-color: #ffffff;
      box-shadow:
        0 6px 18px rgba(7, 29, 63, 0.42),
        inset 0 1px 0 rgba(255, 255, 255, 0.28);
      transform: translateY(-1px);
    }
    #${BUTTON_ID} > a.seirtao-pill:focus-visible {
      outline: 2px solid #FFCD07;
      outline-offset: 2px;
    }
    #${BUTTON_ID} > a.seirtao-pill:active {
      transform: translateY(0);
      box-shadow: 0 1px 4px rgba(7, 29, 63, 0.22);
    }
    #${BUTTON_ID} > a.seirtao-pill > img.seirtao-pill-icon {
      width: 18px;
      height: 18px;
      display: block;
      flex-shrink: 0;
      border-radius: 3px;
    }
    #${BUTTON_ID} > a.seirtao-pill > span.seirtao-label {
      color: #ffffff;
      font-weight: 600;
    }
    @media (max-width: 767px) {
      #${BUTTON_ID} > a.seirtao-pill {
        padding: 4px 12px 4px 8px;
        font-size: 12px;
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
      <img src="${iconUrl}" alt="" class="seirtao-pill-icon" />
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
