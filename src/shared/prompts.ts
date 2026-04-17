/**
 * System prompts e templates de quick actions usados pela Fase 4.
 * Centralizados aqui para facilitar iteração sem mexer em UI/lógica.
 */

import type { ProcessoDocumento } from './types';
import { CONTEXT_LIMITS } from './constants';

/**
 * System prompt institucional do SEIrtão — assistente de apoio a processos
 * ADMINISTRATIVOS tramitados no SEI pelos servidores da Justiça Federal no
 * Ceará (JFCE) e do TRF5. A pegada aqui é distinta da do paidegua (PJe):
 * não há autor/réu, não há contraditório formal, não há ratio decidendi.
 * O que existe é instrução, fundamento normativo, ato administrativo,
 * controle interno e providências de tramitação.
 */
export const SYSTEM_PROMPT = `Você é o SEIrtão, assistente de apoio à análise e tramitação de processos administrativos no SEI (Sistema Eletrônico de Informações) da Justiça Federal no Ceará (JFCE) e do TRF5. Atue com rigor técnico, formalidade e precisão jurídico-administrativa.

Diretrizes de resposta:
- Responda sempre em português brasileiro formal.
- Cite os documentos do processo que embasam cada afirmação, indicando o id e o tipo/descrição (ex.: "conforme Informação 42/2026-NUCAF — doc 7654321").
- Quando não houver elementos no processo para responder, declare isso explicitamente em vez de inferir.
- Não invente fatos, datas, unidades, servidores, números de processo, empenhos ou valores que não constem dos documentos fornecidos.
- Reconheça a natureza administrativa do processo: não use terminologia de processo judicial contencioso (autor/réu, ratio decidendi, ponto controvertido, dispositivo de sentença). Fale em interessados, unidades envolvidas, requerimento, instrução, fundamentação normativa e ato administrativo.
- Observe o princípio da legalidade (art. 37 da CF), da motivação, da finalidade pública, da eficiência e da publicidade no exame do processo.
- Em processos de contratação, observe a Lei 14.133/21, Res. CNJ 347/2020 e normativos internos do TRF5/JFCE. Em processos de pessoal, observe a Lei 8.112/90 e as resoluções aplicáveis. Em processos de gestão documental/sigilo, observe a LGPD e a Res. CNJ 363/2021.
- Trate todos os dados como sensíveis: cite CPF, matrícula, dados bancários e outros dados pessoais apenas quando estritamente necessário à análise, em redação profissional.
- Ao analisar documentos digitalizados sem texto extraído, mencione expressamente que o documento precisa de OCR.
- Quando solicitado a minutar atos administrativos (despacho, informação, parecer, portaria, decisão), siga o estilo formal da Administração Pública Federal e da praxe interna do TRF5.

Formatação da resposta (obrigatória em toda saída livre — vale para chat, consultas e análises, salvo instrução específica em contrário no prompt da ação):
- NÃO use marcação markdown. Nada de asteriscos (* ou **), sustenidos (#), listas com hífen-markdown ou número, crases (\`), negrito, itálico ou tabelas.
- Para destacar títulos de seção ou rótulos, escreva-os em CAIXA ALTA em linha própria, sem caracteres de pontuação à esquerda.
- Para enumerar itens, use uma linha por item iniciada por "- " (traço comum + espaço), sem negrito.
- Texto em prosa profissional, objetiva, sem floreio retórico. Parágrafos separados por linha em branco.
- Citações literais de lei ou norma: parágrafo próprio iniciado por "> " para indicar recuo de citação.`;

/** Quick actions pré-definidas. */
export interface QuickActionDef {
  id: string;
  label: string;
  prompt: string;
}

export const QUICK_ACTIONS: readonly QuickActionDef[] = [
  {
    id: 'resumir',
    label: 'Analisar processo administrativo',
    prompt: `Consulte todos os documentos fornecidos do processo administrativo na íntegra. Faça uma leitura holística para compreender o objeto, a instrução, o estado atual da tramitação e o que falta para o processo avançar.

REGRAS GERAIS DE SAÍDA (obrigatórias):
- NÃO use marcação markdown. Nada de asteriscos duplos, sustenidos, listas com hífen ou número, crases, negrito, itálico ou tabelas.
- Para destacar títulos de seção, escreva-os em CAIXA ALTA em linha própria, sem nenhum caractere de pontuação à esquerda (sem "#", sem "**").
- Para enumerar itens dentro de uma seção, escreva cada item em uma linha iniciada por traço comum ("- "), sem negrito.
- Texto em prosa profissional, objetiva, sem floreio retórico.

TAREFA
Analise em detalhe o processo administrativo fornecido lendo TODOS os documentos em ordem cronológica. Descreva com precisão o que se pretende, em que estado a instrução se encontra e quais providências ainda são necessárias. Siga rigorosamente a estrutura de seções abaixo.

ESPECIALIDADE
Você é especialista em Direito Administrativo, Gestão Pública, Controle Interno, Contratações Públicas (Lei 14.133/21), Regime Jurídico dos Servidores (Lei 8.112/90), LGPD e na praxe administrativa do Judiciário Federal (TRF5/JFCE). Incorpore a especialidade da matéria de fundo do processo (licitação, pessoal, orçamento, tecnologia, manutenção predial, precatório administrativo, assentamentos funcionais etc.).

LINGUAGEM E ESTILO
Adote tom profissional e objetivo, próprio da Administração Pública. Escreva de modo conciso, mas completo. Não use terminologia de processo judicial contencioso: não fale em "autor", "réu", "ratio decidendi", "ponto controvertido", "dispositivo de sentença". Em processo administrativo há interessados, unidades envolvidas, requerimento, instrução, fundamento normativo e ato administrativo. Vá direto para a resposta, começando pelo cabeçalho DADOS DO PROCESSO.

ESTRUTURA DA ANÁLISE (use os seguintes títulos de seção, em caixa alta, cada um em linha própria)

DADOS DO PROCESSO
Linha única no formato: NÚMERO SEI — TIPO DO PROCESSO (assunto, conforme autuação) — UNIDADE GERADORA — DATA DE AUTUAÇÃO — UNIDADE ATUAL — INTERESSADO(S) PRINCIPAL(IS).

OBJETO
Em 1 a 3 parágrafos, explique o que o processo pretende (ex.: concessão de auxílio, contratação direta, nomeação, cessão, ressarcimento, adesão a ata, aquisição de bem/serviço, aprovação de relatório, progressão funcional, pagamento de diárias, apuração preliminar etc.).

INTERESSADOS E UNIDADES ENVOLVIDAS
Relacione os atores com o papel de cada um (um por linha, iniciada por "- "):
- requerente (servidor ou pessoa externa);
- unidade técnica/demandante;
- unidade de análise jurídica (ex.: Assessoria Jurídica, Secretaria de Administração);
- unidade de execução orçamentária/financeira, quando houver;
- ordenador de despesa / autoridade decisória;
- gestor/fiscal (quando contrato), empresa contratada, pregoeiro etc.

INSTRUÇÃO PROCESSUAL
Relacione em ordem cronológica os documentos mais relevantes (um por linha, iniciada por "- "), informando id, tipo/descrição, data e unidade/autor. Destaque:
- requerimento inicial ou ato de instauração;
- informações técnicas e manifestações de áreas setoriais;
- pareceres jurídicos e despachos decisórios;
- pedidos e cumprimento de diligências;
- juntadas de comprovantes, notas fiscais, certidões, atestados etc.;
- atos de publicação (DOU/DJE), homologações, empenhos, ordens bancárias.

FUNDAMENTAÇÃO NORMATIVA
Liste as normas efetivamente citadas ou aplicáveis ao objeto, apontando em qual documento cada fundamento aparece. Referências típicas: CF/88 (art. 37 e correlatos), Lei 8.112/90, Lei 14.133/21, Lei 9.784/99 (processo administrativo federal), LGPD (Lei 13.709/18), resoluções do CNJ e do TRF5, portarias do Presidente/Diretor do Foro, pareceres da AGU, orientações internas de corregedoria e controle interno.

ESTADO ATUAL E PENDÊNCIAS
Em linguagem direta: o que JÁ foi decidido ou cumprido até agora e o que PERMANECE pendente (manifestação de unidade específica, assinatura do ordenador, publicação, empenho, cadastramento em sistema corporativo, prestação de contas, prazo para contrarrazões do interessado, diligência aberta sem retorno etc.). Indique, quando possível, com qual unidade o processo se encontra no momento.

PONTOS DE ATENÇÃO
Relacione riscos e inconsistências observados (um por linha, iniciada por "- "):
- prazos vencidos ou em vias de vencer (decadência, prazo de manifestação, prazo contratual);
- ausência de documento ou manifestação obrigatória;
- divergências entre documentos (valores, datas, beneficiários);
- conflito com normativo interno ou resolução do CNJ;
- aspectos de LGPD / sigilo mal tratados;
- dúvida sobre competência da autoridade decisória;
- impacto orçamentário não demonstrado.

PRÓXIMAS PROVIDÊNCIAS SUGERIDAS
Com base no estado atual, indique de 2 a 5 passos concretos (um por linha, iniciada por "- "). Exemplos: "encaminhar à Assessoria Jurídica para parecer", "intimar o interessado para juntada do documento X", "solicitar empenho à SECAD", "publicar portaria no DJF5", "devolver à unidade demandante para ajuste do termo de referência". Trate como SUGESTÕES de apoio — a decisão é do agente responsável.

FONTES
Cite dados e informações estritamente referenciados nos documentos do processo em análise, sem adicionar materiais externos. Cite sempre os ids dos documentos que embasam cada afirmação, no formato "(doc 7654321)". Se um documento estiver digitalizado sem texto extraído (imagem/PDF sem OCR), registre essa limitação expressamente.

NOTAS FINAIS
Forneça análise imparcial e holística, com foco em apoiar a decisão do agente público responsável — nunca substituí-lo. Se o processo for de contratação pública, observe especialmente a Lei 14.133/21 (fases de planejamento, seleção, gestão contratual). Se for de pessoal, observe a Lei 8.112/90 e as resoluções aplicáveis do CNJ/CJF/TRF5. Termine com a expressão "FIM DA ANÁLISE".`
  },
  {
    id: 'minutar-despacho',
    label: 'Minutar despacho saneador',
    prompt:
      'Elabore minuta de despacho saneador para este processo, observando o ' +
      'art. 357 do CPC. Inclua: resolução das questões processuais pendentes, ' +
      'fixação dos pontos controvertidos, distribuição do ônus da prova e ' +
      'designação de provas (quando cabíveis). Use linguagem formal do Judiciário Federal.\n\n' +
      'REGRAS DE FORMATO (obrigatórias):\n' +
      '1. Texto em prosa corrida, parágrafos separados por linha em branco.\n' +
      '2. Sem nenhum marcador de markdown: nada de asteriscos, sustenidos, listas com hífen ou número, nem crases.\n' +
      '3. Citações textuais de lei ou doutrina devem aparecer em parágrafo próprio iniciado pelo sinal de maior seguido de espaço (> ), que indica recuo de citação.\n' +
      '4. NÃO inclua cabeçalho, número do processo, identificação das partes nem o título "DESPACHO" — esses elementos já são preenchidos automaticamente pelo editor do PJe. Comece diretamente pelo corpo da peça.\n' +
      '5. Encerre o texto com a linha "Fortaleza/CE, [data por extenso]." sem assinatura, nome ou cargo (também preenchidos pelo PJe).'
  },
  {
    id: 'partes',
    label: 'Listar partes',
    prompt:
      'Liste todas as partes do processo com suas qualificações (autor, réu, ' +
      'litisconsortes, terceiros interessados), CPF/CNPJ quando disponíveis nos autos ' +
      'e seus respectivos advogados/procuradores. Indique o documento de onde extraiu cada informação.'
  }
];

