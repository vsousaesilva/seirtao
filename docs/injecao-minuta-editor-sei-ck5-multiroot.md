# Injeção de Minuta no Editor do SEI — Jornada do CKEditor 5 Multi-Root

**Projeto:** SEIrtão — Assistente IA integrado ao SEI do TRF5
**Data:** Abril/2026
**Contexto:** Extensão Chrome MV3 que, após gerar uma minuta via LLM, automatiza o fluxo do SEI (Incluir Documento → Escolher Tipo → Cadastrar → Salvar → Abrir Editor → Injetar) e insere o conteúdo no editor do documento

---

## 1. O problema

Após toda a pipeline funcionar até a abertura do editor (popup em `acao=editor_montar`), a etapa final falhava consistentemente com:

> **Editor CKEditor não ficou pronto no tempo esperado.**
> *(frames vistos: 5, popups anunciados: 1)*

O popup do editor abria normalmente para o usuário — cabeçalho padrão do SEI visível, barra de ferramentas funcional, possível clicar e digitar. Mas o detector da extensão, após ~60 polls de 400ms no intervalo de 30s, dizia sempre a mesma coisa:

> `popup#0: 1 instância(s) CK, mas todas readonly (corpo do editor ainda não montou?)`

A minuta já estava pronta no cartão de pré-inserção; apenas o último passo da automação falhava, obrigando o usuário a colar manualmente.

---

## 2. A jornada — hipóteses testadas (em ordem)

A depuração de extensões em janelas pop-up é não-trivial: cada popup tem seu próprio DevTools, sua própria instância do bridge MAIN-world, e o tráfego `postMessage` entre orquestrador (aba original) e popup é opaco por padrão.

### Hipótese 1 — "O popup não está sendo detectado"

**Sintoma inicial:** `frames vistos: 5, popups anunciados: 0`.

O SEI abre o editor via `window.open` a partir do frame do cadastro. O detector antigo só varria `window.frames` — a janela filha estava invisível para ele.

**Intervenção:** interceptação do `window.open` em cada bridge MAIN-world para registrar os popups em `seirtaoPopups[]`. E em complemento, padrão de **popup-hello**: cada popup novo, ao bootar, faz `window.opener.postMessage({ __seirtao: 'popup-hello' })` para se anunciar.

**Resultado:** popups passaram a ser detectados (`popups anunciados: 1`), mas o editor permanecia "não pronto".

### Hipótese 2 — "O popup abre via `<form target="…">`, não via `window.open`"

**Sintoma:** em alguns fluxos do SEI, o popup é submissão de formulário, não chamada explícita de `window.open`.

**Intervenção:** o padrão popup-hello já cobre esse caso (independente de como o popup é aberto, ao bootar ele se anuncia ao `window.opener`). Validado.

### Hipótese 3 — "O CKEditor vive em um iframe aninhado dentro do popup"

**Sintoma:** popup detectado, mas `query-ckeditor` retornava "nenhuma instância".

**Intervenção:** `findOriginOpener()` caminhando até 8 níveis pela cadeia `window.parent` para que bridges dentro de iframes dos popups também anunciassem ao opener original.

**Resultado:** a mensagem mudou — passou a retornar *1 instância encontrada*, mas marcada como readonly.

### Hipótese 4 — "Cadastro com falha silenciosa"

O usuário levantou a hipótese, observando o stepper do painel, de que o preenchimento do cadastro estaria falhando. De fato o "X" visual aparecia na etapa "Preencher o cadastro".

**Diagnóstico:** o `STEP_FOR_INTERNAL` do stepper agrupava o estado interno `await-editor` sob o passo visual `cadastrar`. O cadastro passava; o que falhava era a etapa posterior.

**Intervenção:** adição de um passo visual dedicado `editor` entre `cadastrar` e `injetar`.

**Lição:** painéis de progresso que agrupam estados internos heterogêneos em um único passo visual produzem falsas pistas — o usuário foi induzido a acreditar que o erro era upstream quando era downstream.

### Hipótese 5 — "O CKEditor realmente está readonly inicialmente e destrava depois"

**Sintoma:** `query-ckeditor` retornando "1 instância, readonly" por 60 iterações seguidas ao longo de 30 segundos. Se fosse estado transitório de inicialização, cederia após 1-2 polls.

Para investigar, foi adicionada uma **dom-probe profunda** que, em vez de só olhar para instâncias CK, inspeciona o DOM bruto do popup: contagem de `.ck-editor__editable`, `.ck-content`, `[id^="txaEditor"]`, `div.infra-editor`, iframes, formulários com target, presença de `window.CKEDITOR`, instâncias de `CKEDITOR.instances`, e — por elemento editável — `contenteditable`, classes, `aria-label`, se tem `ckeditorInstance` anexado.

