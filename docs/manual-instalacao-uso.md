# SEIrtão — Manual de Instalação e Uso

Assistente de IA integrado ao SEI (Sistema Eletrônico de Informações) do TRF5 para análise de processos administrativos, sugestão do próximo ato e geração de minutas, com inserção automatizada (opcional) no editor do SEI.

---

## PARTE 1 — INSTALAÇÃO

### Navegadores suportados

O SEIrtão é distribuído como extensão MV3 (Manifest V3). Recomenda-se o uso em:

- **Google Chrome** (versão 110 ou superior)
- **Microsoft Edge** (versão 110 ou superior)

O Firefox não é suportado nesta versão.

### Requisitos

- Navegador: Google Chrome ou Microsoft Edge (versão 110 ou superior)
- Acesso ao SEI do TRF5 (`sei.trf5.jus.br`)
- Chave de API de um dos provedores: Google Gemini, Anthropic (Claude) ou OpenAI (GPT)

### Passo a passo

1. Obtenha o arquivo `dist.zip` da extensão (fornecido pelo desenvolvedor ou gerado via build no repositório `seirtao`).

2. **Extraia o arquivo antes de instalar.** Clique com o botão direito sobre `dist.zip` e escolha "Extrair tudo" (Windows) ou use o descompactador de sua preferência. O resultado será uma pasta chamada `dist` com todos os arquivos da extensão. O navegador **não** aceita carregar a extensão a partir do `.zip`.

3. Guarde a pasta `dist` em um local permanente (ex.: `Documentos\SEIrtão\dist`). Se a pasta for apagada ou movida após a instalação, a extensão deixa de funcionar.