/**
 * Prompt da 1ª rodada do botão "Minutar próximo ato" do SEIrtão.
 *
 * Faz TRIAGEM: lê o processo integralmente e indica o ato administrativo
 * mais adequado ao momento processual atual, com justificativa curta.
 * NÃO gera a minuta nesta rodada — a minuta só é produzida depois, numa
 * 2ª rodada dedicada (`buildMinutaOnlyPrompt`), quando o usuário já
 * escolheu o ato (sugerido ou outro) e, opcionalmente, informou
 * orientações adicionais.
 *
 * A saída vem em DOIS blocos fixos (ATO SUGERIDO, JUSTIFICATIVA) para
 * que a UI consiga extraí-los com regex e apresentá-los em cartão.
 */
export const MINUTAR_PROXIMO_ATO_PROMPT = `Sua tarefa é RECOMENDAR o próximo ato administrativo mais adequado para este processo, com base na leitura integral dos documentos fornecidos. NÃO escreva a minuta nesta etapa — só a indicação do ato e a justificativa.

## ESPECIALIDADE
Você é especialista em Direito Administrativo, Lei 9.784/99 (processo administrativo federal), Lei 14.133/21 (contratações públicas), Lei 8.112/90 (regime dos servidores), LGPD e na praxe administrativa do TRF5/JFCE. Atue com formalidade, objetividade e precisão normativa.

## ATOS POSSÍVEIS (escolha EXATAMENTE UM)
Você deve escolher o ato que representa a próxima providência natural e proporcional neste momento da tramitação:

1. Despacho de encaminhamento — move o processo à unidade competente para a próxima etapa (instrução, manifestação, decisão, publicação). Curto, identifica unidade destino e motivo.
2. Despacho de instrução — determina providência concreta (juntada de documento, manifestação do interessado, diligência, consulta a sistema corporativo, fixação de prazo). Breve e objetivo.
3. Informação técnica — manifestação factual/técnica da unidade competente sobre ponto específico (disponibilidade orçamentária, conformidade documental, compatibilidade de perfil funcional, parâmetros técnicos).
4. Parecer jurídico — análise de legalidade/adequação normativa do pedido ou procedimento. Enfrenta as normas aplicáveis e conclui pela viabilidade jurídica (ou aponta a correção necessária).
5. Decisão administrativa — ato da autoridade competente que resolve o mérito: defere, indefere, aprova, autoriza, homologa, ratifica.
6. Ato ordinatório — ato de mero expediente da secretaria (juntada automatizada, ciência, redistribuição, publicação).
7. Memorando — comunicação formal entre unidades internas sobre matéria do processo.
8. Ofício — comunicação formal com órgão ou pessoa externa à JFCE/TRF5.

## HEURÍSTICAS PARA ESCOLHER
- Se há decisão administrativa já proferida mas ainda não cumprida → minute o ato que dá cumprimento (despacho de encaminhamento para execução, ato ordinatório de publicação, ofício ao destinatário externo).
- Se há pedido de manifestação/diligência em aberto sem resposta → despacho cobrando ou reencaminhando.
- Se a instrução está completa e o processo está com a autoridade decisória → decisão administrativa.
- Se falta elemento técnico ou jurídico → despacho de instrução solicitando a manifestação, OU a própria informação/parecer (a depender de quem é o autor do próximo ato).
- Se o último documento é um pedido novo sem triagem → despacho de encaminhamento à unidade competente.

## FORMATO DE SAÍDA (obrigatório)
Produza EXATAMENTE dois blocos, nesta ordem, separados por linha em branco, com os títulos em caixa alta exatamente como abaixo e sem nada além deles:

ATO SUGERIDO: [nome do ato da lista acima, exatamente um — sem marcadores, sem aspas, sem comentários após]

JUSTIFICATIVA: [2 a 4 linhas explicando por que este é o próximo passo natural, citando o estado atual do processo e o id do documento que ancora a decisão, no formato "(doc 7654321)"]

NÃO escreva "MINUTA", nem rascunhe o corpo do ato, nem acrescente qualquer marcador de encerramento ("FIM", "---" etc.). Encerre na última linha da JUSTIFICATIVA.`;

