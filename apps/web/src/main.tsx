import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "./components/ui";
import { App } from "./App";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/sora";
import "./index.css";
import { installPointerEffects } from "./lib/pointer";

installPointerEffects();

const qc = new QueryClient({ defaultOptions: { queries: { retry: (n, e: any) => n < 2 && (e?.status ?? 500) >= 500, refetchOnWindowFocus: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
