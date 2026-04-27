import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Cartola IA — Insights inteligentes pra sua escalação" },
      {
        name: "description",
        content:
          "Análise em tempo real do mercado do Cartola FC com IA: escalação ótima, comparação de jogadores e capitão da rodada.",
      },
      { name: "author", content: "Cartola IA" },
      { property: "og:title", content: "Cartola IA — Insights inteligentes pra sua escalação" },
      {
        property: "og:description",
        content: "IA que monta sua escalação ótima do Cartola FC com base nos dados ao vivo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "Cartola IA — Insights inteligentes pra sua escalação" },
      { name: "description", content: "Cartola AI Insights provides AI-driven recommendations for optimal fantasy football team lineups." },
      { property: "og:description", content: "Cartola AI Insights provides AI-driven recommendations for optimal fantasy football team lineups." },
      { name: "twitter:description", content: "Cartola AI Insights provides AI-driven recommendations for optimal fantasy football team lineups." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/f2f284a9-5db9-4065-80b8-7e2acfe40634/id-preview-4e3f5a54--162a7dd6-91d2-4f74-999a-4d954cc80255.lovable.app-1777318758260.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/f2f284a9-5db9-4065-80b8-7e2acfe40634/id-preview-4e3f5a54--162a7dd6-91d2-4f74-999a-4d954cc80255.lovable.app-1777318758260.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster />
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return <Outlet />;
}
