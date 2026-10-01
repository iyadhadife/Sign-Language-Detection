import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, isJobRunning, type SystemStatus } from "./api";

type Tone = "info" | "success" | "error";

interface Toast {
  id: number;
  tone: Tone;
  text: string;
}

interface Ctx {
  status: SystemStatus | null;
  online: boolean;
  refresh: () => Promise<void>;
  notify: (text: string, tone?: Tone) => void;
}

const SystemContext = createContext<Ctx | null>(null);

/** Polls the backend status (faster while a training job runs) and hosts toast notifications. */
export function SystemProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [online, setOnline] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.status());
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, []);

  const training = isJobRunning(status?.training);
  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, training ? 1000 : 4000);
    return () => window.clearInterval(t);
  }, [refresh, training]);

  const notify = useCallback((text: string, tone: Tone = "info") => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, tone, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  return (
    <SystemContext.Provider value={{ status, online, refresh, notify }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </SystemContext.Provider>
  );
}

export function useSystem() {
  const ctx = useContext(SystemContext);
  if (!ctx) throw new Error("useSystem must be used inside SystemProvider");
  return ctx;
}