### Hipótese 6 (a correta) — "Multi-Root Editor com deduplicação por instância"

A dom-probe revelou:

```
popup#0 DOM: ckEditable=7, ckContent=5, txaEditor=5, infraEditor=0,
             iframes=0, CKEDITOR=true, CK4.instances=0,
             readyState=complete, bodyReady=true
editables (7):
  [0] div#txaEditor_292 ce=false ro=true  inst=true  aria="Cabeçalho"
  [1] div#txaEditor_162 ce=false ro=true  inst=true  aria="Título do Documento"
  [2] div#txaEditor_163 ce=true  ro=false inst=true  aria="Corpo do Texto"    ← alvo real
  [3] div#txaEditor_164 ce=false ro=true  inst=true  aria="Data do Documento"
  [4] div#txaEditor_293 ce=false ro=true  inst=true  aria="Rodapé"
  [5] td#(sem-id)       ce=false ro=true  inst=false (nested editable)
  [6] td#(sem-id)       ce=false ro=true  inst=false (nested editable)
```

Cinco editáveis, **todos com `ckeditorInstance` anexado**, mas **todos referenciando a mesma instância**. Um deles (o Corpo) é o editável de fato.

O SEI do TRF5 usa **CKEditor 5 Multi-Root Editor** customizado (`infraEditor`). Uma única instância gerencia N roots: Cabeçalho, Título, Corpo, Data, Rodapé. Cada root tem seu próprio elemento `<div class="ck-editor__editable">`, mas todos compartilham o mesmo objeto JavaScript do editor.

O detector em `getCk5Entries()` fazia:

```ts
if (seen.has(asCk)) return false;   // ← bug
seen.add(asCk);
```

Dedupe por **instância**. O primeiro editável iterado era o Cabeçalho (readonly). Ele era aceito; os outros 4 — incluindo o Corpo editável — eram descartados como duplicatas.

Resultado: `entries.length === 1, editables.length === 0`. Sempre.

---

## 3. A causa real

**Duas decisões de design do SEI/TRF5 colidindo com duas premissas do detector:**

| Premissa do detector (implícita)                                     | Realidade do infraEditor                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------- |
| Cada instância CK5 controla um único root.                          | Uma instância controla 5 roots (multi-root).                  |
| Se o editor abriu, o corpo está editável logo.                       | Cabeçalho/rodapé/título/data são permanentemente `ck-read-only` — por design do template. |
| Dedupe por referência JS elimina entradas redundantes.               | Dedupe por referência JS elimina **roots legítimas distintas**. |
| `model.insertContent(frag)` insere na root "principal" do editor.    | Insere na root onde está o caret — que pode ser outra root.   |

---

## 4. A correção

### 4.1 Deduplicação por elemento, não por instância

```ts
const seenEl = new Set<HTMLElement>();
const instanceEntries = new Map<unknown, CkEntry[]>();   // rastreia multi-root

const tryAccept = (el, candidate, tag) => {
  // ...
  if (seenEl.has(el)) return false;   // ← dedupe por elemento
  seenEl.add(el);
  // ...
  instanceEntries.get(asCk)?.push(entry) ?? instanceEntries.set(asCk, [entry]);
};
```

Cada `.ck-editor__editable` vira uma entrada. Cabeçalho, Título, Data, Rodapé ficam com `editable: false` (porque `isReadonlyEl` detecta `ck-read-only` / `contenteditable="false"`). O Corpo fica com `editable: true`.

### 4.2 Insert específico para multi-root

Detectado multi-root (`instanceEntries.get(asCk).length > 1`), troca-se o `insert` para ir direto ao paste sintético no elemento da root:

```ts
function buildCk5MultiRootInsert(inst, el) {
  return (html, mode) => {
    el.focus();
    inst.focus?.();
    if (pasteSyntheticAtEnd(el, html)) {
      return { ok: true, method: `ck5-multiroot-paste(${mode})` };
    }
    return { ok: false, method: 'ck5-multiroot-paste-failed' };
  };
}
```

**Por que paste sintético e não `model.insertContent`?** Porque o pipeline de clipboard do CK5 é dispatchado no elemento DOM específico — o CK5 converte `DataTransfer` → fragmento de view → fragmento de model → inserção na root correspondente ao elemento que recebeu o evento. Já o `model.insertContent(frag)` insere onde o caret está, sem saber qual root queremos.

Fluxo bem-sucedido agora: `editables[0] = ck5:inst:txaEditor_163 (Corpo)` → `insert` = paste sintético → CK5 respeita o schema, gera undo-step atômico, preserva cabeçalho e rodapé intactos.

