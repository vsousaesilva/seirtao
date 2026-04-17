# SEIrtão - Manual de Instalacao e Uso

Assistente de IA integrado ao SEI (Sistema Eletronico de Informacoes) do TRF5 para resumo de processos, sugestao do proximo ato administrativo e geracao de minutas com insercao automatizada no editor do SEI.

---

## PARTE 1 - INSTALACAO

### Navegadores suportados

O SEIrtao e distribuido como extensao MV3 (Manifest V3). Recomenda-se seu uso em:

- **Google Chrome** (versao 110 ou superior) - indicado para uso diario.
- **Microsoft Edge** (versao 110 ou superior) - equivalente ao Chrome.

O Firefox nao e suportado nesta versao. Extensoes MV3 em Firefox exigem empacotamento distinto e ajustes de compatibilidade que ainda nao foram feitos.

### Requisitos

- Navegador: Google Chrome ou Microsoft Edge (versao 110 ou superior)
- Acesso ao SEI do TRF5 (sei.trf5.jus.br)
- Chave de API de um dos provedores: Google Gemini, Anthropic (Claude) ou OpenAI (GPT)

### Passo a passo

1. Obtenha o arquivo "dist.zip" da extensao (fornecido pelo desenvolvedor ou gerado via build a partir do repositorio `seirtao`).

2. IMPORTANTE - Extraia o arquivo antes de instalar: clique com o botao direito sobre "dist.zip" e escolha "Extrair tudo" (Windows) ou use o descompactador de sua preferencia. O resultado sera uma pasta chamada "dist" com todos os arquivos da extensao. O navegador NAO aceita carregar a extensao a partir do arquivo compactado - e obrigatorio descompactar primeiro.

3. Guarde a pasta "dist" extraida em um local permanente (ex.: Documentos\SEIrtao\dist). Se a pasta for apagada ou movida apos a instalacao, a extensao deixara de funcionar.

4. Abra a pagina de extensoes do navegador:
   - Chrome: digite chrome://extensions na barra de endereco
   - Edge: digite edge://extensions na barra de endereco

5. Ative o "Modo do desenvolvedor" (interruptor no canto superior direito da pagina).

6. Clique em "Carregar sem compactacao" (Chrome) ou "Carregar descompactada" (Edge).

7. Selecione a pasta "dist" extraida do SEIrtao (nao selecione o arquivo .zip).

8. A extensao aparecera na barra de ferramentas do navegador com o icone do SEIrtao.

9. Fixe a extensao na barra (clique no icone de quebra-cabeca e depois no alfinete ao lado de "SEIrtao").

### Configuracao inicial

Clique no icone do SEIrtao na barra de ferramentas. O popup de configuracoes sera aberto.

1. LGPD: Leia o aviso de privacidade e marque a caixa de ciencia. A extensao envia o conteudo dos documentos para a API do provedor de IA escolhido. Confirme que esta ciente.

2. Provedor e modelo: Selecione o provedor de IA (Google Gemini, Anthropic ou OpenAI) e o modelo desejado.

3. Chave de API: Cole a chave de API do provedor selecionado no campo indicado. Clique em "Salvar" e depois em "Testar" para verificar se a conexao esta funcionando. A chave fica armazenada apenas no navegador local.

4. OCR (opcional): Marque "Rodar OCR automaticamente" se deseja que documentos digitalizados (imagens sem texto) sejam processados por reconhecimento optico de caracteres. O OCR roda localmente (Tesseract.js), sem enviar imagens ao provedor de IA. Ajuste o limite de paginas por documento conforme necessario.

5. Modelos de minuta (opcional): Clique em "Gerenciar modelos" (ou no icone de engrenagem no painel) para abrir a pagina de configuracao. Ali voce pode selecionar uma pasta do seu computador com seus modelos de atos administrativos (despachos, informacoes, pareceres, decisoes administrativas). A extensao aceita arquivos .docx, .pdf, .txt e .md. Organize por subpastas (ex.: "despachos", "informacoes", "pareceres", "decisoes", "oficios", "memorandos") para melhor selecao automatica.