/**
 * Catálogo canônico dos 8 atos administrativos sugeridos pelo
 * `MINUTAR_PROXIMO_ATO_PROMPT`. Usado pela UI para montar o seletor
 * alternativo ("Escolher outro ato…") e pela Fase B (mapear ato → tipo
 * de documento do SEI).
 *
 * O campo `label` é o rótulo exato que o prompt produz em "ATO SUGERIDO".
 * O campo `seiTypeHints` lista palavras-chave esperadas no nome do tipo
 * de documento cadastrado no SEI — usado pelo autocomplete para casar
 * sugestão do modelo com os tipos realmente habilitados na unidade.
 */
/**
 * Natureza administrativa do ato. Controla a rigidez do prompt de geração
 * quando há modelo: `gabarito` manda seguir o template parágrafo a parágrafo
 * (típico de parecer, informação técnica, decisão); `referencia` trata o
 * modelo só como referência de estilo (despacho, ordinatório, comunicação).
 */
export type NaturezaAdm =
  | 'despacho'
  | 'informacao'
  | 'parecer'
  | 'decisao-adm'
  | 'ordinatorio'
  | 'comunicacao';

export interface AtoAdministrativo {
  id: string;
  label: string;
  description: string;
  seiTypeHints: readonly string[];
  natureza: NaturezaAdm;
  rigidez: 'gabarito' | 'referencia';
  /** Subpastas preferenciais do diretório de modelos (case-insensitive). */
  folderHints: readonly string[];
  /** Termos que, se presentes no caminho/texto do modelo, o excluem. */
  excludeTerms: readonly string[];
}

export const ATOS_ADMINISTRATIVOS: readonly AtoAdministrativo[] = [
  {
    id: 'despacho-encaminhamento',
    label: 'Despacho de encaminhamento',
    description: 'Move o processo à unidade competente para a próxima etapa.',
    seiTypeHints: ['despacho', 'encaminhamento'],
    natureza: 'despacho',
    rigidez: 'referencia',
    folderHints: ['despacho-encaminhamento', 'despachos', 'despacho', 'encaminhamento'],
    excludeTerms: ['parecer', 'decisao', 'decisão'],
  },
  {
    id: 'despacho-instrucao',
    label: 'Despacho de instrução',
    description: 'Determina providência concreta (juntada, manifestação, diligência).',
    seiTypeHints: ['despacho', 'instrução', 'instrucao'],
    natureza: 'despacho',
    rigidez: 'referencia',
    folderHints: ['despacho-instrucao', 'despachos', 'despacho', 'instrucao', 'instrução'],
    excludeTerms: ['parecer', 'decisao', 'decisão'],
  },
  {
    id: 'informacao-tecnica',
    label: 'Informação técnica',
    description: 'Manifestação factual/técnica da unidade competente.',
    seiTypeHints: ['informação', 'informacao'],
    natureza: 'informacao',
    rigidez: 'gabarito',
    folderHints: ['informacao-tecnica', 'informacoes', 'informações', 'informacao', 'informação'],
    excludeTerms: ['parecer', 'decisao', 'decisão', 'oficio', 'ofício'],
  },
  {
    id: 'parecer-juridico',
    label: 'Parecer jurídico',
    description: 'Análise de legalidade/adequação normativa.',
    seiTypeHints: ['parecer'],
    natureza: 'parecer',
    rigidez: 'gabarito',
    folderHints: ['parecer-juridico', 'pareceres', 'parecer'],
    excludeTerms: ['despacho', 'ordinatorio', 'ordinatório', 'memorando', 'oficio', 'ofício'],
  },
  {
    id: 'decisao-administrativa',
    label: 'Decisão administrativa',
    description: 'Ato da autoridade que resolve o mérito (defere, aprova, homologa).',
    seiTypeHints: ['decisão', 'decisao'],
    natureza: 'decisao-adm',
    rigidez: 'gabarito',
    folderHints: ['decisao-administrativa', 'decisoes', 'decisões', 'decisao', 'decisão'],
    excludeTerms: ['despacho', 'ordinatorio', 'ordinatório', 'memorando', 'oficio', 'ofício'],
  },
  {
    id: 'ato-ordinatorio',
    label: 'Ato ordinatório',
    description: 'Ato de mero expediente da secretaria.',
    seiTypeHints: ['ato ordinatório', 'ato ordinatorio', 'ordinatório', 'ordinatorio'],
    natureza: 'ordinatorio',
    rigidez: 'referencia',
    folderHints: ['ato-ordinatorio', 'ordinatorio', 'ordinatorios', 'ordinatório', 'ordinatórios'],
    excludeTerms: ['parecer', 'decisao', 'decisão'],
  },
  {
    id: 'memorando',
    label: 'Memorando',
    description: 'Comunicação formal entre unidades internas.',
    seiTypeHints: ['memorando'],
    natureza: 'comunicacao',
    rigidez: 'referencia',
    folderHints: ['memorando', 'memorandos'],
    excludeTerms: ['parecer', 'decisao', 'decisão'],
  },
  {
    id: 'oficio',
    label: 'Ofício',
    description: 'Comunicação formal com órgão ou pessoa externa.',
    seiTypeHints: ['ofício', 'oficio'],
    natureza: 'comunicacao',
    rigidez: 'referencia',
    folderHints: ['oficio', 'oficios', 'ofício', 'ofícios'],
    excludeTerms: ['parecer', 'decisao', 'decisão'],
  },
];

/**
 * Resolve a entrada do catálogo a partir de um rótulo livre.
 * Usa match fuzzy (normalize + contains) contra `label` e `id`. Usado pelo
 * orquestrador da 2ª rodada do "Minutar próximo ato" para descobrir os
 * hints de busca do ato escolhido pelo usuário.
 */
export function findAtoByLabel(label: string): AtoAdministrativo | null {
  if (!label) return null;
  const normalize = (s: string): string =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const needle = normalize(label);
  if (!needle) return null;
  return (
    ATOS_ADMINISTRATIVOS.find((a) => {
      const l = normalize(a.label);
      const i = normalize(a.id);
      return needle === l || needle === i || needle.includes(l) || l.includes(needle);
    }) ?? null
  );
}

/**
 * Resultado parseado da triagem (1ª rodada) do `MINUTAR_PROXIMO_ATO_PROMPT`.
 * `ato` traz o label literal extraído (pode ter variações de caixa/acento);
 * `atoId` é o id do catálogo casado heuristicamente — null se não bateu.
 */
export interface MinutarTriagemResult {
  ato: string;
  atoId: string | null;
  justificativa: string;
}

/**
 * Extrai os dois blocos (ATO SUGERIDO / JUSTIFICATIVA) da saída do
 * `MINUTAR_PROXIMO_ATO_PROMPT`. Tolera variações de espaçamento e faz
 * match fuzzy do ato contra o catálogo `ATOS_ADMINISTRATIVOS`. Se por
 * algum motivo o modelo ainda produzir um bloco MINUTA, ele é descartado.
 */
