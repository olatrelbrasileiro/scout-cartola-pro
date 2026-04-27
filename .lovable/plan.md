## Cartola IA — Dashboard com insights inteligentes

App que consome a API pública do Cartola FC e usa IA para sugerir escalações ótimas, comparar jogadores e indicar o melhor capitão da rodada.

### Fontes de dados (API pública do Cartola — sem login)

Identificadas no `main.js` que você enviou. Todas em `https://api.cartola.globo.com`:

- `/mercado/status` — rodada atual, status do mercado (aberto/fechado), prazo
- `/atletas/mercado` — todos os jogadores com preço (cartoletas), média, scout, status, posição, clube
- `/atletas/pontuados/{rodada}` — pontuação dos jogadores numa rodada passada (histórico)
- `/clubes` e `/partidas/{rodada}` — confrontos, mando de campo
- `/posicoes` — mapa id → posição (gol, lat, zag, mei, ata, tec)

### Telas

**1. Home / Dashboard (rota `/`)**
- Header com status do mercado: rodada atual, prazo de fechamento, mercado aberto/fechado
- **Painel esquerdo (60%)** — tabela de jogadores com:
  - Filtros: posição, clube, status (provável/dúvida/suspenso/contundido/nulo), faixa de preço
  - Colunas: foto, nome, clube, posição, preço (C$), média, últ. pontuação, status, próximo adversário (mando)
  - Ordenação por qualquer coluna; busca por nome
- **Painel direito (40%)** — chat lateral com a IA, sticky em desktop, drawer no mobile

**2. Comparador (rota `/comparar`)**
- Selecionar 2-4 jogadores e ver lado a lado: histórico de pontos por rodada (mini gráfico), scouts médios, preço/média, próximos adversários
- Botão "Pedir análise da IA" envia o contexto para o chat

**3. Escalação ótima (rota `/escalacao`)**
- Inputs: cartoletas disponíveis, esquema (3-4-3, 4-3-3, 4-4-2, 5-3-2, 5-4-1, 3-5-2), preferências (priorizar mando? evitar dúvidas?)
- Botão "Gerar escalação" → IA devolve os 11 + capitão + reservas + justificativa por escolha

### Funcionalidades de IA (3 modos)

Tudo rodando no Lovable AI Gateway (Gemini 3 Flash por padrão, sem precisar de chave externa):

1. **Escalação ótima** — recebe lista filtrada de jogadores + saldo + esquema, devolve XI estruturado com capitão e justificativa
2. **Comparação de jogadores** — recebe stats de 2+ atletas, devolve recomendação fundamentada
3. **Capitão & mitos da rodada** — analisa a rodada inteira (mando, adversário fraco, scout alto) e sugere capitão + 3-5 jogadores baratos com upside
4. **Chat livre** — perguntas abertas; a IA tem acesso aos dados atuais via system prompt injetado

### Arquitetura técnica

- **Server functions (`createServerFn`)** para todas as chamadas ao Cartola — evita CORS e permite cache curto (60s) em memória
  - `getMercadoStatus()`, `getAtletasMercado()`, `getPartidasRodada(rodada)`, `getPontuadosHistorico(rodada)`
- **Server function `chatComCartola`** que monta system prompt com snapshot dos dados relevantes + chama Lovable AI Gateway com streaming SSE
- **Server function `gerarEscalacao`** com tool calling estruturado (schema JSON) para garantir resposta no formato `{ titular: [...], capitao, reservas, justificativa }`
- **TanStack Query** para cachear dados do Cartola no cliente (staleTime 60s)
- **Rotas**: `/` (dashboard), `/comparar`, `/escalacao` — cada uma com loader que pré-busca dados via server functions

### Stack visual
- shadcn/ui (Card, Table, Dialog, Drawer, Tabs, Slider, Badge para status de jogador)
- Tema escuro com toques verde/amarelo (cara de futebol brasileiro), sem ser cafona
- `react-markdown` para renderizar respostas da IA com formatação

### O que NÃO está incluso (pode pedir depois)
- Login na conta Globo / acesso ao seu time pessoal e ligas privadas (requer token GLB manual — fluxo separado)
- Persistência de escalações geradas (sem banco de dados — pode adicionar via Lovable Cloud depois)
- Notificações por e-mail/push antes do fechamento do mercado
