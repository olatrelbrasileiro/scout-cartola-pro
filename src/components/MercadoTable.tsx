import { useMemo, useState } from "react";
import { ArrowUpDown, Search, TrendingDown, TrendingUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { PlayerSilhouette } from "@/components/PlayerSilhouette";
import { PlayerModal } from "@/components/PlayerModal";
import type { AtletaComScore, Clube, Partida } from "@/lib/cartola/types";
import { POSICAO_ABREV, STATUS_MAP } from "@/lib/cartola/types";
import { adversarioMap } from "@/lib/cartola/scoring";

type SortKey = "score_ia" | "preco_num" | "media_num" | "pontos_num" | "variacao_num" | "apelido";

function statusVariant(id: number): "default" | "secondary" | "destructive" | "outline" {
  if (id === 7) return "default";
  if (id === 2) return "secondary";
  if (id === 3 || id === 5) return "destructive";
  return "outline";
}

type RodadaRow = { rodada: number; pontuacao: number; jogou: boolean };
type HistEntry = { rodadas: RodadaRow[] };

export type MercadoData = {
  atletas: AtletaComScore[];
  clubes: Record<string, Clube>;
  partidas: Partida[];
  historico: Record<string, HistEntry>;
  formaClube: Record<string, number>;
  rodadasAnalisadas: number[];
};

export function MercadoTable({
  data,
  selectable,
  selected,
  onToggleSelect,
}: {
  data: MercadoData;
  selectable?: boolean;
  selected?: number[];
  onToggleSelect?: (a: AtletaComScore) => void;
}) {
  const [busca, setBusca] = useState("");
  const [posicao, setPosicao] = useState("all");
  const [statusFiltro, setStatusFiltro] = useState("ativos");
  const [clube, setClube] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("score_ia");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [aberto, setAberto] = useState<AtletaComScore | null>(null);

  const adv = useMemo(() => adversarioMap(data.partidas), [data.partidas]);

  const filtered = useMemo(() => {
    let arr = data.atletas.filter((a) => a.preco_num > 0);
    if (statusFiltro === "ativos") arr = arr.filter((a) => [2, 7].includes(a.status_id));
    else if (statusFiltro !== "all") arr = arr.filter((a) => a.status_id === Number(statusFiltro));
    if (posicao !== "all") arr = arr.filter((a) => a.posicao_id === Number(posicao));
    if (clube !== "all") arr = arr.filter((a) => a.clube_id === Number(clube));
    if (busca.trim()) {
      const q = busca.trim().toLowerCase();
      arr = arr.filter((a) => a.apelido.toLowerCase().includes(q));
    }
    arr = [...arr].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (typeof va === "string" && typeof vb === "string") {
        return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return sortDir === "asc" ? Number(va) - Number(vb) : Number(vb) - Number(va);
    });
    return arr;
  }, [data, busca, posicao, statusFiltro, clube, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "apelido" ? "asc" : "desc");
    }
  };

  const SortBtn = ({ k, label, align }: { k: SortKey; label: string; align?: "right" }) => (
    <button
      onClick={() => toggleSort(k)}
      className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground ${
        align === "right" ? "ml-auto" : ""
      } ${sortKey === k ? "text-foreground" : ""}`}
    >
      {label}
      <ArrowUpDown className="h-3 w-3" />
    </button>
  );

  return (
    <>
      <div className="rounded-xl border border-border/60 bg-card shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-3">
          <div className="relative min-w-[180px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar jogador…"
              className="pl-8"
            />
          </div>
          <Select value={posicao} onValueChange={setPosicao}>
            <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Posição</SelectItem>
              {Object.entries(POSICAO_ABREV).filter(([id]) => id !== "6").map(([id, ab]) => (
                <SelectItem key={id} value={id}>{ab}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFiltro} onValueChange={setStatusFiltro}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ativos">Prováveis + dúvidas</SelectItem>
              <SelectItem value="7">Só prováveis</SelectItem>
              <SelectItem value="2">Só dúvidas</SelectItem>
              <SelectItem value="all">Todos</SelectItem>
            </SelectContent>
          </Select>
          <Select value={clube} onValueChange={setClube}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Clube" /></SelectTrigger>
            <SelectContent className="max-h-[300px]">
              <SelectItem value="all">Todos os clubes</SelectItem>
              {Object.values(data.clubes)
                .sort((a, b) => a.nome.localeCompare(b.nome))
                .map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="border-b border-border/60 text-left">
                {selectable && <th className="w-10 px-2 py-2"></th>}
                <th className="px-3 py-2"><SortBtn k="apelido" label="Jogador" /></th>
                <th className="px-2 py-2 hidden sm:table-cell">Pos</th>
                <th className="px-2 py-2 hidden md:table-cell">Próx.</th>
                <th className="px-2 py-2 text-center"><SortBtn k="score_ia" label="Score IA" /></th>
                <th className="px-2 py-2 text-right"><SortBtn k="preco_num" label="C$" align="right" /></th>
                <th className="px-2 py-2 text-right hidden sm:table-cell"><SortBtn k="variacao_num" label="Var" align="right" /></th>
                <th className="px-2 py-2 text-right"><SortBtn k="media_num" label="Méd" align="right" /></th>
                <th className="px-2 py-2 text-right hidden md:table-cell"><SortBtn k="pontos_num" label="Últ" align="right" /></th>
                <th className="px-2 py-2 hidden sm:table-cell">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const clubeAb = data.clubes[String(a.clube_id)]?.abreviacao ?? "?";
                const ad = adv.get(a.clube_id);
                const advAb = ad ? data.clubes[String(ad.adv_id)]?.abreviacao ?? "?" : null;
                const stat = STATUS_MAP[a.status_id];
                const isSel = selected?.includes(a.atleta_id);
                const scoreColor =
                  a.score_ia >= 75 ? "text-success" : a.score_ia >= 55 ? "text-foreground" : "text-muted-foreground";
                const varPositiva = a.variacao_num > 0;
                return (
                  <tr
                    key={a.atleta_id}
                    onClick={() => !selectable && setAberto(a)}
                    className={`border-b border-border/40 transition-colors hover:bg-muted/40 ${
                      isSel ? "bg-primary/10" : ""
                    } ${!selectable ? "cursor-pointer" : ""}`}
                  >
                    {selectable && (
                      <td className="px-2 py-2">
                        <Button
                          variant={isSel ? "default" : "outline"}
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={(e) => { e.stopPropagation(); onToggleSelect?.(a); }}
                        >
                          {isSel ? "✓" : "+"}
                        </Button>
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <PlayerSilhouette posicao_id={a.posicao_id} size={28} className="text-primary" />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{a.apelido}</div>
                          <div className="text-[10px] uppercase text-muted-foreground">{clubeAb}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2 hidden sm:table-cell">
                      <Badge variant="outline" className="font-mono text-[10px]">{POSICAO_ABREV[a.posicao_id]}</Badge>
                    </td>
                    <td className="px-2 py-2 hidden md:table-cell text-xs">
                      {ad ? (
                        <span className={ad.mando === "casa" ? "text-success" : "text-muted-foreground"}>
                          {ad.mando === "casa" ? "vs " : "@ "}
                          {advAb}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span className={`inline-flex items-center justify-center rounded-md border border-border/60 bg-background px-2 py-0.5 font-mono text-xs font-bold ${scoreColor}`}>
                        {a.score_ia}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-xs">{a.preco_num.toFixed(2)}</td>
                    <td className="px-2 py-2 text-right font-mono text-xs hidden sm:table-cell">
                      <span className={`inline-flex items-center gap-0.5 ${varPositiva ? "text-success" : a.variacao_num < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                        {a.variacao_num !== 0 && (varPositiva ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />)}
                        {a.variacao_num.toFixed(2)}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right font-mono font-semibold">{a.media_num.toFixed(1)}</td>
                    <td className="px-2 py-2 text-right font-mono text-xs hidden md:table-cell">{a.pontos_num.toFixed(1)}</td>
                    <td className="px-2 py-2 hidden sm:table-cell">
                      {stat ? (
                        <Badge variant={statusVariant(a.status_id)} className="text-[10px]">{stat.label}</Badge>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    Nenhum jogador encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border/40 px-3 py-2 text-xs text-muted-foreground">
          {filtered.length} jogadores · Score IA calculado nas últimas {data.rodadasAnalisadas.length} rodadas
        </div>
      </div>

      {aberto && (
        <PlayerModal
          atleta={aberto}
          clube={data.clubes[String(aberto.clube_id)]}
          adversario={(() => {
            const ad = adv.get(aberto.clube_id);
            return ad ? { clube: data.clubes[String(ad.adv_id)], mando: ad.mando } : null;
          })()}
          historicoRodadas={data.historico[String(aberto.atleta_id)]?.rodadas?.map((r) => ({
            rodada: r.rodada,
            pontuacao: r.pontuacao,
            jogou: r.jogou,
          }))}
          onClose={() => setAberto(null)}
        />
      )}
    </>
  );
}
