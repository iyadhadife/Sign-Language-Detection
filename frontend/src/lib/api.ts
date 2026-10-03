export interface Prob {
  label: string;
  p: number;
}

export interface ClassMetrics {
  label: string;
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

export interface Metrics {
  accuracy: number | null;
  samples: number;
  labels: string[];
  confusion_matrix: number[][];
  per_class: ClassMetrics[];
  source: "held-out" | "training" | "dataset";
  evaluated_at: number;
  evaluated_signs?: string[];
}

export interface HistoryPoint {
  epoch: number;
  loss?: number;
  categorical_accuracy?: number;
  val_loss?: number;
  val_categorical_accuracy?: number;
}

export interface ModelMeta {
  id: string;
  name: string;
  labels: string[];
  created_at: number | null;
  builtin: boolean;
  description: string;
  metrics: Metrics | null;
  history: HistoryPoint[] | null;
  params: Record<string, number | boolean> | null;
  active: boolean;
}

export interface Sign {
  name: string;
  slug: string;
  samples: number;
  updated_at: number;
}

export type JobState = "pending" | "preparing" | "training" | "evaluating" | "completed" | "failed" | "cancelled";

export interface TrainingJob {
  id: string;
  name: string;
  signs: string[];
  epochs: number;
  use_pretrained: boolean;
  augment: boolean;
  test_fraction: number;
  state: JobState;
  message: string;
  epoch: number;
  history: HistoryPoint[];
  started_at: number;
  finished_at: number | null;
  model_id: string | null;
  metrics: Metrics | null;
}

export interface SystemStatus {
  device: string;
  cpu_count: number;
  platform: string;
  python: string;
  tensorflow: string;
  mediapipe: string;
  model_complexity: number;
  sequence_length: number;
  active_model: ModelMeta;
  models: number;
  dataset: { signs: number; samples: number };
  training: TrainingJob | null;
  uptime_s: number;
}

export const isJobRunning = (job: TrainingJob | null | undefined) =>
  !!job && ["pending", "preparing", "training", "evaluating"].includes(job.state);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* keep status text */
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  status: () => request<SystemStatus>("/api/status"),
  models: () => request<ModelMeta[]>("/api/models"),
  model: (id: string) => request<ModelMeta>(`/api/models/${encodeURIComponent(id)}`),
  activate: (id: string) => request<ModelMeta>(`/api/models/${encodeURIComponent(id)}/activate`, json("POST")),
  deleteModel: (id: string) => request<{ ok: boolean }>(`/api/models/${encodeURIComponent(id)}`, json("DELETE")),
  evaluate: (id: string) => request<Metrics>(`/api/models/${encodeURIComponent(id)}/evaluate`, json("POST")),
  dataset: () => request<Sign[]>("/api/dataset"),
  deleteSign: (name: string) => request<{ ok: boolean }>(`/api/dataset/${encodeURIComponent(name)}`, json("DELETE")),
  deleteLastSample: (name: string) =>
    request<{ samples: number }>(`/api/dataset/${encodeURIComponent(name)}/last`, json("DELETE")),
  startTraining: (body: {
    name: string;
    signs: string[];
    epochs: number;
    use_pretrained: boolean;
    augment: boolean;
    test_fraction: number;
  }) => request<TrainingJob>("/api/training/start", json("POST", body)),
  trainingStatus: () => request<TrainingJob | null>("/api/training/status"),
  cancelTraining: () => request<TrainingJob | null>("/api/training/cancel", json("POST")),
  feedback: (form: FormData) => request<{ ok: boolean }>("/api/feedback", { method: "POST", body: form }),
};
