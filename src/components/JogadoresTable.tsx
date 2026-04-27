import { useMemo, useState } from "react";
import { ArrowUpDown, Search } from "lucide-react";
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
import type { Atleta, DashboardSnapshot } from "@/lib/cartola/types";
import { POSICAO_ABREV, STATUS_MAP } from "@/lib/cartola/types";
import { adversarioMap } from "@/lib/ai/prompts";

type SortKey = "preco_num" | "media_num" | "pontos_num" | "apelido";

function statusVariant(id: number): "default" | "secondary" | "destructive" | "outline" {
  if (id === 7) return "default";
  if (id === 2) return "secondary";
  if (id === 3 || id === 5) return "destructive";
  return "outline";
}

export function JogadoresTable({
  snapshot,
  selectable,
  onToggleSelect,
  selected,
  maxRows = 200,
}: {
  snapshot: DashboardSnapshot;
  selectable?: boolean;
  onToggleSelect?: (a: Atleta) => void;
  selected?: number[];
  maxRows?: number;
}) {
  const [busca, setBusca] = useState("");
  const [posicao, setPosicao] = useState<string>("all");
  const [statusFiltro, setStatusFiltro] = useState<string>("ativos");
  const [clube, setClube] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("media_num");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const adv = useMemo(() => adversarioMap(snapshot), [snapshot]);
  const clubes = snapshot.data.clubes;

  const filtered = useMemo(() => {
    let arr = snapshot.data.atletas.filter((a) => a.preco_num > 0);
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
    return arr.slice(0, maxRows);
  }, [snapshot, busca, posicao, statusFiltro, clube, sortKey, sortDir, maxRows]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "apelido" ? "asc" : "desc");
    }
  };

  const SortBtn = ({ k, label, align = "left" }: { k: SortKey; label: string; align?: "left" | "right" }) => (
    <button
      onClick={() => toggleSort(k)}
      className={`flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground ${
        align === "right" ? "ml-auto" : ""
      }`}
    >
      {label}
      <ArrowUpDown className="h-3 w-3" />
    </button>
  );

  return (
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
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ativos">Prováveis + dúvidas</SelectItem>
            <SelectItem value="7">Só prováveis</SelectItem>
            <SelectItem value="2">Só dúvidas</SelectItem>
            <SelectItem value="all">Todos</SelectItem>
          </SelectContent>
        </Select>
        <Select value={clube} onValueChange={setClube}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Clube" /></SelectTrigger>
          <SelectContent className="max-h-[300px]">
            <SelectItem value="all">Todos os clubes</SelectItem>
            {Object.values(clubes)
              .sort((a, b) => a.nome.localeCompare(b.nome))
              .map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 text-left">
              {selectable && <th className="w-10 px-3 py-2"></th>}
              <th className="px-3 py-2"><SortBtn k="apelido" label="Jogador" /></th>
              <th className="px-3 py-2 hidden md:table-cell">Pos</th>
              <th className="px-3 py-2 hidden md:table-cell">Próximo</th>
              <th className="px-3 py-2 text-right"><SortBtn k="preco_num" label="C$" align="right" /></th>
              <th className="px-3 py-2 text-right"><SortBtn k="media_num" label="Média" align="right" /></th>
              <th className="px-3 py-2 text-right hidden sm:table-cell"><SortBtn k="pontos_num" label="Últ" align="right" /></th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => {
              const clubeAb = clubes[String(a.clube_id)]?.abreviacao ?? "?";
              const ad = adv[a.clube_id];
              const stat = STATUS_MAP[a.status_id];
              const isSel = selected?.includes(a.atleta_id);
              return (
                <tr
                  key={a.atleta_id}
                  className={`border-b border-border/40 transition-colors hover:bg-muted/30 ${
                    isSel ? "bg-primary/10" : ""
                  }`}
                >
                  {selectable && (
                    <td className="px-3 py-2">
                      <Button
                        variant={isSel ? "default" : "outline"}
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => onToggleSelect?.(a)}
                      >
                        {isSel ? "✓" : "+"}
                      </Button>
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <div className="font-medium">{a.apelido}</div>
                    <div className="text-xs text-muted-foreground">{clubeAb}</div>
                  </td>
                  <td className="px-3 py-2 hidden md:table-cell">
                    <Badge variant="outline" className="font-mono">{POSICAO_ABREV[a.posicao_id]}</Badge>
                  </td>
                  <td className="px-3 py-2 hidden md:table-cell text-xs">
                    {ad ? (
                      <span>
                        <span className={ad.mando === "casa" ? "text-success" : "text-muted-foreground"}>
                          {ad.mando === "casa" ? "vs " : "@ "}
                        </span>
                        {ad.adv}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{a.preco_num.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-secondary">
                    {a.media_num.toFixed(1)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono hidden sm:table-cell">
                    {a.pontos_num.toFixed(1)}
                  </td>
                  <td className="px-3 py-2">
                    {stat ? (
                      <Badge variant={statusVariant(a.status_id)} className="text-[10px]">
                        {stat.label}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Nenhum jogador encontrado com esses filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border/40 px-3 py-2 text-xs text-muted-foreground">
        Mostrando {filtered.length} jogadores (limite {maxRows})
      </div>
    </div>
  );
}