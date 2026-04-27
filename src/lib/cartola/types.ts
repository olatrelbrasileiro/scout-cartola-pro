export type Posicao = {
  id: number;
  nome: string;
  abreviacao: string;
};

export type Clube = {
  id: number;
  nome: string;
  abreviacao: string;
  escudos?: Record<string, string>;
};

export type Atleta = {
  atleta_id: number;
  apelido: string;
  apelido_abreviado?: string;
  foto?: string | null;
  posicao_id: number;
  clube_id: number;
  status_id: number;
  preco_num: number;
  variacao_num: number;
  media_num: number;
  pontos_num: number;
  jogos_num: number;
  scout?: Record<string, number>;
  minimo_para_valorizar?: number;
};

export type MercadoStatus = {
  rodada_atual: number;
  status_mercado: number; // 1 = aberto, 2 = fechado
  fechamento?: { dia: number; mes: number; ano: number; hora: number; minuto: number };
  times_escalados: number;
  game_over?: boolean;
  mercado_pos_rodada?: boolean;
};

export type Partida = {
  partida_id: number;
  clube_casa_id: number;
  clube_visitante_id: number;
  partida_data: string;
  local: string;
  valida: boolean;
  clube_casa_posicao?: number;
  clube_visitante_posicao?: number;
  placar_oficial_mandante?: number;
  placar_oficial_visitante?: number;
};

export type AtletaPontuado = {
  apelido: string;
  pontuacao: number;
  scout: Record<string, number>;
  posicao_id: number;
  clube_id: number;
  entrou_em_campo: boolean;
};

export const STATUS_MAP: Record<number, { label: string; color: string }> = {
  2: { label: "Dúvida", color: "warning" },
  3: { label: "Suspenso", color: "destructive" },
  5: { label: "Contundido", color: "destructive" },
  6: { label: "Nulo", color: "muted" },
  7: { label: "Provável", color: "success" },
};

export const POSICAO_ABREV: Record<number, string> = {
  1: "GOL",
  2: "LAT",
  3: "ZAG",
  4: "MEI",
  5: "ATA",
  6: "TEC",
};

export const POSICAO_NOME: Record<number, string> = {
  1: "Goleiro",
  2: "Lateral",
  3: "Zagueiro",
  4: "Meia",
  5: "Atacante",
  6: "Técnico",
};

export type MercadoData = {
  atletas: Atleta[];
  clubes: Record<string, Clube>;
  posicoes: Record<string, Posicao>;
  status: Record<string, { id: number; nome: string }>;
};

export type DashboardSnapshot = {
  mercado: MercadoStatus;
  data: MercadoData;
  partidas: Partida[];
};