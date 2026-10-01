import { useCallback, useEffect, useState } from "react";
import { api, type ModelMeta, type Sign } from "./api";
import { useSystem } from "./system";

export function useModels() {
  const { status } = useSystem();
  const [models, setModels] = useState<ModelMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      setModels(await api.models());
    } finally {
      setLoading(false);
    }
  }, []);
  // Refresh when the number of models or the active one changes (e.g. a training job finished).
  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload, status?.models, status?.active_model.id]);
  return { models, loading, reload };
}

export function useDataset() {
  const [signs, setSigns] = useState<Sign[]>([]);
  const reload = useCallback(async () => {
    setSigns(await api.dataset());
  }, []);
  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);
  return { signs, setSigns, reload };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