4. Abra a página de extensões do navegador:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`

5. Ative o **Modo do desenvolvedor** (interruptor no canto superior direito da página).

6. Clique em **Carregar sem compactação** (Chrome) ou **Carregar descompactada** (Edge).

7. Selecione a pasta `dist` extraída (não o arquivo `.zip`).

8. A extensão aparecerá na barra de ferramentas do navegador com o ícone do SEIrtão.

9. Fixe a extensão na barra (ícone de quebra-cabeça → alfinete ao lado de "SEIrtão").

### Configuração inicial

Clique no ícone do SEIrtão na barra de ferramentas. O popup de configurações será aberto.

1. **LGPD.** Leia o aviso de privacidade e marque a caixa de ciência. A extensão envia o conteúdo dos documentos para a API do provedor de IA escolhido.

2. **Provedor e modelo.** Selecione o provedor (Google Gemini, Anthropic ou OpenAI) e o modelo desejado.

3. **Chave de API.** Cole a chave do provedor selecionado no campo indicado. Clique em **Salvar** e depois em **Testar** para verificar a conexão. A chave fica armazenada apenas no navegador local.

4. **OCR (opcional).** Marque "Rodar OCR automaticamente" se deseja que documentos digitalizados (imagens sem texto) sejam processados por reconhecimento óptico de caracteres. O OCR roda localmente (Tesseract.js), sem enviar imagens ao provedor de IA. Ajuste o limite de páginas por documento conforme necessário.

5. **Modelos de minuta (opcional).** Clique em **Gerenciar modelos** para abrir a página de opções. Selecione uma pasta do seu computador com seus modelos de atos administrativos (despachos, informações, pareceres, decisões, atos ordinatórios, memorandos, ofícios). Formatos aceitos: `.docx`, `.pdf`, `.txt`, `.md`. Organize por subpastas (ex.: `despachos/`, `informacoes/`, `pareceres/`, `decisoes/`, `ordinatorio/`, `memorandos/`, `oficios/`) para melhor seleção automática.

6. **Inserção automática no SEI (opt-in).** Por padrão, a extensão **não** executa os passos automatizados dentro do SEI. Para habilitar, vá em "Gerenciar modelos" e marque **Permitir inserção automática de minutas no SEI**. Mesmo com a opção ativa, o SEIrtão nunca salva, assina nem publica o documento — a revisão e a assinatura permanecem sempre com o usuário. Cada tentativa gera um registro local (data, processo, tipo, nível de acesso e hash truncado da minuta — sem o conteúdo) para auditoria.

7. **Termos de uso e governança.** No popup há a seção "Termos de uso e Governança (Res. CNJ 615/2025)" com o enquadramento da ferramenta como de baixo risco (Anexo BR4/BR8), a obrigação de supervisão humana (art. 19, IV e art. 34), a política de privacidade/anonimização (art. 30), a trilha de auditoria (art. 19, §6º e art. 27 — parcialmente implementada via log local da inserção automática) e a identificação de conteúdo gerado com apoio de IA (art. 21). Leia antes do uso em produção.

---

## PARTE 2 — USO

### Acessando o SEIrtão

1. Acesse o SEI (`sei.trf5.jus.br`) e faça login na sua unidade.
2. Abra um processo (tela "Controle de Processos" → clicar no número do processo).
3. O SEIrtão injeta um **botão discreto "SEIrtão"** na barra superior direita do SEI (ao lado de *Controle de Processos*, *Novidades*, *Unidade* etc.). Clique para abrir o painel lateral.

> **Observação.** O botão só aparece em telas que exibem o trâmite de um processo (ações `procedimento_trabalhar`, `procedimento_visualizar` e correlatas). Na tela inicial do SEI ou em listagens gerais, ele não é exibido.

### Layout do painel lateral

O painel abre em uma sidebar à direita com duas colunas:

**Coluna esquerda (lateral):**
- **Cabeçalho** com nome da extensão e subtítulo.
- **Status** do processo carregado (número detectado, unidade responsável).
- **Ações** — três botões principais:
  - **Analisar processo administrativo**
  - **Minutar próximo ato**
  - **Otimizar modelo do SEI**
- **Documentos** — lista automática da árvore do processo, com caixas de seleção, botões *Todos* / *Nenhum*, filtro por texto e contador "N de M selecionados". A árvore é lida automaticamente quando o painel abre — não existe botão "Carregar Documentos".

**Coluna direita (principal):**
- Caixas de streaming de cada ação (análise, minuta, modelo otimizado) com barra de progresso, texto gerado em tempo real e barra de ações ao final.
- **Chat livre** no rodapé, para perguntas abertas sobre o processo.

### Analisar processo administrativo

Seleciona os documentos marcados na seção "Documentos" e gera uma análise estruturada (FIRAC+ adaptado ao contexto administrativo), contendo:

- Dados do processo (unidade, interessados, número, tipo)
- Histórico em ordem cronológica
- Questão administrativa em discussão
- Normativos aplicáveis
- Argumentos e manifestações
- Situação atual e próxima providência natural

O texto é transmitido em tempo real (streaming). Ao concluir, aparecem os botões de ação sobre a saída (ver mais adiante).

### Minutar próximo ato (triagem + geração)

O botão **Minutar próximo ato** funciona em duas rodadas:

**1ª rodada — triagem.** O SEIrtão monta um contexto priorizando os últimos atos juntados ao processo e consulta a IA para recomendar qual ato é mais adequado ao momento. A resposta vem em dois blocos:

- **ATO SUGERIDO:** um dos 8 atos do catálogo (ver abaixo).
- **JUSTIFICATIVA:** 2 a 4 linhas explicando a escolha, com referência ao documento que ancora a decisão.

**2ª rodada — minuta.** O painel exibe um cartão com a sugestão e dois botões:

- **Gerar minuta deste ato** — abre o painel de orientações para o ato recomendado.
- **Escolher outro ato…** — abre um seletor com os 8 atos do catálogo e, quando possível, com os tipos de documento efetivamente habilitados na sua unidade (descobertos na tela "Escolher Tipo do Documento" do SEI).

Caso a triagem falhe (sem chave, resposta inválida etc.), o seletor manual é aberto imediatamente.

#### Painel de orientações

Após escolher o ato, o painel de orientações apresenta:

- **Modelo a usar** — seletor com as opções:
  - *Automático (melhor correspondência)* — usa o top-1 da busca BM25 nos seus modelos, quando a similaridade estiver acima do limiar.
  - *Sem modelo (gerar do zero)* — força geração sem template.
  - *Top-3* — os três modelos mais compatíveis com o ato escolhido (cada opção mostra nome + percentual de compatibilidade). O seletor só aparece se você configurou uma pasta de modelos.
- **Orientações adicionais (opcional)** — campo livre em que você pode digitar instruções específicas (ex.: *"citar a Lei 8.112/90, art. 116"*, *"encurtar para 6 parágrafos"*, *"tom mais formal"*).
- Três botões: **Voltar**, **Sem orientações — gerar minuta**, **Gerar com orientações**.

Para os atos de **informação**, **parecer** e **decisão administrativa** (rigidez *gabarito*), o modelo selecionado é seguido parágrafo a parágrafo. Para **despachos**, **atos ordinatórios**, **memorandos** e **ofícios** (rigidez *referência*), o modelo é usado como referência de estilo, sem obrigatoriedade estrutural.

#### Catálogo de atos administrativos

1. **Despacho de encaminhamento** — move o processo à unidade competente para a próxima etapa.
2. **Despacho de instrução** — determina providência concreta (juntada, manifestação, diligência).
3. **Informação técnica** — manifestação factual/técnica da unidade competente.
4. **Parecer jurídico** — análise de legalidade / adequação normativa.
5. **Decisão administrativa** — ato da autoridade que resolve o mérito (defere, aprova, homologa).
6. **Ato ordinatório** — ato de mero expediente da secretaria.
7. **Memorando** — comunicação formal entre unidades internas.
8. **Ofício** — comunicação formal com órgão ou pessoa externa.

O SEIrtão faz correspondência *fuzzy* entre o ato sugerido pela IA e o catálogo, e entre o catálogo e os tipos de documento habilitados na sua unidade (ex.: "Despacho de instrução" pode aparecer como "Despacho - Instrução" dependendo da configuração local).

### Otimizar modelo do SEI

Recebe um texto-modelo (colado na caixa dedicada do painel) e propõe:

- Variáveis no formato `@tag@` (para o *infraEditor* do SEI) substituindo partes que variam de um caso para outro;
- Remoção de redundâncias;
- Ajustes de clareza.

Útil para transformar modelos tradicionais em modelos reutilizáveis, compatíveis com o editor do SEI.

### Inserir minuta no editor do SEI

Com a opção **Permitir inserção automática** habilitada (Configuração Inicial, passo 6), ao confirmar uma minuta no cartão de pré-inserção, o SEIrtão executa quatro etapas macro dentro do SEI:

1. **Incluir Documento** — aciona o link "Incluir Documento" na árvore do processo.
2. **Escolher Tipo** — seleciona o tipo de documento recomendado ou escolhido pelo usuário.
3. **Cadastrar** — preenche descrição, nível de acesso (Público por padrão) e hipótese legal quando aplicável.
4. **Injetar no Editor** — aguarda o SEI abrir o popup do editor (CKEditor 5 *multi-root* do `infraEditor`) e insere o conteúdo da minuta no corpo, preservando cabeçalho e rodapé pré-preenchidos pelo template do SEI.

O painel exibe um *stepper* com o progresso de cada etapa. Se alguma falhar (ex.: popup bloqueado, editor não abriu a tempo), a extensão exibe a minuta no painel e orienta a colar manualmente (`Ctrl+V`) no editor já aberto.

**IMPORTANTE.** Após a inserção, você ainda precisa:

- Revisar o conteúdo da minuta.
- Ajustar manualmente o que for necessário.
- Clicar em **Salvar** no editor do SEI.
- Assinar o documento com seu token/certificado.
- Publicar ou encaminhar conforme o fluxo da unidade.

O SEIrtão nunca executa essas quatro últimas etapas.

#### Cartão de pré-inserção

Antes de qualquer etapa automatizada, o SEIrtão abre um modal de revisão com:

- Número do processo e ato (somente leitura).
- **Descrição do documento** (editável, até 200 caracteres).
- **Nível de acesso** (Público / Restrito / Sigiloso). Para *Restrito*, é obrigatório escolher a hipótese legal (combobox com o catálogo vigente).
- **Minuta** em textarea editável — você pode corrigir o texto gerado pela IA antes de qualquer inserção.
- Lista de verificações: *"Revisei integralmente"*, *"Estou ciente de que o SEIrtão não salvará nem assinará"*, *"Nível de acesso verificado"*.

A inserção só prossegue depois das três confirmações.

### Chat livre

Caixa de chat no rodapé do painel para perguntas abertas sobre o processo, por exemplo:

- "Qual o pedido do interessado?"
- "Existe manifestação da unidade requerida? O que conclui?"
- "Há prazo pendente? Para quem?"
- "Liste os valores mencionados no processo."

Controles:

- **Enter** envia; **Shift+Enter** pula linha.
- **Ditar** — reconhecimento de voz em português (`pt-BR`) usando a API nativa do navegador.
- **Nova** — limpa a conversa.
- **Enviar** — submete a pergunta.

### Ações disponíveis em cada saída de streaming

Abaixo de cada caixa (análise, minuta, modelo otimizado), quando o streaming termina, aparecem:

- **Copiar** — copia o texto (Markdown) para a área de transferência.
- **Baixar .doc** — salva como arquivo do Word, com nome sugerido a partir do número do processo e do tipo de ato.
- **Baixar PDF** — abre a janela de impressão para salvar em PDF.
- **Nova** — limpa a caixa e permite rodar a ação novamente.
- **Enviar por e-mail** — abre o cliente de e-mail padrão com o texto no corpo da mensagem.
- **Inserir no processo** (apenas na caixa de minuta) — abre o cartão de pré-inserção descrito acima.

---

## PARTE 3 — ORGANIZAÇÃO DA PASTA DE MODELOS

Para melhor aproveitamento da busca automática, organize seus arquivos em subpastas por tipo de ato administrativo:

```
Modelos/
  despachos/
    encaminhamento-unidade-competente.docx
    instrucao-juntada-documento.docx
    instrucao-manifestacao.docx
  informacoes/
    informacao-tecnica-padrao.docx
    informacao-declaratoria.docx
  pareceres/
    parecer-juridico-padrao.docx
    parecer-legalidade.docx
  decisoes/
    decisao-deferimento.docx
    decisao-homologacao.docx
    decisao-indeferimento.docx
  ordinatorio/
    ato-ordinatorio-padrao.docx
  memorandos/
    memorando-encaminhamento.docx
  oficios/
    oficio-requisicao.docx
    oficio-resposta.docx