---

## 5. Implicações atuais

### 5.1 Para a UX

A minuta entra no Corpo em menos de 1 segundo após o popup abrir, sem tocar no template (Cabeçalho, Rodapé, Título, Data — preenchidos pelo SEI a partir de metadados de cadastro). Nenhum passo manual.

### 5.2 Para a arquitetura da extensão

O orquestrador (isolado) e o bridge (MAIN-world) trocam mensagens via `postMessage` através de um relay (`forward-to-popup`) que encaminha envelopes aninhados entre janelas. A camada de roteamento agora suporta múltiplos popups simultâneos e o padrão popup-hello elimina a necessidade de interceptação específica por tipo de abertura (`window.open` vs `<form target>` vs outros).

### 5.3 Para a robustez

O detector agora é **resiliente a builds customizados** do CKEditor 5: qualquer build multi-root (não só `infraEditor`) passa a ser reconhecido corretamente. A camada de diagnóstico — quando `waitForCkEditor` esgota — emite um relatório completo (counts + per-editable state + iframe srcs) que tornou esse tipo de bug diagnosticável em minutos em vez de dias.

---

## 6. Implicações futuras

### 6.1 Outros sistemas do TRF5 baseados em `infraEditor`

O `infraEditor` é um componente reutilizado em outros módulos do TRF5 (SEI, Processo de Compras, Suap, portais administrativos). Qualquer integração futura com esses sistemas herdará diretamente a detecção corrigida.

### 6.2 Atualizações do SEI

Se o SEI migrar para outra versão do CK5, ou trocar multi-root por N instâncias separadas (uma por campo), o detector continua funcionando: o dedupe por elemento não se importa com quantas instâncias existem. A estratégia de paste sintético também continua válida porque não depende de APIs internas do CK5 — só de `ClipboardEvent`, que é W3C.

### 6.3 Ataques e compat

O paste sintético é padrão W3C e respeita o schema do editor. Não há risco de injeção de HTML/script que o próprio editor não já trataria em um paste legítimo — o CK5 sanitiza por default. A extensão não introduz novo vetor.

---

## 7. Oportunidades

1. **Seleção explícita de root no painel:** hoje assumimos sempre o Corpo. Há atos (ex.: edição de cabeçalho customizado, rodapé com dados específicos) em que o usuário pode querer injetar em outra root. Com cada root já mapeada por `aria-label` (Cabeçalho, Título, Corpo, Data, Rodapé), é trivial oferecer um seletor.

2. **Extração bidirecional:** o mesmo mapeamento de roots permite **ler** o conteúdo atual de cada uma. Útil para "regenerar minuta preservando cabeçalho atual" ou para comparar versões.

3. **Edição incremental:** em vez de substituir o Corpo inteiro, inserir trechos (por seção) com `insertBefore` / `insertAfter` âncoras de texto. O CK5 suporta via `model.change`; o paste sintético também permite via posicionamento de seleção prévio.

4. **Templates dinâmicos:** se o SEI mudar o template de um tipo de documento (ex.: "Despacho" ganha novo campo "Assinatura Eletrônica"), a detecção por `aria-label` e `contenteditable` identifica automaticamente quais são editáveis e quais são fixos — sem que precisemos manter uma tabela hardcoded.

5. **Métricas de telemetria local:** expor no console quantas roots multi-root foram detectadas permite monitoramento passivo. Se o SEI lançar uma versão com 7 roots em vez de 5, a extensão seguiria funcionando, e o diagnóstico apontaria a mudança.

6. **Reuso em outros editores "coletivos":** Google Docs, Notion, o próprio Badon do PJe usam padrões similares (um editor controlando N blocos). A lógica de "dedupe por elemento + paste sintético específico por bloco" é transferível.

---

## 8. O que aprendemos

### 8.1 Sobre depuração de sistemas multi-janela

- **Cada popup é um universo isolado de console.** Logs da aba original não contam a história completa. Instrumentar o lado remoto (via `postMessage` que traz de volta diagnósticos ricos) é essencial.
- **Polling insistente com a mesma resposta é sinal de estado *terminal*, não *transitório*.** Quando um detector retorna a mesma falha 60 vezes seguidas, parar e questionar a premissa do detector é mais produtivo do que aumentar timeout.
- **`postMessage` com relé one-shot + nonce** é a forma mais simples de orquestrar cross-window em MV3 sem depender de `chrome.tabs.sendMessage` (que não enxerga popups).

### 8.2 Sobre detecção de editores ricos

