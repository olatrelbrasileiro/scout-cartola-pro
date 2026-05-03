import { cn } from "@/lib/utils";

type Props = {
  posicao_id: number;
  className?: string;
  size?: number;
};

/**
 * Silhueta neutra de jogador (sem foto real). Goleiro tem camisa diferente.
 */
export function PlayerSilhouette({ posicao_id, className, size = 40 }: Props) {
  const isGol = posicao_id === 1;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <path
        d={
          isGol
            ? "M10 32 L18 18 L24 12 L40 12 L46 18 L54 32 L48 38 L44 34 L44 56 L20 56 L20 34 L16 38 Z"
            : "M10 38 L20 20 L26 16 L38 16 L44 20 L54 38 L46 44 L42 38 L42 56 L22 56 L22 38 L18 44 Z"
        }
        fill="currentColor"
        opacity="0.9"
      />
      <circle cx="32" cy="10" r="6" fill="currentColor" opacity="0.75" />
    </svg>
  );
}
