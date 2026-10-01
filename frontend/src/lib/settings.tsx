import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export interface Settings {
  theme: "system" | "light" | "dark";
  threshold: number;
  stability: number;
  showLandmarks: boolean;
  requireHands: boolean;
  showFace: boolean;
  mirror: boolean;
  frameWidth: number;
  jpegQuality: number;
  cameraId: string;
  countdown: number;
  pauseBetweenClips: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  threshold: 0.8,
  stability: 5,
  showLandmarks: true,
  requireHands: true,
  showFace: true,
  mirror: true,
  frameWidth: 480,
  jpegQuality: 0.7,
  cameraId: "",
  countdown: 3,
  pauseBetweenClips: 1.5,
};

const KEY = "signia.settings.v2";

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

interface Ctx {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable */
    }
    const root = document.documentElement;
    if (settings.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", settings.theme);
  }, [settings]);

  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));
  const reset = () => setSettings(DEFAULT_SETTINGS);
  return <SettingsContext.Provider value={{ settings, update, reset }}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