```

**Dicas.**

- Use nomes descritivos nos arquivos — a busca considera nome e conteúdo (BM25 com tokenização em português).
- Subpastas com nomes `despachos`, `pareceres`, `decisoes`, `informacoes`, `oficios`, `memorandos`, `ordinatorio` recebem *boost* automático (1,3×) na busca do ato correspondente.
- Formatos aceitos: `.docx`, `.pdf`, `.txt`, `.md`.
- Após adicionar ou alterar modelos, clique em **Reindexar agora** na página de opções.
- Os arquivos ficam indexados localmente (IndexedDB do navegador) — a pasta original não é modificada.

---

## PARTE 4 — DICAS E SOLUÇÃO DE PROBLEMAS

- **Botão do SEIrtão não aparece na barra do SEI.** Verifique se a extensão está ativa em `chrome://extensions` ou `edge://extensions`. O botão só aparece em telas de processo (não na tela inicial nem em listagens). Recarregue a página do SEI após instalar.

- **Documentos vazios ou com erro na extração.** Alguns documentos podem falhar na primeira tentativa (timeouts, PDFs protegidos). A extensão faz até 3 tentativas automáticas com estratégias diferentes. Se persistir, recarregue a página e tente novamente.

- **Documentos de áudio/vídeo.** Arquivos de mídia (MP3, MP4 etc.) são detectados automaticamente e marcados como conteúdo não-textual, sem gerar erro.