6. Insercao automatica no SEI (OPT-IN): Por padrao, a extensao NAO executa os quatro passos do SEI (Incluir Documento -> Escolher Tipo -> Cadastrar -> Injetar no editor). Para habilitar esse modo, va em "Gerenciar modelos" e marque a opcao "Permitir insercao automatica de minutas no SEI". Mesmo com a opcao ativa, o SEIrtao nunca salva, assina ou publica o documento - a revisao e a assinatura permanecem sempre com o usuario. Cada tentativa gera um registro local (data, processo, tipo, nivel de acesso e hash truncado da minuta - sem o conteudo) para auditoria.

7. Termos de uso e governanca: No popup ha a secao "Termos de uso e Governanca (Res. CNJ 615/2025)" com o enquadramento da ferramenta como de baixo risco (Anexo BR4/BR8), a obrigacao de supervisao humana (art. 19, IV e art. 34), a politica de privacidade/anonimizacao (art. 30), a trilha de auditoria (art. 19, par. 6 e art. 27 - parcialmente implementada via log local da insercao automatica) e a identificacao de conteudo gerado com apoio de IA (art. 21). Leia antes do uso em producao.

---

## PARTE 2 - USO

### Acessando o SEIrtao

1. Acesse o SEI (sei.trf5.jus.br) e faca login na sua unidade.
2. Abra um processo (tela de "Controle de Processos" -> clicar no numero do processo).
3. O SEIrtao adiciona um botao na barra superior do SEI. Clique para abrir o painel lateral.

Observacao: O painel so aparece em telas que exibem o tramite de um processo (acao `procedimento_trabalhar`, `procedimento_visualizar` e correlatas). Na tela inicial do SEI ou em listagens gerais, o painel nao sera exibido.

### Painel lateral

O painel exibe:
- Nome da extensao e provedor/modelo em uso
- Numero do processo detectado (ex.: 0002026-76.2026.4.05.7600) e a unidade em que o processo esta
- Barra de ferramentas com os botoes de acao: Carregar Documentos, Resumir, Minutar proximo ato, Anonimizar
- Area de chat para interacao livre com a IA

### Carregar Documentos

Primeiro passo obrigatorio antes de qualquer acao. Clique em "Carregar Documentos" para que a extensao:
- Detecte todos os documentos da arvore do processo (anexos, oficios juntados, informacoes, despachos anteriores etc.)
- Exiba a lista com checkbox para selecao individual
- Permita marcar/desmarcar todos

Depois clique em "Extrair conteudo selecionados". A extensao baixa e extrai o texto de cada documento selecionado. O progresso e exibido em tempo real (ex.: "Extracao concluida - 12 ok, 0 com erro"). O conteudo extraido fica em cache por sessao, entao a segunda analise sobre os mesmos documentos e imediata.

### Resumir

Gera uma analise do processo administrativo no formato FIRAC+ adaptado ao contexto administrativo:
- Dados do processo (unidade, interessados, numero, tipo)
- Historico em ordem cronologica (pecas juntadas, despachos, informacoes)
- Questao administrativa em discussao
- Normativos aplicaveis
- Argumentos e manifestacoes das unidades envolvidas
- Situacao atual e proxima etapa natural

### Minutar proximo ato (triagem automatica)

O botao "Minutar proximo ato" funciona em duas rodadas:

**1a rodada - triagem.** A extensao monta um contexto priorizando os ultimos atos juntados ao processo e consulta a IA para recomendar qual ato e mais adequado ao momento processual. A resposta vem em dois blocos fixos:
   - ATO SUGERIDO: um dos 8 atos do catalogo (ver abaixo)
   - JUSTIFICATIVA: 2 a 4 linhas explicando por que, com referencia ao documento que ancora a decisao

**2a rodada - minuta.** O painel exibe o cartao de pre-insercao com a sugestao e dois botoes:
   - "Gerar esta minuta" - produz a minuta do ato recomendado.
   - "Escolher outro ato..." - abre um seletor com os 8 atos do catalogo ou, opcionalmente, com os tipos de documento realmente habilitados na sua unidade no SEI (descobertos dinamicamente na tela "Escolher Tipo do Documento").