- **Nunca deduplicar por instância sem confirmar cardinalidade 1:1.** Multi-root, multi-editor, builds customizados — tudo quebra a premissa. Deduplicar por elemento DOM é um ponto de Schelling mais seguro.
- **`contenteditable` + `aria-label` são fonte de verdade** para quem é editável e para que serve cada editável. Mais confiáveis do que classes CSS (que variam por tema/skin) ou IDs (que variam por build).
- **Paste sintético é o caminho comum** para editores modernos que controlam o DOM via modelo interno (CK5, ProseMirror, Slate, Lexical). Todos respeitam o pipeline de clipboard porque ele é W3C.

### 8.3 Sobre diagnóstico em extensões

- **Diagnóstico progressivo em camadas:** primeira falha → reportar contagem; segunda falha → reportar URLs; terceira falha → probe de DOM com detalhe por elemento. Evita log-spam no caminho feliz, mas garante visibilidade quando precisa.
- **Teste de hipótese tem que ser barato.** A `dom-probe` foi escrita em ~30 minutos e resolveu semanas de suposição. O custo de adicionar instrumentação cirúrgica é quase sempre menor do que o custo de adivinhar.
- **O usuário não é um oráculo.** A hipótese do "cadastro falhando" estava errada, mas foi informativa: apontou que o stepper visual era enganoso. Ouvir a hipótese, validar, e corrigir o que induziu ao erro (o mapeamento de estados) foi tão valioso quanto corrigir o bug de fato.

### 8.4 Sobre a natureza do CKEditor 5

- CK5 não tem registry global (`CKEDITOR.instances` é artefato do CK4). A única forma canônica de achar uma instância CK5 é inspecionar `el.ckeditorInstance` em cada `.ck-editor__editable`.
- Builds customizados frequentemente expõem globais (`window.infraEditor`, `window.editors`). Vale cobrir esses nomes, mas o caminho via `ckeditorInstance` é o mais universal.
- Multi-Root é uma variante oficial do CK5, não uma curiosidade — é a forma recomendada para documentos estruturados (templates fixos + conteúdo variável). Qualquer integração com editor institucional vai encontrá-la mais cedo ou mais tarde.

### 8.5 Sobre engenharia em ambientes governamentais

- Sistemas como o SEI têm **invariantes tácitas** não documentadas publicamente (qual CKEditor é usado, como os roots são nomeados, o que é readonly "by design"). A única forma de descobri-las é probing do DOM real em uso.
- **Integrações não-oficiais precisam de gracefulness como requisito primário.** Nossa extensão nunca quebra o SEI — na pior falha, pede ao usuário para colar manualmente. Isso é o que torna uma extensão institucional aceitável.
- **O custo de um bug numa automação de documento judicial é alto.** Não é "minha pipeline falhou"; é "a magistrada teve que parar o trabalho". O timeout generoso (30s), o fallback humano, e o diagnóstico detalhado são proteções necessárias, não luxos.

---

## 9. Arquivos envolvidos

- [src/content/sei-main-world.ts](../src/content/sei-main-world.ts) — bridge MAIN-world; detecção de editores, handlers `dom-probe` / `query-ckeditor` / `ckeditor-set-data`, popup-hello, `window.open` interceptor
- [src/content/sei-minutar-insert.ts](../src/content/sei-minutar-insert.ts) — orquestrador do fluxo de inserção; `waitForCkEditor`, `collectEditorDiagnostics`, roteamento frame-vs-popup
- [src/content/ui/seirtao-panel.ts](../src/content/ui/seirtao-panel.ts) — painel e stepper visual (correção do `STEP_FOR_INTERNAL` para desagrupar `await-editor`)

---

## 10. Checklist para integrações futuras com editores ricos

Quando se for integrar com um editor rico desconhecido, validar nesta ordem:

1. **Descobrir o engine.** Inspecionar classes CSS (`.ck-*` = CK5; `.cke_*` = CK4; `.ProseMirror` = ProseMirror/Badon/Tiptap; `.ql-editor` = Quill; `[data-lexical-editor]` = Lexical).
2. **Contar editáveis vs. instâncias.** Se editáveis > instâncias, é multi-root. Planejar inserção por elemento, não por instância.
3. **Identificar o editável-alvo por semântica**, não por posição: `aria-label`, `role`, proximidade com cabeçalhos/labels. IDs são voláteis.
4. **Testar paste sintético primeiro.** Se funciona, é o caminho. Evita todas as armadilhas de APIs internas.
5. **Se paste não funciona**, descer para APIs do engine (`editor.insertHtml`, `model.insertContent`, `view.dispatch(tr)`), mas com awareness da cardinalidade de roots.
6. **Sempre oferecer fallback humano.** O usuário vê o conteúdo no cartão/painel e pode copiar manualmente se a automação falhar.
