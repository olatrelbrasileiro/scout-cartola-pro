import { Clock, CircleDot, CircleDashed } from "lucide-react";
import type { MercadoStatus } from "@/lib/cartola/types";

function formatPrazo(s: MercadoStatus): string | null {
  if (!s.fechamento) return null;
  const f = s.fechamento;
  const d = new Date(f.ano, f.mes - 1, f.dia, f.hora, f.minuto);
  return d.toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MercadoStatusBar({ status }: { status: MercadoStatus }) {
  const aberto = status.status_mercado === 1;
  const prazo = formatPrazo(status);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2">
        {aberto ? (
          <CircleDot className="h-4 w-4 text-success" />
        ) : (
          <CircleDashed className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="text-sm font-medium">
          Mercado {aberto ? "aberto" : "fechado"}
        </span>
      </div>
      <div className="h-4 w-px bg-border" />
      <div className="text-sm">
        <span className="text-muted-foreground">Rodada </span>
        <span className="font-bold text-secondary">#{status.rodada_atual}</span>
      </div>
      {prazo && (
        <>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2 text-sm">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Fechamento:</span>
            <span className="font-medium">{prazo}</span>
          </div>
        </>
      )}
      {typeof status.times_escalados === "number" && (
        <>
          <div className="h-4 w-px bg-border" />
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {status.times_escalados.toLocaleString("pt-BR")}
            </span>{" "}
            times escalados
          </div>
        </>
      )}
    </div>
  );
}