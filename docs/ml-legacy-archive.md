# Arquivo do laboratório ML legado

## Escopo e encerramento

Este documento preserva o conhecimento estrutural do laboratório temporal de ML que existia no repositório. As rotas experimentais, auditorias temporárias e buscas de features foram encerradas para que o próximo pipeline seja construído sobre uma base menor e com contratos explícitos.

Os resultados numéricos eram calculados sob demanda pelas rotas e não estavam armazenados como artefatos versionados no repositório. Por isso, este arquivo registra configurações, conclusões e limitações confirmadas pelo código, sem inventar métricas que não estejam persistidas.

## Evolução do pipeline

| Versão | Ideia principal                                                                       | Observação preservada                                                                               |
| ------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| v1     | Ridge temporal com features numéricas, one-hot de posição e baseline de média recente | `clubId`, `opponentClubId` e `points_avg_3_minus_avg_12` faziam parte da discussão de proveniência. |
| v1.1   | Comparação controlada sem `points_avg_3_minus_avg_12`                                 | Serviu para isolar o efeito dessa feature.                                                          |
| v1.2   | One-hot temporal de clube e adversário                                                | Categoria de referência era a menor categoria observada no treino.                                  |
| v1.2a  | Tratamento explícito de categorias desconhecidas                                      | Corrigiu a ambiguidade em que desconhecido podia ser confundido com a referência.                   |
| v2     | v1.2a com histórico de scouts                                                         | Usava 19 scouts e agregados históricos; validava leakage e cobertura.                               |
| v2.1   | Variante reduzida com 10 scouts e 4 agregados                                         | Incluía `DE` e tinha regra especial de ausência estrutural para esse scout.                         |

## Baseline

O baseline era `predictByRecentAverage`, implementado em `src/lib/backtest/baseline.ts`. Ele calcula a previsão pela média das participações anteriores dentro de uma janela de participações, sempre usando rodadas estritamente anteriores ao alvo. Quando não há participação anterior elegível, a previsão é nula e a amostra é ignorada pelo backtest.

Essa diferença entre janela de participações e janela de rodadas foi importante para interpretar o universo de avaliação. O código histórico preservado continua sendo a referência para comparações futuras.

## Resultados e conclusões preservados

As rotas v1–v2.1 exibiam comparações entre ML e baseline usando contagem, MAE, RMSE, Pearson e melhoria percentual. Como essas métricas eram produzidas em tempo de execução e não estavam salvas no Git, os números exatos não podem ser recuperados com segurança deste repositório.

As conclusões estruturais preservadas são:

1. A avaliação precisava ser temporal. O treino utilizava apenas linhas de rodadas anteriores à rodada de teste.
2. O tratamento de categorias desconhecidas em clube e adversário exigia uma categoria explícita, e não o vetor da categoria de referência.
3. Features históricas de scouts exigiam validação de ordem temporal, cobertura, `NaN` e `Infinity`.
4. A ausência de `DE` era uma questão de contrato de dados e não deveria ser confundida com zero sem uma decisão explícita.
5. Comparações de matchup precisavam restringir o universo às linhas com clube e posição disponíveis para evitar comparar conjuntos diferentes.

## Feature Search global e por posição

O laboratório tinha duas famílias de busca:

- **Feature Search global:** avaliava combinações de features sob estratégias de busca, limite de experimentos, tamanho mínimo/máximo e critérios de melhoria sobre o baseline.
- **Feature Search por posição:** repetia a busca para posições do Cartola, permitindo observar se um subconjunto funcionava melhor para goleiros, laterais, zagueiros, meias, atacantes ou técnicos.

Os milhares de experimentos individuais não foram preservados. O conhecimento útil foi reduzido às hipóteses: comparar contra baseline por rodada, exigir melhoria consistente em múltiplas rodadas, limitar piora de uma rodada individual e tratar o catálogo de features como contrato explícito.

## Hipóteses importantes

As hipóteses que permanecem como candidatos para o próximo pipeline são:

- disponibilidade e participação devem ser modeladas separadamente de expected points;
- histórico de scouts pode ser útil, mas somente quando a semântica de ausência estiver definida;
- contexto de clube, adversário, mando e posição deve ser calculado sem usar informação futura;
- resultados agregados podem esconder cobertura desigual entre jogadores e rodadas;
- métricas globais devem ser acompanhadas de cobertura, distribuição por rodada e comparação com baseline.

## Limitações conhecidas

A coleta histórica dependia de endpoints públicos sujeitos a falhas, mudanças de schema e rodadas incompletas. O laboratório antigo podia substituir falhas de coleta por estruturas vazias, o que tornava possível confundir erro de API com ausência real de dados. Essa prática foi removida da fundação Cartola que permanece.

Os payloads históricos nem sempre forneciam preço, variação, posição ou clube. Esses campos continuam opcionais no contrato histórico. A normalização preserva a distinção entre ausência de objeto de scouts e objeto sem ocorrências.

As versões antigas também mantinham catálogos paralelos de features e scouts. O contrato de scouts agora possui uma única lista canônica em `src/lib/cartola/scouts.ts`. `DE` significa **defesa**; nenhum `RB` foi introduzido no contrato histórico.

## Motivo do encerramento

O laboratório foi encerrado porque suas rotas não estavam registradas no router publicado, as versões eram mantidas em paralelo e `src/lib/cartola/api.functions.ts` misturava produto, backtest, auditorias e pesquisa. A remoção reduz o acoplamento e deixa espaço para uma arquitetura futura com dados históricos, engenharia de features, disponibilidade/minutos, expected points, optimizer e explicação por IA, sem implementar esses componentes nesta etapa.