export function parseMinutarResult(raw: string): MinutarTriagemResult | null {
  if (!raw) return null;

  const atoMatch = raw.match(/ATO\s+SUGERIDO\s*:\s*(.+?)(?:\r?\n|$)/i);
  const justifMatch = raw.match(/JUSTIFICATIVA\s*:\s*([\s\S]*?)(?=\r?\n\s*MINUTA\s*:|\r?\n\s*MINUTA\s*$|$)/i);

  if (!atoMatch) return null;
  const ato = atoMatch[1]!.trim().replace(/^["'\[]+|["'\]]+$/g, '');
  const justificativa = justifMatch
    ? justifMatch[1]!.trim().replace(/\s*FIM\s+DA\s+JUSTIFICATIVA\.?\s*$/i, '').trim()
    : '';

  const normalize = (s: string): string =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const atoNorm = normalize(ato);
  const atoId = ATOS_ADMINISTRATIVOS.find((a) => {
    const labelNorm = normalize(a.label);
    return atoNorm === labelNorm || atoNorm.includes(labelNorm) || labelNorm.includes(atoNorm);
  })?.id ?? null;

  return { ato, atoId, justificativa };
}

/**
 * Prompt para gerar APENAS a minuta de um ato específico, já escolhido
 * pelo usuário. Diferente do `MINUTAR_PROXIMO_ATO_PROMPT`, aqui não há
 * os blocos ATO SUGERIDO / JUSTIFICATIVA — a saída é direto o corpo do
 * ato, pronto para injeção no editor do SEI.
 */
export function buildMinutaOnlyPrompt(
  atoLabel: string,
  orientations?: string,
): string {
  const orientBlock = orientations?.trim()
    ? `\n\nORIENTAÇÕES ADICIONAIS DO USUÁRIO (devem ser observadas na redação):\n${orientations.trim()}`
    : '';

  return `Sua tarefa é redigir a MINUTA de um ato administrativo específico para este processo, com base na leitura integral dos documentos fornecidos.

ATO A SER MINUTADO: ${atoLabel}

ESPECIALIDADE
Você é especialista em Direito Administrativo, Lei 9.784/99, Lei 14.133/21, Lei 8.112/90, LGPD e na praxe administrativa do TRF5/JFCE.${orientBlock}

REGRAS DE REDAÇÃO
1. Prosa corrida, parágrafos separados por uma linha em branco.
2. SEM marcadores de markdown: nada de asteriscos, sustenidos, listas com hífen ou número, crases, negrito ou itálico.
3. Citações textuais de lei ou norma em parágrafo próprio iniciado por "> ".
4. NÃO inclua cabeçalho identificando o processo (número, unidade, interessado), NÃO escreva o título do ato (ex.: "DESPACHO", "INFORMAÇÃO"), NÃO assine: o SEI insere esses elementos automaticamente. Comece direto pelo corpo do ato.
5. Encerre com fórmula de encaminhamento condizente: "À consideração superior.", "Encaminhe-se à [unidade] para [finalidade].", "Publique-se.", "Cumpra-se.", "Dê-se ciência ao interessado." etc.
6. Linguagem formal da Administração Pública Federal; evite jargão desnecessário.
7. NÃO invente fatos, datas, valores, unidades, servidores, empresas ou números que não constem dos documentos. Se precisar de dado ausente, use marcador entre colchetes ([indicar valor], [fls. do doc X]).
8. Cite o id do documento que embasa cada fato relevante, no formato "(doc 7654321)".

FORMATO DE SAÍDA
Responda APENAS com o corpo da minuta, sem preâmbulo, sem o rótulo "MINUTA:", sem repetir o nome do ato. NÃO escreva qualquer marcador de encerramento ao final (nada de "FIM DA MINUTA", "FIM", "---" ou similar) — encerre com a fórmula de encaminhamento natural do ato.`;
}

/**
 * Instruções específicas por natureza administrativa, usadas quando NÃO há
 * modelo cadastrado para o ato (fallback do `buildMinutaWithTemplatePrompt`).
 * Cada entrada descreve a peça "do zero" no estilo administrativo.
 */
const INSTRUCOES_SEM_MODELO_ADM: Record<NaturezaAdm, string> = {
  despacho:
    `Redija o despacho do zero. Despachos são breves e objetivos — ` +
    `determinam uma providência concreta (encaminhamento, juntada, ` +
    `manifestação, diligência, prazo). NÃO estruture como parecer ou ` +
    `decisão. Analise o estado atual do processo e indique o próximo ` +
    `passo processual adequado.`,
  informacao:
    `Redija a informação técnica do zero, no estilo da unidade competente ` +
    `do TRF5/JFCE. Estruture com: objeto da manifestação, dados verificados ` +
    `(factuais, sem juízo de legalidade), fundamento técnico/normativo ` +
    `específico do ponto consultado e conclusão objetiva. Linguagem ` +
    `administrativa impessoal, sem dispositivos decisórios.`,
  parecer:
    `Redija o parecer jurídico do zero, no estilo da Assessoria Jurídica ` +
    `do TRF5/JFCE. Estruture com: relatório sucinto do objeto, análise de ` +
    `legalidade (normas aplicáveis — Lei 9.784/99, Lei 14.133/21, Lei ` +
    `8.112/90, LGPD, resoluções CNJ/CJF/TRF5 conforme a matéria), ` +
    `conclusão pela viabilidade (ou apontamento do que corrigir). NÃO ` +
    `decida o mérito — o parecer opina, a decisão cabe à autoridade.`,
  'decisao-adm':
    `Redija a decisão administrativa do zero, no estilo da autoridade ` +
    `competente do TRF5/JFCE. Estruture com: relatório breve do objeto e ` +
    `da instrução, fundamentação (motivação obrigatória — art. 50 da Lei ` +
    `9.784/99 — com as normas aplicáveis e o enfrentamento das questões ` +
    `postas) e dispositivo (defere/indefere/aprova/homologa/ratifica, ` +
    `com as providências subsequentes). Linguagem direta e precisa.`,
  ordinatorio:
    `Redija o ato ordinatório do zero. São atos de mero expediente da ` +
    `secretaria (juntada automatizada, ciência, redistribuição, ` +
    `publicação). Texto curto, impessoal, referenciando o ato praticado ` +
    `e o destinatário da providência. NÃO fundamente como decisão nem ` +
    `como parecer.`,
  comunicacao:
    `Redija a comunicação formal do zero. Memorandos são trocados entre ` +
    `unidades internas da JFCE/TRF5; ofícios são dirigidos a órgãos ou ` +
    `pessoas externas. Estruture com: referência ao processo/assunto, ` +
    `exposição objetiva do que se comunica/requer, prazo quando cabível, ` +
    `fórmula de cortesia e encaminhamento. Linguagem formal da ` +
    `Administração Pública.`,
};

/**
 * Bloco que empacota um template administrativo dentro do prompt de
 * geração. Para atos de natureza `gabarito` (informação, parecer,
 * decisão), instrui o LLM a reproduzir parágrafo a parágrafo. Para
 * `referencia` (despacho, ordinatório, memorando, ofício), trata como
 * mera inspiração de estilo.
 */
function buildAdmTemplateBlock(
  ato: AtoAdministrativo,
  template: { relativePath: string; text: string },
): string {
  if (ato.rigidez === 'gabarito') {
    return `ATENÇÃO — REUSO DO GABARITO DA UNIDADE:

O modelo abaixo é um GABARITO (template padrão da unidade). Reproduza a peça PARÁGRAFO A PARÁGRAFO, mantendo:
  - a mesma sequência de seções/tópicos;
  - os mesmos fundamentos normativos (leis, decretos, resoluções CNJ/CJF/TRF5, portarias internas);
  - o mesmo estilo de redação, tom e nível de formalidade;
  - as mesmas frases-padrão e fórmulas de estilo da unidade;
  - a mesma estrutura da conclusão/dispositivo.

O QUE VOCÊ DEVE TROCAR (e SOMENTE isto):
  - dados do(s) interessado(s) (nomes, cargos, matrículas, CPF);
  - número do processo, datas, valores, prazos;
  - objeto específico e fatos do caso concreto;
  - análise técnica/jurídica aplicada ao caso;
  - conclusão, quando os fatos do caso exigirem diferença em relação ao gabarito.

NÃO FAÇA:
  - NÃO reorganize seções; NÃO omita nem acrescente seções não existentes no gabarito.
  - NÃO troque os fundamentos normativos, a menos que sejam manifestamente inaplicáveis ao caso.
  - NÃO resuma o gabarito — a peça final deve ter extensão comparável.
  - NÃO copie dados factuais do gabarito (nomes, CPF, datas, valores) — esses vêm do processo em análise.

=== GABARITO (modelo da unidade): ${template.relativePath} ===
${template.text}
=== FIM DO GABARITO ===

Agora, com base nos documentos do processo em análise (já carregados no contexto), redija a peça reproduzindo fielmente a estrutura do gabarito, substituindo apenas os dados do caso concreto.`;
  }

  return `MODELO DE REFERÊNCIA (use como inspiração de estilo, NÃO como gabarito rígido):

O modelo abaixo é uma referência da unidade. Use-o apenas para:
  - observar o tom e o vocabulário típico deste tipo de ato;
  - entender a extensão esperada (despachos e ordinatórios são curtos; ofícios e memorandos são moderados);
  - identificar fórmulas de encaminhamento recorrentes.

NÃO copie a estrutura parágrafo a parágrafo. A peça deve ser original, baseada exclusivamente na situação do processo em análise. O modelo é só referência de como peças deste tipo costumam ser redigidas na unidade.

=== REFERÊNCIA DE ESTILO: ${template.relativePath} ===
${template.text}
=== FIM DA REFERÊNCIA ===

Agora, com base nos documentos do processo em análise (já carregados no contexto), redija a peça adequada à situação atual.`;
}

/**
 * Prompt da 2ª rodada do "Minutar próximo ato" ciente de modelos da
 * unidade. Quando `template` é não-nulo, injeta gabarito/referência
 * conforme a `rigidez` do ato; quando é nulo, usa `INSTRUCOES_SEM_MODELO_ADM`
 * para a natureza correspondente. O texto livre de `orientations` é
 * anexado como refinamento final.
 */
export function buildMinutaWithTemplatePrompt(
  ato: AtoAdministrativo,
  template: { relativePath: string; text: string } | null,
  orientations?: string,
): string {
  const intro =
    `Sua tarefa é redigir a MINUTA do seguinte ato administrativo para o ` +
    `processo carregado no contexto:\n\n` +
    `ATO A SER MINUTADO: ${ato.label}\n` +
    `(${ato.description})`;

  const especialidade =
    `ESPECIALIDADE\n` +
    `Você é especialista em Direito Administrativo, Lei 9.784/99, Lei ` +
    `14.133/21, Lei 8.112/90, LGPD e na praxe administrativa do ` +
    `TRF5/JFCE.`;

  const body = template
    ? buildAdmTemplateBlock(ato, template)
    : INSTRUCOES_SEM_MODELO_ADM[ato.natureza];

  const orientBlock = orientations?.trim()
    ? `\n\nORIENTAÇÕES ADICIONAIS DO USUÁRIO (devem ser observadas na redação):\n${orientations.trim()}`
    : '';

  const regrasAdm =
    `REGRAS ADICIONAIS PARA ATOS ADMINISTRATIVOS\n` +
    `- NÃO inclua cabeçalho identificando o processo (número, unidade, ` +
    `interessado), NÃO escreva o título do ato (ex.: "DESPACHO", ` +
    `"INFORMAÇÃO"), NÃO assine — o SEI insere esses elementos ` +
    `automaticamente. Comece direto pelo corpo.\n` +
    `- Encerre com fórmula de encaminhamento condizente com o ato: ` +
    `"À consideração superior.", "Encaminhe-se à [unidade] para ` +
    `[finalidade].", "Publique-se.", "Cumpra-se.", "Dê-se ciência ao ` +
    `interessado." etc.\n` +
    `- NÃO invente fatos, datas, valores, unidades, servidores, empresas ` +
    `ou números que não constem dos documentos. Se precisar de dado ` +
    `ausente, use marcador entre colchetes ([indicar valor], ` +
    `[fls. do doc X]).\n` +
    `- Cite o id do documento que embasa cada fato relevante, no formato ` +
    `"(doc 7654321)".\n` +
    `- FORMATO DE SAÍDA: responda APENAS com o corpo da minuta, sem ` +
    `preâmbulo, sem o rótulo "MINUTA:", sem repetir o nome do ato. NÃO ` +
    `escreva marcador de encerramento ao final (nada de "FIM DA MINUTA", ` +
    `"FIM", "---" ou similar) — encerre com a fórmula de encaminhamento ` +
    `natural do ato.`;

  return `${intro}\n\n${especialidade}\n\n${body}${orientBlock}\n\n${regrasAdm}`;
}

/**
 * Prompt do botão "Otimizar modelo do SEI".
 *
 * Recebe um texto de minuta-modelo existente (colado pelo usuário) e
 * devolve: (1) a mesma peça reescrita, com todo dado pessoal/variável
 * substituído por `@TAGS@` em SNAKE_CASE em caixa alta, e (2) uma
 * listagem das variáveis identificadas, com breve explicação.
 *
 * Convencões das tags:
 *  - sempre entre `@…@`;
 *  - em caixa alta, snake_case (ex.: `@NOME_PARTE@`, `@NUMERO_PROCESSO@`,
 *    `@DATA@`, `@VALOR@`, `@UNIDADE_DESTINO@`);
 *  - usar a MESMA tag para a mesma entidade repetida no texto;
 *  - tags canônicas preferidas quando aplicáveis: `@NUMERO_PROCESSO@`,
 *    `@NOME_INTERESSADO@`, `@CPF@`, `@CNPJ@`, `@MATRICULA@`, `@DATA@`,
 *    `@VALOR@`, `@UNIDADE_DESTINO@`, `@CARGO_INTERESSADO@`, `@ORGAO@`.
 */
export const OTIMIZAR_MODELO_PROMPT = `Sua tarefa é OTIMIZAR um modelo de minuta administrativa para uso reutilizável no SEI (Sistema Eletrônico de Informações) do TRF5/JFCE.

ESPECIALIDADE
Você é especialista em Direito Administrativo, Lei 9.784/99, Lei 14.133/21, Lei 8.112/90, LGPD e na praxe administrativa do TRF5/JFCE, com forte senso de desenho de templates: o que é constante (fica no texto) e o que é variável (vira tag) em um modelo.

O QUE FAZER
1. Identifique no modelo TODOS os dados que mudariam a cada uso: nomes próprios (partes, servidores, magistrados, empresas), CPF/CNPJ/matrículas, datas específicas, números de processo, valores monetários, unidades/órgãos destinatários, cargos específicos, números de documentos internos, prazos em dias/meses, endereços.
2. Substitua cada dado variável por uma TAG no formato \`@NOME_EM_CAIXA_ALTA@\` (snake_case). Use a MESMA tag para a MESMA entidade quando ela aparecer em múltiplos pontos do texto.
3. Prefira, quando cabível, as tags canônicas: \`@NUMERO_PROCESSO@\`, \`@NOME_INTERESSADO@\`, \`@CPF@\`, \`@CNPJ@\`, \`@MATRICULA@\`, \`@DATA@\`, \`@VALOR@\`, \`@UNIDADE_DESTINO@\`, \`@CARGO_INTERESSADO@\`, \`@ORGAO@\`, \`@PRAZO@\`.
4. Se o mesmo tipo de entidade aparecer em papéis diferentes (ex.: interessado × requerido), diferencie as tags (\`@NOME_INTERESSADO@\` vs \`@NOME_REQUERIDO@\`).
5. Mantenha o restante do texto — o esqueleto reutilizável — o mais fiel possível ao original. Apenas:
   - remova redundâncias óbvias (repetições desnecessárias da mesma informação);
   - corrija erros gramaticais/ortográficos evidentes;
   - ajuste clareza mínima quando uma frase estiver ambígua;
   - NÃO reestruture seções inteiras; NÃO invente conteúdo novo.
6. Preserve a fundamentação jurídica original (artigos, leis, súmulas) tal como citada.
7. NÃO retire cabeçalho/rodapé institucional do SEI — se esses elementos estiverem ausentes no texto de entrada, também não os invente.

FORMATO DE SAÍDA (obrigatório — 2 blocos)

MODELO OTIMIZADO
Em seguida, o texto completo do modelo reescrito com as tags aplicadas. Prosa corrida, parágrafos separados por linha em branco, SEM marcadores markdown (nada de asteriscos, sustenidos, crases, negrito, itálico). Citações de norma em parágrafo próprio iniciado por "> ".

VARIÁVEIS IDENTIFICADAS
Em seguida, UMA linha por tag, no formato:
- @NOME_DA_TAG@ — breve explicação do que preencher (tipo de dado, exemplo quando útil).

Agrupe por ocorrência única (cada tag aparece UMA vez nesta lista, mesmo que tenha sido usada várias vezes no texto). Ordene pela ordem de primeira aparição no texto.

REGRAS ESTRITAS
- Responda APENAS com os dois blocos acima, nesta ordem, precedidos pelos cabeçalhos em CAIXA ALTA exatamente como escritos (MODELO OTIMIZADO e VARIÁVEIS IDENTIFICADAS).
- NÃO inclua preâmbulo, saudação, explicação do que você fez, nem resumo final.
- NÃO use markdown em nenhum dos blocos.
- NÃO invente variáveis que não apareçam no texto original.
- NÃO remova trechos substantivos do modelo — só o que for redundância óbvia.`;

/** Prompt do botão "Resumo em áudio" — versão narrável. */
export const AUDIO_SUMMARY_PROMPT =
  'Produza um resumo narrável em até 8 frases curtas, em tom claro e direto, ' +
  'apropriado para leitura em voz alta. Evite siglas não explicadas, listas ' +
  'numeradas e citações longas. Apresente: partes envolvidas, objeto do pedido, ' +
  'cronologia mínima e situação atual. Não use marcadores nem cabeçalhos.';

// ─────────────────────────────────────────────────────────────────────────
//  AÇÕES DE MINUTA — usadas pelos 5 botões de geração assistida por modelos
// ─────────────────────────────────────────────────────────────────────────

/**
 * Definição de cada ação de minuta. `folderHints` orienta a busca BM25 a
 * priorizar templates que estejam em subpastas com esses nomes (ex.:
 * `procedente/`); `queryHints` é a query padrão usada quando o usuário
 * não fornece termos adicionais — uma frase curta que descreve o tipo de
 * peça e ajuda o BM25 a discriminar entre modelos.
 *
 * O `generationPrompt` é o prompt enviado ao LLM. Ele deve produzir texto
 * sem markdown (vide regras já consagradas em `minutar-despacho`) e
 * incorporar o template escolhido como referência de estilo/estrutura.
 */
export interface TemplateAction {
  id: string;
  /** Rótulo curto do botão na sidebar. */
  label: string;
  /** Descrição usada em tooltip e na bolha de preview. */
  description: string;
  /** Subpastas preferenciais (case-insensitive, contains). */
  folderHints: string[];
  /** Query padrão de busca (BM25). */
  queryHints: string;
  /**
   * Natureza da peça. Controla:
   *  - o prompt de geração (gabarito rígido vs. referência flexível)
   *  - termos que EXCLUEM um modelo da seleção (ex.: "sentença" exclui
   *    um template de ser usado como modelo de despacho)
   */
  natureza: 'sentenca' | 'decisao' | 'despacho' | 'voto';
  /**
   * Termos que, se presentes no caminho ou texto do modelo, indicam que
   * ele NÃO é adequado para esta ação. Serve como filtro negativo no BM25.
   */
  excludeTerms?: string[];
}

/** Conjunto de ações para o 1º grau (sentenças e decisões originárias). */
export const TEMPLATE_ACTIONS_1G: readonly TemplateAction[] = [
  {
    id: 'sentenca-procedente',
    label: 'Julgar procedente',
    description: 'Minuta de sentença julgando procedente o pedido inicial.',
    folderHints: ['procedente', 'procedencia', 'sentenca-procedente'],
    queryHints:
      'sentença julga procedente pedido autor condeno relatório fundamentação dispositivo',
    natureza: 'sentenca',
    excludeTerms: ['despacho', 'decisao interlocutoria', 'diligencia']
  },
  {
    id: 'sentenca-improcedente',
    label: 'Julgar improcedente',
    description: 'Minuta de sentença julgando improcedente o pedido inicial.',
    folderHints: ['improcedente', 'improcedencia', 'sentenca-improcedente'],
    queryHints:
      'sentença julga improcedente pedido autor relatório fundamentação dispositivo',
    natureza: 'sentenca',
    excludeTerms: ['despacho', 'decisao interlocutoria', 'diligencia']
  },
  {
    id: 'decidir',
    label: 'Decidir',
    description: 'Decisão interlocutória sobre questão pendente no processo.',
    folderHints: ['decisao', 'decisoes', 'interlocutoria'],
    queryHints:
      'decisão interlocutória defiro indefiro tutela urgência liminar antecipação',
    natureza: 'decisao',
    excludeTerms: ['sentença', 'julgo procedente', 'julgo improcedente', 'relatório fundamentação dispositivo']
  },
  {
    id: 'converter-diligencia',
    label: 'Converter em diligência',
    description: 'Despacho convertendo o julgamento em diligência.',
    folderHints: ['diligencia', 'diligencias', 'conversao'],
    queryHints:
      'converto julgamento diligência intime parte requerimento documento esclarecimento',
    natureza: 'despacho',
    excludeTerms: ['sentença', 'julgo procedente', 'julgo improcedente']
  },
  {
    id: 'despachar',
    label: 'Despachar',
    description: 'Despacho de impulsionamento processual.',
    folderHints: ['despacho', 'despachos', 'saneador'],
    queryHints:
      'despacho saneador expediente intimação cumprimento prazo manifestação cite intime',
    natureza: 'despacho',
    excludeTerms: ['sentença', 'julgo procedente', 'julgo improcedente', 'relatório fundamentação dispositivo']
  }
];

/**
 * Conjunto de ações para o 2º grau e turmas recursais (votos, decisões
 * monocráticas e despachos relatoriais).
 */
export const TEMPLATE_ACTIONS_2G: readonly TemplateAction[] = [
  {
    id: 'voto-mantem',
    label: 'Voto (mantém sentença)',
    description: 'Minuta de voto que nega provimento ao recurso e mantém a sentença recorrida.',
    folderHints: ['voto-mantem', 'mantem', 'nega-provimento', 'desprovimento', 'voto'],
    queryHints:
      'voto nega provimento recurso mantém sentença improvimento desprovimento relator',
    natureza: 'voto',
    excludeTerms: ['despacho']
  },
  {
    id: 'voto-reforma',
    label: 'Voto (reforma sentença)',
    description: 'Minuta de voto que dá provimento ao recurso e reforma a sentença recorrida.',
    folderHints: ['voto-reforma', 'reforma', 'da-provimento', 'provimento', 'voto'],
    queryHints:
      'voto dá provimento recurso reforma sentença provimento relator acórdão',
    natureza: 'voto',
    excludeTerms: ['despacho']
  },
  {
    id: 'decisao-nega-seguimento',
    label: 'Decisão nega seguimento ao recurso',
    description: 'Decisão monocrática que nega seguimento ao recurso (art. 932 do CPC).',
    folderHints: ['nega-seguimento', 'inadmissao', 'monocratica', 'decisao-monocratica'],
    queryHints:
      'decisão monocrática nega seguimento recurso inadmissibilidade artigo 932 CPC relator',
    natureza: 'decisao',
    excludeTerms: ['despacho', 'voto']
  },
  {
    id: 'decisao-2g',
    label: 'Decisão',
    description: 'Decisão monocrática do relator sobre questão pendente.',
    folderHints: ['decisao', 'decisoes', 'monocratica'],
    queryHints:
      'decisão monocrática relator tutela antecipada efeito suspensivo liminar',
    natureza: 'decisao',
    excludeTerms: ['despacho', 'voto', 'sentença']
  },
  {
    id: 'converter-diligencia-baixa',
    label: 'Converte em diligência com baixa',
    description: 'Despacho convertendo o julgamento em diligência com baixa dos autos à origem.',
    folderHints: ['diligencia-baixa', 'baixa-diligencia', 'baixa', 'diligencia'],
    queryHints:
      'converte julgamento diligência baixa autos origem juízo primeiro grau esclarecimento',
    natureza: 'despacho',
    excludeTerms: ['sentença', 'voto']
  },
  {
    id: 'despachar-2g',
    label: 'Despacho',
    description: 'Despacho de mero expediente do relator.',
    folderHints: ['despacho', 'despachos', 'relator'],
    queryHints:
      'despacho relator expediente intimação cumprimento prazo manifestação',
    natureza: 'despacho',
    excludeTerms: ['sentença', 'voto', 'julgo procedente', 'julgo improcedente']
  }
];

/**
 * Mantido por compatibilidade — equivale ao conjunto de 1º grau.
 * Prefira `getTemplateActionsForGrau` em código novo.
 */
export const TEMPLATE_ACTIONS: readonly TemplateAction[] = TEMPLATE_ACTIONS_1G;

/**
 * Retorna o conjunto de ações de minuta apropriado para o grau detectado.
 * 1º grau usa sentenças/decisões originárias; 2º grau e turmas recursais
 * usam votos, decisões monocráticas e despachos relatoriais.
 */
export function getTemplateActionsForGrau(
  grau: '1g' | '2g' | 'turma_recursal' | 'unknown'
): readonly TemplateAction[] {
  if (grau === '2g' || grau === 'turma_recursal') {
    return TEMPLATE_ACTIONS_2G;
  }
  return TEMPLATE_ACTIONS_1G;
}

/** Regras de formato comuns a todas as minutas geradas. */
const MINUTA_FORMAT_RULES = `REGRAS DE FORMATO (obrigatórias):
1. Texto em prosa corrida, parágrafos separados por linha em branco.
2. Sem nenhum marcador de markdown: nada de asteriscos, sustenidos, listas com hífen ou número, nem crases.
3. Citações textuais de lei ou doutrina devem aparecer em parágrafo próprio iniciado pelo sinal de maior seguido de espaço (> ), que indica recuo de citação.
4. NÃO inclua cabeçalho, número do processo, identificação das partes nem o título do ato — esses elementos já são preenchidos automaticamente pelo editor do SEI. Comece diretamente pelo corpo da peça.
5. Encerre o texto com a linha "[Cidade]/[UF], datado eletronicamente." — identifique a cidade e o estado da unidade da JFCE/TRF5 a partir dos documentos do processo (ex.: "Fortaleza/CE", "Juazeiro do Norte/CE", "Recife/PE"). Não use assinatura, nome ou cargo (preenchidos pelo SEI).`;

/**
 * Instruções específicas por natureza de peça, para geração SEM modelo.
 */
const INSTRUCOES_SEM_MODELO: Record<TemplateAction['natureza'], string> = {
  sentenca:
    `Redija a sentença do zero, seguindo a praxe do Judiciário Federal. ` +
    `Estruture com relatório (breve histórico processual), fundamentação ` +
    `(análise das provas e do direito aplicável) e dispositivo (comando ` +
    `decisório, honorários, custas). Use como base os documentos do ` +
    `processo já carregados no contexto.`,
  decisao:
    `Redija a decisão interlocutória do zero, analisando a questão pendente ` +
    `identificada nos autos. Fundamente com base na legislação e nas provas ` +
    `disponíveis. NÃO estruture como sentença (sem relatório extenso nem ` +
    `dispositivo de mérito). Use linguagem objetiva e direta, focada no ` +
    `ponto a ser decidido. Use como base os documentos do processo já ` +
    `carregados no contexto.`,
  despacho:
    `Redija o despacho do zero, como ato de impulsionamento processual. ` +
    `Despachos são breves e objetivos — determinem providências concretas ` +
    `(intimações, prazos, juntadas, conversões, cumprimentos). NÃO ` +
    `estruture como sentença ou decisão (sem relatório, fundamentação ` +
    `extensa nem dispositivo de mérito). Analise a situação atual do ` +
    `processo nos documentos carregados e determine o próximo passo ` +
    `processual adequado.`,
  voto:
    `Redija o voto do zero, seguindo a praxe do Judiciário Federal de 2º ` +
    `grau. Estruture com relatório, voto (fundamentação e conclusão) e ` +
    `ementa. Use como base os documentos do processo já carregados no ` +
    `contexto.`
};

/**
 * Instruções de gabarito por natureza — sentenças e votos usam gabarito
 * rígido (parágrafo a parágrafo); decisões e despachos usam o modelo
 * como referência flexível de estilo.
 */
function buildTemplateBlock(
  action: TemplateAction,
  template: { relativePath: string; text: string }
): string {
  if (action.natureza === 'sentenca' || action.natureza === 'voto') {
    return `ATENÇÃO — PRODUÇÃO EM SÉRIE COM GABARITO FIXO:

O modelo abaixo é um GABARITO (template). Você deve reproduzir a peça PARÁGRAFO A PARÁGRAFO, mantendo:
  - a mesma sequência de seções/tópicos, na mesma ordem;
  - os mesmos fundamentos legais (artigos de lei, súmulas, teses) citados em cada seção;
  - o mesmo estilo de redação, tom, nível de formalidade e extensão de cada parágrafo;
  - as mesmas frases-padrão e fórmulas de estilo (ex.: "Passo a decidir.", "Ante o exposto…");
  - a mesma estrutura do dispositivo (comandos, condenações, honorários, custas).

O QUE VOCÊ DEVE TROCAR (e SOMENTE isto):
  - nomes das partes → usar os nomes do processo em análise;
  - fatos e circunstâncias → adaptar ao caso concreto (laudo, datas, valores, provas);
  - número do processo, datas de audiência, datas de perícia → do processo atual;
  - análise probatória e subsunção → baseadas nas provas dos autos em análise;
  - conclusão (procedência/improcedência parcial) → se os fatos do caso concreto assim exigirem.

NÃO FAÇA:
  - NÃO reorganize as seções; NÃO omita seções presentes no modelo; NÃO acrescente seções que o modelo não tem.
  - NÃO troque os fundamentos legais por outros, a menos que sejam manifestamente inaplicáveis ao caso concreto.
  - NÃO resuma nem encurte o modelo — a peça final deve ter extensão comparável.
  - NÃO copie dados factuais do modelo (nomes, CPF, datas, valores) — esses vêm exclusivamente do processo em análise.

=== GABARITO (modelo de referência): ${template.relativePath} ===
${template.text}
=== FIM DO GABARITO ===

Agora, com base nos documentos do processo em análise (já carregados no contexto), redija a peça reproduzindo fielmente a estrutura do gabarito acima, substituindo apenas os dados do caso concreto.`;
  }

  // Decisões e despachos: modelo como REFERÊNCIA de estilo, não gabarito rígido
  return `MODELO DE REFERÊNCIA (use como inspiração de estilo e tom, NÃO como gabarito rígido):

O modelo abaixo é uma referência de estilo. Use-o para:
  - observar o tom, nível de formalidade e vocabulário típico deste tipo de peça;
  - entender a extensão esperada (despachos são curtos; decisões são moderadas);
  - identificar fórmulas de estilo recorrentes.

NÃO copie a estrutura parágrafo a parágrafo. A peça que você vai redigir deve ser original, baseada exclusivamente nos fatos e nas questões do processo em análise. O modelo é apenas uma referência de como peças deste tipo costumam ser redigidas.

=== REFERÊNCIA DE ESTILO: ${template.relativePath} ===
${template.text}
=== FIM DA REFERÊNCIA ===

Agora, com base nos documentos do processo em análise (já carregados no contexto), redija a peça adequada à situação processual atual.`;
}

/**
 * Constrói o prompt de geração de uma minuta a partir de uma ação e,
 * opcionalmente, de um template-modelo.
 *
 * Sentenças e votos: gabarito rígido (parágrafo a parágrafo).
 * Decisões e despachos: modelo como referência de estilo, com geração
 * orientada pela situação processual concreta.
 */
export function buildMinutaPrompt(
  action: TemplateAction,
  template: { relativePath: string; text: string } | null,
  refinement?: string
): string {
  const intro = `Elabore uma ${action.description.toLowerCase().replace(/\.$/, '')} para o processo carregado nos autos.`;

  const body = template
    ? buildTemplateBlock(action, template)
    : INSTRUCOES_SEM_MODELO[action.natureza];

  const refinementBlock = refinement
    ? `\n\nINSTRUÇÕES ADICIONAIS DO USUÁRIO (devem ser observadas na fundamentação e no resultado):\n${refinement}`
    : '';

  return `${intro}\n\n${body}${refinementBlock}\n\n${MINUTA_FORMAT_RULES}`;
}

// ─────────────────────────────────────────────────────────────────────────
//  TRIAGEM DE MINUTA — decide o melhor ato processual para o momento atual
// ─────────────────────────────────────────────────────────────────────────

/** Resultado estruturado da triagem produzida pelo LLM. */
export interface TriagemResult {
  /** id de uma TemplateAction pertencente ao grau adequado. */
  actionId: string;
  /** Justificativa curta (até 3 linhas) explicando a escolha. */
  justificativa: string;
}

/**
 * Limite de contexto enviado ao LLM de triagem. Aumentado para caber a
 * linha do tempo completa do processo + os últimos 8 documentos em texto
 * integral (ver `buildTriagemContextText` no content). Sem isso, o LLM
 * só enxergava inicial/contestação e recomendava atos já superados em
 * processos longos (ex.: sugerir perícia num processo já em cumprimento).
 */
const TRIAGEM_CASE_CONTEXT_LIMIT = 18_000;

/**
 * Monta o prompt de triagem: apresenta ao LLM o texto dos autos e o
 * conjunto de atos processuais possíveis (já filtrado por grau), pedindo
 * que escolha UM e justifique em até 3 linhas.
 */
export function buildTriagemPrompt(
  actions: readonly TemplateAction[],
  caseContext: string
): string {
  const actionsFmt = actions
    .map(
      (a) =>
        `- id: "${a.id}" — **${a.label}** (${a.natureza}): ${a.description}`
    )
    .join('\n');

  return (
    `Você está ajudando um magistrado a decidir qual é o MELHOR ato processual para o momento atual do processo.\n\n` +
    `COMO LER O CONTEXTO:\n` +
    `O contexto abaixo traz DOIS blocos complementares:\n` +
    `  1) "LINHA DO TEMPO DO PROCESSO" — panorama cronológico de TODAS as movimentações;\n` +
    `  2) "DOCUMENTOS RECENTES" — texto integral dos últimos documentos.\n\n` +
    `PRINCÍPIOS DE ANÁLISE (aplique a QUALQUER caso concreto, sem presumir cenário típico):\n` +
    `- Identifique a fase processual atual a partir da ÚLTIMA movimentação relevante, não da primeira.\n` +
    `- Um ato só é adequado se a providência que ele realiza AINDA NÃO foi efetivada e se não pressupõe etapa posterior à atual.\n` +
    `- Nunca recomende ato incompatível com a fase em que o processo se encontra, em qualquer direção (nem retroceder etapas já cumpridas, nem antecipar etapas ainda não maduras).\n` +
    `- Se houver pedido, requerimento ou manifestação pendente de apreciação, esse é o ponto de partida para escolher o ato.\n` +
    `- Se não houver pendência clara, escolha o ato de impulsionamento mais adequado à fase atual.\n\n` +
    `FATORES A CONSIDERAR:\n` +
    `- fase efetiva do processo (postulatória, saneamento, instrução, julgamento, recurso, cumprimento, arquivamento — ou qualquer outra identificável);\n` +
    `- questões processuais pendentes (citação, intimação, produção de provas, nulidades, preliminares);\n` +
    `- existência ou não de elementos suficientes para o ato pretendido;\n` +
    `- natureza da causa, pretensão deduzida e providências já realizadas.\n\n` +
    `Escolha EXATAMENTE UM dos atos listados. Se NENHUM dos atos disponíveis for apropriado ao momento processual concreto (por exemplo, porque o processo já ultrapassou a fase a que se destinam os atos listados, ou ainda não atingiu fase em que caibam), escolha o ato que menos distorça a realidade dos autos e DEIXE CLARO NA JUSTIFICATIVA essa inadequação, descrevendo qual seria o ato realmente cabível.\n\n` +
    `=== ATOS DISPONÍVEIS ===\n${actionsFmt}\n\n` +
    `=== CONTEXTO DOS AUTOS ===\n` +
    '```\n' +
    caseContext.slice(0, TRIAGEM_CASE_CONTEXT_LIMIT) +
    '\n```\n\n' +
    `Responda SEMPRE em JSON puro, sem markdown, sem comentários, no formato exato:\n` +
    `{"actionId": "<id escolhido, obrigatoriamente um dos listados acima>", "justificativa": "<explicação curta em PT-BR, no máximo 3 linhas, citando o estado do processo que justifica a escolha>"}\n\n` +
    `NÃO inclua mais nada além do JSON.`
  );
}

/**
 * Extrai {actionId, justificativa} de uma resposta bruta do LLM. Tolera
 * markdown ou texto adicional em volta do objeto JSON.
 * Retorna null se o `actionId` não estiver na lista permitida.
 */
export function parseTriagemResponse(
  raw: string,
  allowedActionIds: readonly string[]
): TriagemResult | null {
  if (!raw) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as {
      actionId?: unknown;
      justificativa?: unknown;
    };
    const actionId = typeof obj.actionId === 'string' ? obj.actionId.trim() : '';
    if (!actionId || !allowedActionIds.includes(actionId)) return null;
    const justificativa =
      typeof obj.justificativa === 'string' ? obj.justificativa.trim() : '';
    return { actionId, justificativa };
  } catch {
    return null;
  }
}

/**
 * Monta o bloco de contexto com os documentos extraídos. Aplica truncamento
 * conservador para não estourar o context window do modelo. Documentos
 * digitalizados sem texto extraído são incluídos apenas como metadata.
 */
export function buildDocumentContext(
  documentos: ProcessoDocumento[],
  numeroProcesso: string | null
): string {
  const header = numeroProcesso
    ? `Processo: ${numeroProcesso}\n\n=== Documentos disponíveis nos autos ===\n`
    : '=== Documentos disponíveis nos autos ===\n';

  const blocks: string[] = [];
  let totalChars = header.length;
  let truncados = 0;

  for (const doc of documentos) {
    const ocrTag = doc.isScanned && doc.textoExtraido ? ' | texto via OCR' : '';
    const head = `\n--- Documento id ${doc.id} | ${doc.tipo} | ${doc.descricao} ${
      doc.dataMovimentacao ? `(${doc.dataMovimentacao})` : ''
    }${ocrTag} ---\n`;

    let body: string;
    if (doc.isScanned && !doc.textoExtraido) {
      body = '[documento digitalizado — OCR ainda não disponível, conteúdo não extraído]\n';
    } else if (doc.textoExtraido) {
      body = doc.textoExtraido;
      if (body.length > CONTEXT_LIMITS.PER_DOCUMENT_HARD_CAP) {
        body = body.slice(0, CONTEXT_LIMITS.PER_DOCUMENT_HARD_CAP) +
          '\n[…trecho truncado para caber no contexto…]';
      }
    } else {
      body = '[conteúdo não extraído]\n';
    }

    const block = head + body;
    if (totalChars + block.length > CONTEXT_LIMITS.MAX_DOCUMENTS_CHARS) {
      truncados++;
      continue;
    }
    blocks.push(block);
    totalChars += block.length;
  }

  let footer = '';
  if (truncados > 0) {
    footer = `\n\n[Aviso: ${truncados} documento(s) foram omitidos do contexto por excederem o limite de tamanho. Solicite análises focadas para incluí-los.]`;
  }

  return header + blocks.join('') + footer;
}
