import { Crown, X, TrendingDown, TrendingUp } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { PlayerSilhouette } from "@/components/PlayerSilhouette";
import type { AtletaComScore, Clube } from "@/lib/cartola/types";
import { POSICAO_NOME, STATUS_MAP } from "@/lib/cartola/types";

type Props = {
  atleta: AtletaComScore;
  clube?: Clube;
  adversario: { clube?: Clube; mando: "casa" | "fora" } | null;
  historicoRodadas?: { rodada: number; pontuacao: number; jogou: boolean }[];
  onClose: () => void;
};

const SCOUT_LABELS: Record<string, string> = {
  G: "Gol", A: "Assistência", FT: "Fin. trave", FD: "Fin. defendida",
  FF: "Fin. fora", FS: "Falta sofrida", PE: "Passe errado", PI: "Impedimento",
  I: "Interceptação", RB: "Roubo de bola", SG: "Sem sofrer gol",
  DE: "Defesa", DP: "Def. pênalti", DS: "Desarme", PS: "Pênalti sofrido",
  GS: "Gol sofrido", FC: "Falta cometida", GC: "Gol contra",
  CA: "Cartão amar.", CV: "Cartão verm.", PC: "Pênalti com.",
};

export function PlayerModal({ atleta, clube, adversario, historicoRodadas, onClose }: Props) {
  const stat = STATUS_MAP[atleta.status_id];
  const escudo = clube?.escudos?.["60x60"] ?? clube?.escudos?.["45x45"];
  const escudoAdv = adversario?.clube?.escudos?.["60x60"] ?? adversario?.clube?.escudos?.["45x45"];
  const fatores = atleta.fatores;

  const chartData = (historicoRodadas ?? []).map((r) => ({
    rodada: `R${r.rodada}`,
    pts: r.jogou ? r.pontuacao : null,
  }));

  const scouts = Object.entries(atleta.scout ?? {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  const fatoresArr: { label: string; value: number }[] = [
    { label: "Histórico", value: fatores.historico },
    { label: "Momento", value: fatores.momento },
    { label: "Méd. básica", value: fatores.media_basica },
    { label: "Forma do time", value: fatores.time },
    { label: "Confronto", value: fatores.confronto },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fade-in-up"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-full bg-background/80 p-1.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        {/* HEADER */}
        <div className="bg-[image:var(--gradient-cta)] p-5 text-primary-foreground">
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-background/15 backdrop-blur">
              <PlayerSilhouette posicao_id={atleta.posicao_id} size={64} className="text-primary-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {escudo && <img src={escudo} alt="" className="h-6 w-6" />}
                <span className="text-xs uppercase tracking-widest opacity-90">{clube?.nome}</span>
              </div>
              <h2 className="truncate text-2xl font-bold">{atleta.apelido}</h2>
              <div className="mt-1 flex items-center gap-2 text-xs opacity-90">
                <span>{POSICAO_NOME[atleta.posicao_id]}</span>
                <span>·</span>
                <span className="font-mono">C$ {atleta.preco_num.toFixed(2)}</span>
                <span>·</span>
                <span className="inline-flex items-center gap-0.5">
                  {atleta.variacao_num > 0 ? <TrendingUp className="h-3 w-3" /> : atleta.variacao_num < 0 ? <TrendingDown className="h-3 w-3" /> : null}
                  {atleta.variacao_num.toFixed(2)}
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-widest opacity-80">Score IA</div>
              <div className="font-mono text-4xl font-bold leading-none">{atleta.score_ia}</div>
            </div>
          </div>

          {/* CONFRONTO */}
          {adversario?.clube && (
            <div className="mt-4 flex items-center justify-center gap-3 rounded-lg bg-background/15 p-2 backdrop-blur">
              <div className="flex items-center gap-2">
                {escudo && <img src={escudo} alt="" className="h-7 w-7" />}
                <span className="text-sm font-bold">{clube?.abreviacao}</span>
              </div>
              <span className="text-xs opacity-80">{adversario.mando === "casa" ? "casa" : "fora"} ×</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold">{adversario.clube.abreviacao}</span>
                {escudoAdv && <img src={escudoAdv} alt="" className="h-7 w-7" />}
              </div>
            </div>
          )}
        </div>

        {/* BODY */}
        <div className="space-y-5 p-5">
          {/* Stats */}
          <div className="grid grid-cols-4 gap-2 text-center">
            <Stat label="Média" value={atleta.media_num.toFixed(1)} />
            <Stat label="Última" value={atleta.pontos_num.toFixed(1)} />
            <Stat label="Jogos" value={String(atleta.jogos_num)} />
            <Stat label="Status">
              {stat ? <Badge variant="outline" className="text-[10px]">{stat.label}</Badge> : "—"}
            </Stat>
          </div>

          {/* Fatores IA */}
          <section>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Fatores do Score IA
            </h3>
            <div className="space-y-1.5">
              {fatoresArr.map((f) => (
                <div key={f.label} className="flex items-center gap-2">
                  <span className="w-28 text-xs text-muted-foreground">{f.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-[image:var(--gradient-cta)]"
                      style={{ width: `${f.value}%` }}
                    />
                  </div>
                  <span className="w-8 text-right font-mono text-xs">{f.value}</span>
                </div>
              ))}
              <div className="flex items-center gap-2 pt-1">
                <span className="w-28 text-xs text-muted-foreground">Atuou na última</span>
                <Badge variant={fatores.atuou_ultima ? "default" : "outline"} className="text-[10px]">
                  {fatores.atuou_ultima ? "Sim" : "Não"}
                </Badge>
              </div>
            </div>
          </section>

          {/* Gráfico */}
          {chartData.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Pontuação por rodada
              </h3>
              <div className="h-44 rounded-lg border border-border/60 bg-muted/30 p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="rodada" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        fontSize: 12,
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="pts"
                      stroke="var(--color-primary)"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* Scouts */}
          {scouts.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Scouts da temporada
              </h3>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {scouts.map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-xs">
                    <span className="text-muted-foreground">{SCOUT_LABELS[k] ?? k}</span>
                    <span className="font-mono font-bold">{v}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {atleta.minimo_para_valorizar !== undefined && (
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 p-3 text-xs">
              <span className="text-muted-foreground">Mínimo para valorizar</span>
              <span className="font-mono font-bold">
                {atleta.minimo_para_valorizar.toFixed(2)} pts
                <Crown className="ml-1 inline h-3 w-3 text-warning" />
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-2">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-bold">{value ?? children}</div>
    </div>
  );
}