Caso a triagem falhe (sem chave de API, resposta invalida, etc.), a escolha manual e aberta imediatamente, preservando a funcionalidade.

#### Catalogo de atos administrativos

1. **Despacho de encaminhamento** - move o processo a unidade competente para a proxima etapa.
2. **Despacho de instrucao** - determina providencia concreta (juntada, manifestacao, diligencia).
3. **Informacao tecnica** - manifestacao factual/tecnica da unidade competente.
4. **Parecer juridico** - analise de legalidade/adequacao normativa.
5. **Decisao administrativa** - ato da autoridade que resolve o merito (defere, aprova, homologa).
6. **Ato ordinatorio** - ato de mero expediente da secretaria.
7. **Memorando** - comunicacao formal entre unidades internas.
8. **Oficio** - comunicacao formal com orgao ou pessoa externa.

O SEIrtao faz correspondencia fuzzy entre o ato sugerido pela IA e o catalogo oficial, e entre o catalogo e os tipos de documento efetivamente habilitados na sua unidade no SEI (ex.: "Despacho de instrucao" pode aparecer como "Despacho - Instrucao" dependendo da configuracao local).

### Anonimizar autos

Substitui dados sensiveis nos documentos extraidos:
- CPF, CNPJ, CEP, telefones, e-mails, RG e dados bancarios (via regex local, sem envio a IA)
- Nomes de pessoas fisicas (via IA)

Os dados sao substituidos por marcadores genericos (ex.: "INTERESSADO", "CPF_OCULTO"). Util em processos administrativos que envolvem dados de servidores, beneficiarios ou terceiros.

### Rodar OCR

Aparece automaticamente quando ha documentos digitalizados (PDFs de imagem). Processa as paginas localmente com Tesseract.js para extrair o texto. Nao envia imagens ao provedor de IA.

### Inserir minuta no editor do SEI

Com a opcao "Permitir insercao automatica" habilitada (ver Configuracao Inicial, passo 6), ao aceitar uma minuta no cartao de pre-insercao, o SEIrtao executa os quatro passos do SEI:

1. **Incluir Documento** - aciona o link "Incluir Documento" na arvore do processo.
2. **Escolher Tipo** - seleciona o tipo de documento recomendado (ou escolhido pelo usuario).
3. **Cadastrar** - preenche a descricao e o nivel de acesso (Publico por padrao).
4. **Abrir Editor** - aguarda o SEI abrir o popup do editor (CKEditor 5 multi-root do infraEditor).
5. **Injetar minuta** - insere o conteudo da minuta no corpo do documento, preservando cabecalho e rodape pre-preenchidos pelo template do SEI.

O painel exibe um stepper com o progresso de cada etapa e permite cancelar a qualquer momento. Se alguma etapa falhar (ex.: popup bloqueado, editor nao abriu a tempo), a extensao exibe a minuta no painel e orienta a colar manualmente (Ctrl+V) no editor ja aberto.

**IMPORTANTE:** Apos a insercao, voce ainda precisa:
- Revisar o conteudo da minuta
- Ajustar manualmente o que for necessario
- Clicar em "Salvar" no editor do SEI
- Assinar o documento com seu token/certificado
- Publicar ou encaminhar conforme o fluxo da unidade

O SEIrtao nunca executa as quatro ultimas etapas (salvar, assinar, publicar, encaminhar).

### Chat livre

A area de chat na parte inferior do painel permite fazer perguntas livres sobre o processo. Exemplos:
- "Qual o pedido do interessado?"
- "Existe manifestacao da unidade requerida? O que conclui?"
- "Resuma os normativos citados ate agora"
- "Ha prazo pendente? Para quem?"
- "Liste os valores mencionados no processo"

### Acoes disponiveis em cada resposta/minuta

Abaixo de cada resposta da IA (em especial minutas) aparecem botoes de acao rapida:

- **Copiar**: copia a resposta (markdown) para a area de transferencia.
- **Inserir no SEI**: insere o texto diretamente no editor CKEditor do SEI aberto em outra janela (popup do editor). Requer a opcao de insercao automatica habilitada.
- **Baixar .doc**: salva a resposta como arquivo do Word (.doc), ja com nome sugerido a partir do numero do processo e do tipo de ato.
- **Refinar minuta**: reaproveita a ultima minuta gerada com uma instrucao adicional digitada pelo usuario (ex.: "encurtar", "citar a Lei 8.112/90 art. 116", "reforcar o dispositivo", "trocar o tom para mais formal"), preservando o template usado.
- **Nova minuta**: gera uma nova versao da mesma acao, do zero, sem modelo de referencia.

---

## PARTE 3 - ORGANIZACAO DA PASTA DE MODELOS

Para melhor aproveitamento da busca automatica de modelos, organize seus arquivos em subpastas por tipo de ato administrativo:

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

Dicas:
- Use nomes descritivos nos arquivos (a busca considera o nome e o conteudo).
- Subpastas com nomes como "despachos", "pareceres", "decisoes", "informacoes", "oficios", "memorandos" recebem prioridade automatica na busca do botao correspondente.
- Formatos aceitos: .docx, .pdf, .txt, .md
- Apos adicionar ou alterar modelos, clique em "Reindexar agora" na pagina de opcoes.
- Os arquivos ficam indexados localmente (IndexedDB do navegador); a pasta original nao e modificada.

---

## PARTE 4 - DICAS E SOLUCAO DE PROBLEMAS

- **Extensao nao aparece no SEI**: Verifique se a extensao esta ativa em chrome://extensions ou edge://extensions. O painel so aparece em telas de processo (nao na tela inicial nem em listagens). Recarregue a pagina do SEI apos instalar.

- **Erro ao extrair documentos**: Alguns documentos podem retornar vazio na primeira tentativa (timeouts, PDFs protegidos). A extensao faz ate 3 tentativas automaticas com estrategias diferentes. Se persistir, recarregue a pagina do SEI e tente novamente.

- **Documentos de audio/video**: Arquivos de midia (MP3, MP4, etc.) sao detectados automaticamente e marcados como conteudo nao-textual, sem gerar erro.

- **OCR lento**: O OCR roda localmente no navegador. Documentos com muitas paginas podem demorar. Ajuste o limite de paginas nas configuracoes.

- **Minuta usando modelo errado**: A busca automatica usa o conteudo do processo para encontrar o modelo mais similar. Se o resultado nao for adequado, reorganize seus modelos em subpastas mais especificas ou gere do zero (botao "Nova minuta").

- **Chave de API invalida**: Use o botao "Testar" nas configuracoes para verificar. Cada provedor tem seu formato de chave. Certifique-se de que a chave corresponde ao provedor selecionado.

- **Popup do editor nao abriu**: O SEI abre o editor em uma janela pop-up. Se o navegador estiver bloqueando popups para `sei.trf5.jus.br`, o fluxo de insercao automatica falha. Permita popups para o dominio do SEI em "Configuracoes do site" do navegador.

- **Erro "Editor CKEditor nao ficou pronto"**: Pode ocorrer em paginas com muitos frames ou conexao lenta. A extensao aguarda ate 30 segundos. Se persistir, copie a minuta pelo botao "Copiar" do painel e cole (Ctrl+V) manualmente no editor do SEI, que ja estara aberto.

- **Cadastro preenchido mas editor nao abriu**: Verifique se o SEI exibiu algum dialogo modal (nivel de acesso, confirmacao) bloqueando o fluxo. O SEIrtao aguarda o editor abrir naturalmente; dialogos manuais precisam ser respondidos antes.

- **Insercao desabilitada**: Por seguranca, a insercao automatica e opt-in. Va em "Gerenciar modelos" -> "Insercao automatica de minutas no SEI" e habilite a opcao. O painel passa a exibir os quatro passos do stepper.

- **Atualizacao da extensao**: Quando receber uma nova versao do "dist.zip", extraia o arquivo sobrescrevendo a pasta "dist" ja existente e depois va em chrome://extensions ou edge://extensions e clique no botao de atualizar (seta circular) no card da extensao.