- **OCR lento.** O OCR roda localmente no navegador. Documentos com muitas páginas podem demorar — ajuste o limite de páginas nas configurações.

- **Minuta usando modelo errado.** A busca automática usa o rótulo do ato para encontrar o modelo mais similar. Se o resultado não for adequado, use o seletor **Modelo a usar** no painel de orientações para escolher manualmente outro candidato do top-3 ou *Sem modelo (gerar do zero)*.

- **Chave de API inválida.** Use o botão **Testar** nas configurações. Cada provedor tem seu formato de chave — certifique-se de que a chave corresponde ao provedor selecionado.

- **Popup do editor não abriu.** O SEI abre o editor em uma janela *pop-up*. Se o navegador estiver bloqueando pop-ups para `sei.trf5.jus.br`, o fluxo de inserção automática falha. Permita pop-ups para o domínio do SEI em "Configurações do site".

- **Erro "Editor CKEditor não ficou pronto".** Pode ocorrer em páginas com muitos frames ou conexão lenta. A extensão aguarda até 30 segundos. Se persistir, copie a minuta pelo botão **Copiar** e cole (`Ctrl+V`) manualmente no editor já aberto.

- **Cadastro preenchido mas editor não abriu.** Verifique se o SEI exibiu algum diálogo modal (nível de acesso, confirmação) bloqueando o fluxo. O SEIrtão aguarda o editor abrir naturalmente; diálogos manuais precisam ser respondidos antes.

- **Inserção desabilitada.** Por segurança, a inserção automática é *opt-in*. Vá em **Gerenciar modelos → Permitir inserção automática de minutas no SEI** e habilite a opção.

- **Atualização da extensão.** Quando receber uma nova versão do `dist.zip`, extraia o arquivo sobrescrevendo a pasta `dist` existente e depois vá em `chrome://extensions` ou `edge://extensions` e clique no botão de atualizar (seta circular) no card da extensão.
