import { Crown } from "lucide-react";
import { PlayerSilhouette } from "@/components/PlayerSilhouette";

type Titular = {
  atleta_id: number;
  apelido: string;
  posicao: string; // "Goleiro" | "Lateral" | "Zagueiro" | "Meia" | "Atacante"
  clube: string;
  preco: number;
  score: number;
};

const POS_ID: Record<string, number> = { Goleiro: 1, Lateral: 2, Zagueiro: 3, Meia: 4, Atacante: 5 };

/**
 * Distribui os jogadores em linhas (top→bottom: ATA, MEI, LAT+ZAG, GOL).
 */
export function CampoEscalacao({ titulares, capitao }: { titulares: Titular[]; capitao: number }) {
  const grupos: Record<string, Titular[]> = { Goleiro: [], Lateral: [], Zagueiro: [], Meia: [], Atacante: [] };
  for (const t of titulares) {
    if (grupos[t.posicao]) grupos[t.posicao].push(t);
  }
  // ordem do campo (do gol para o ataque)
  const linhas: { label: string; jogadores: Titular[] }[] = [
    { label: "ATA", jogadores: grupos.Atacante },
    { label: "MEI", jogadores: grupos.Meia },
    { label: "DEF", jogadores: [...grupos.Zagueiro, ...grupos.Lateral] },
    { label: "GOL", jogadores: grupos.Goleiro },
  ];

  return (
    <div className="pitch-bg relative aspect-[3/4] w-full overflow-hidden rounded-2xl border border-border/60 shadow-[var(--shadow-card)] sm:aspect-[4/5]">
      <div className="relative z-10 flex h-full flex-col justify-around p-4">
        {linhas.map((linha) => (
          <div key={linha.label} className="flex items-center justify-around gap-2">
            {linha.jogadores.map((j) => (
              <CardJogador key={j.atleta_id} j={j} isCap={j.atleta_id === capitao} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function CardJogador({ j, isCap }: { j: Titular; isCap: boolean }) {
  return (
    <div className="flex flex-col items-center gap-0.5 text-center">
      <div className="relative">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-background/95 shadow-md ring-2 ring-pitch-line">
          <PlayerSilhouette posicao_id={POS_ID[j.posicao] ?? 4} size={36} className="text-primary" />
        </div>
        {isCap && (
          <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-warning text-[10px] font-bold text-background ring-2 ring-pitch-line">
            <Crown className="h-3 w-3" />
          </div>
        )}
      </div>
      <div className="rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-semibold leading-tight text-foreground shadow-sm">
        {j.apelido}
      </div>
      <div className="text-[9px] font-bold text-pitch-line">
        {j.clube} · {j.score}
      </div>
    </div>
  );
}
