import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CameraStage } from "../components/CameraStage";
import { ConfusionMatrix, PerClassTable, ProbabilityBars, TrainingChart } from "../components/charts";
import { Icon } from "../components/Icon";
import { useFocusMode } from "../components/Layout";
import { Badge, Card, Empty, PageHeader, Segmented, Stat, formatDate, pct } from "../components/ui";
import { api, type Metrics, type ModelMeta } from "../lib/api";
import { sleep, useModels } from "../lib/hooks";
import { useSettings } from "../lib/settings";
import { useSystem } from "../lib/system";
import { useCamera } from "../lib/useCamera";
import { useVision, type ServerMessage, type TrialResult } from "../lib/useVision";

type Tab = "interactive" | "report";

export default function Test() {
  const [params, setParams] = useSearchParams();
  const { status } = useSystem();
  const { models } = useModels();
  const { focus, setFocus } = useFocusMode();
  const [tab, setTab] = useState<Tab>("interactive");
  const modelId = params.get("model") || status?.active_model.id || "";
  const model = models.find((m) => m.id === modelId);

  return (
    <div className="page">
      {!focus && (
        <PageHeader
          eyebrow="Workflow 3 · Evaluation"
          title="Test & Evaluate"
          subtitle="Check how well a model recognises each sign: run a guided live test with your webcam, or review its evaluation report."
          actions={
            <>
              <select className="select" value={modelId} onChange={(e) => setParams({ model: e.target.value })} aria-label="Model">
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.labels.length} signs)
                  </option>
                ))}
              </select>
              {tab === "interactive" && (
                <button className="btn" onClick={() => setFocus(true)} title="Presentation mode (F)">
                  <Icon name="focus" size={15} /> Presentation mode
                </button>
              )}
            </>
          }
        />
      )}
      {!focus && (
        <div className="tabs">
          <button className={tab === "interactive" ? "active" : ""} onClick={() => setTab("interactive")}>
            <Icon name="live" size={16} /> Interactive test
          </button>
          <button className={tab === "report" ? "active" : ""} onClick={() => setTab("report")}>
            <Icon name="test" size={16} /> Evaluation report
          </button>
        </div>
      )}
      {!model ? (
        <Card>
          <Empty icon="models" title="Loading model…" />
        </Card>
      ) : tab === "interactive" ? (
        <InteractiveTest key={model.id} model={model} />
      ) : (
        <Report key={model.id} model={model} />
      )}
    </div>
  );
}

// --------------------------------------------------------------------------------------------
interface Trial extends TrialResult {
  id: number;
  correct: boolean | null;
}

type Phase = "idle" | "prompt" | "recording" | "result";

function InteractiveTest({ model }: { model: ModelMeta }) {
  const { settings } = useSettings();
  const { notify } = useSystem();
  const [cameraOn, setCameraOn] = useState(true);
  const camera = useCamera(cameraOn, settings.cameraId);
  const [mode, setMode] = useState<"random" | "fixed" | "free">("random");
  const [fixedSign, setFixedSign] = useState(model.labels[0]);
  const [rounds, setRounds] = useState(10);
  const [phase, setPhase] = useState<Phase>("idle");
  const [count, setCount] = useState(0);
  const [target, setTarget] = useState<string | null>(null);
  const [trials, setTrials] = useState<Trial[]>([]);
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);
  const pending = useRef<((r: TrialResult | null) => void) | null>(null);

  const onMessage = (msg: ServerMessage) => {
    if (msg.type === "trial_result") pending.current?.(msg);
    if (msg.type === "error") {
      notify(msg.message, "error");
      pending.current?.(null);
    }
  };
  const vision = useVision({ videoRef: camera.videoRef, active: camera.state === "ready", onMessage });
  const ready = camera.state === "ready" && vision.socketState === "open";
  const last = trials[trials.length - 1];

  const runTrial = (expected: string | null) =>
    new Promise<TrialResult | null>((resolve) => {
      const timer = window.setTimeout(() => done(null), 30000);
      const done = (r: TrialResult | null) => {
        window.clearTimeout(timer);
        pending.current = null;
        resolve(r);
      };
      pending.current = done;
      if (!vision.send({ type: "record", purpose: "predict", model_id: model.id, expected })) done(null);
    });

  // Shuffled deck so every sign appears evenly in random mode.
  const deck = useRef<string[]>([]);
  const nextTarget = () => {
    if (mode === "free") return null;
    if (mode === "fixed") return fixedSign;
    if (!deck.current.length) deck.current = [...model.labels].sort(() => Math.random() - 0.5);
    return deck.current.pop()!;
  };

  const start = async () => {
    stopRef.current = false;
    setRunning(true);
    for (let i = 0; i < rounds && !stopRef.current; i++) {
      const t = nextTarget();
      setTarget(t);
      setPhase("prompt");
      for (let c = settings.countdown; c > 0 && !stopRef.current; c--) {
        setCount(c);
        await sleep(1000);
      }
      if (stopRef.current) break;
      setPhase("recording");
      const result = await runTrial(t);
      if (!result) break;
      if (result.hands_ratio < 0.1) {
        notify("No hands detected in that clip — the round was not scored.", "error");
        setPhase("idle");
        i--;
        await sleep(800);
        continue;
      }
      setTrials((list) => [
        ...list,
        { ...result, id: Date.now(), correct: t == null ? null : result.prediction === t },
      ]);
      setPhase("result");
      await sleep(1800);
    }
    setPhase("idle");
    setTarget(null);
    setRunning(false);
  };

  const stop = () => {
    stopRef.current = true;
    if (pending.current) {
      vision.send({ type: "cancel_record" });
      pending.current(null);
    }
  };
  useEffect(() => () => void (stopRef.current = true), []);

  const scored = trials.filter((t) => t.correct !== null);
  const correct = scored.filter((t) => t.correct).length;
  const avgConf = trials.length ? trials.reduce((a, t) => a + t.confidence, 0) / trials.length : null;
  const avgMs = trials.length ? trials.reduce((a, t) => a + t.model_ms, 0) / trials.length : null;

  const sessionMetrics = useMemo<Metrics | null>(() => {
    if (!scored.length) return null;
    const labels = model.labels;
    const idx = new Map(labels.map((l, i) => [l, i]));
    const cm = labels.map(() => labels.map(() => 0));
    for (const t of scored) cm[idx.get(t.expected!)!][idx.get(t.prediction)!]++;
    return {
      accuracy: correct / scored.length,
      samples: scored.length,
      labels,
      confusion_matrix: cm,
      per_class: [],
      source: "dataset",
      evaluated_at: Date.now() / 1000,
    };
  }, [scored, correct, model.labels]);

  const recording = vision.frame?.recording;

  return (
    <div className="two-col">
      <div className="col-main stack">
        <CameraStage
          videoRef={camera.videoRef}
          aspect={camera.aspect}
          cameraState={camera.state}
          cameraError={camera.error}
          socketState={vision.socketState}
          landmarks={vision.frame?.landmarks ?? null}
          hands={vision.frame?.hands}
          metrics={vision.metrics}
          onStart={() => setCameraOn(true)}
          className={phase === "recording" ? "stage-recording" : ""}
        >
          {phase === "prompt" && (
            <div className="overlay-center">
              <div className="overlay-kicker">{target ? "Please sign" : "Sign anything from the vocabulary"}</div>
              {target && <div className="prompt-word">{target}</div>}
              <div key={count} className="countdown small">{count}</div>
            </div>
          )}
          {phase === "recording" && (
            <div className="overlay-bottom">
              <span className="rec-badge">
                <span className="rec-dot" /> REC
              </span>
              <span>{target ? `Sign “${target}” now` : "Sign now"}</span>
              <div className="progress">
                <div style={{ width: `${((recording?.frame ?? 0) / (recording?.frames ?? 30)) * 100}%` }} />
              </div>
            </div>
          )}
          {phase === "result" && last && (
            <div className="overlay-center">
              <div className={`verdict ${last.correct === false ? "bad" : "good"}`}>
                <Icon name={last.correct === false ? "x" : "check"} size={34} />
              </div>
              <div className="prompt-word">{last.prediction}</div>
              <div className="overlay-kicker">
                {last.correct === null ? "Predicted" : last.correct ? "Correct" : `Expected “${last.expected}”`} · {pct(last.confidence)} confidence
              </div>
            </div>
          )}
        </CameraStage>

        {sessionMetrics && (
          <Card title="Session confusion matrix" icon="test">
            <ConfusionMatrix metrics={sessionMetrics} />
          </Card>
        )}
      </div>

      <div className="col-side stack">
        <Card title="Test setup" icon="settings">
          <div className="field">
            <span className="field-label">Which sign to perform</span>
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: "random", label: "Random" },
                { value: "fixed", label: "Choose" },
                { value: "free", label: "Free" },
              ]}
            />
            <span className="field-hint">
              {mode === "random" && "The app asks for each sign in random order and scores the answers."}
              {mode === "fixed" && "Repeat one sign to check its reliability."}
              {mode === "free" && "Sign anything; each clip is classified without scoring."}
            </span>
          </div>
          {mode === "fixed" && (
            <label className="field">
              <span className="field-label">Sign</span>
              <select className="select" value={fixedSign} disabled={running} onChange={(e) => setFixedSign(e.target.value)}>
                {model.labels.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
          )}
          <div className="field">
            <span className="field-label">Rounds</span>
            <Segmented
              value={rounds}
              onChange={setRounds}
              options={[5, 10, 20, 30].map((n) => ({ value: n, label: String(n) }))}
            />
          </div>
          {running ? (
            <button className="btn btn-danger btn-block btn-lg" onClick={stop}>
              <Icon name="stop" size={15} /> Stop test
            </button>
          ) : (
            <button className="btn btn-primary btn-block btn-lg" disabled={!ready} onClick={start}>
              <Icon name="play" size={15} /> Start test
            </button>
          )}
        </Card>

        <Card
          title="Results"
          icon="sparkle"
          actions={
            trials.length > 0 && !running && (
              <button className="btn btn-ghost btn-sm" onClick={() => setTrials([])}>
                <Icon name="refresh" size={14} /> Reset
              </button>
            )
          }
        >
          <div className="stat-row compact">
            <Stat
              label="Accuracy"
              value={scored.length ? pct(correct / scored.length) : "—"}
              hint={scored.length ? `${correct}/${scored.length} correct` : "No scored trials"}
              tone={scored.length ? (correct / scored.length >= 0.8 ? "good" : correct / scored.length >= 0.5 ? "warn" : "bad") : undefined}
            />
            <Stat label="Confidence" value={pct(avgConf)} hint={`${trials.length} trials`} />
            <Stat label="Model time" value={avgMs != null ? `${avgMs.toFixed(1)} ms` : "—"} hint="per clip, CPU" />
          </div>
          {last && (
            <div className="last-trial">
              <div className="small muted">Last prediction</div>
              <ProbabilityBars items={last.probabilities} limit={3} highlight={last.expected ?? last.prediction} />
            </div>
          )}
          {trials.length > 0 && (
            <ol className="trial-list">
              {[...trials].reverse().map((t) => (
                <li key={t.id}>
                  <span className={`trial-mark ${t.correct === null ? "" : t.correct ? "good" : "bad"}`}>
                    <Icon name={t.correct === false ? "x" : t.correct ? "check" : "hand"} size={12} />
                  </span>
                  <span className="truncate">
                    {t.expected && t.expected !== t.prediction && <span className="muted">{t.expected} → </span>}
                    <strong>{t.prediction}</strong>
                  </span>
                  <span className="mono muted">{pct(t.confidence)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------------------------
function Report({ model }: { model: ModelMeta }) {
  const { notify } = useSystem();
  const [source, setSource] = useState<"training" | "dataset">(model.metrics ? "training" : "dataset");
  const [datasetMetrics, setDatasetMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);

  const evaluate = async () => {
    setLoading(true);
    try {
      setDatasetMetrics(await api.evaluate(model.id));
      setSource("dataset");
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  };

  const metrics = source === "training" ? model.metrics : datasetMetrics;
  const params = model.params;

  return (
    <div className="stack">
      <Card
        title={model.name}
        icon="models"
        actions={
          <>
            <Segmented
              value={source}
              onChange={setSource}
              options={[
                { value: "training", label: "Training report" },
                { value: "dataset", label: "Recorded dataset" },
              ]}
            />
            <button className="btn btn-primary btn-sm" onClick={evaluate} disabled={loading}>
              {loading ? <span className="spinner xs" /> : <Icon name="refresh" size={14} />} Evaluate on dataset
            </button>
          </>
        }
      >
        <p className="muted small">
          {model.description} {model.created_at && `Created ${formatDate(model.created_at)}.`}
          {params && ` ${params.train_samples} training clips, ${params.test_samples} held-out clips, ${params.epochs} epochs${params.use_pretrained ? ", transfer learning" : ""}${params.augment ? ", augmentation" : ""}.`}
        </p>
        {!metrics ? (
          <Empty icon="test" title={source === "training" ? "No training report for this model" : "Not evaluated yet"}>
            {source === "training"
              ? "The built-in model was trained outside the app. Record clips whose names match its signs (e.g. “Hello”), then press Evaluate on dataset."
              : "Press Evaluate on dataset to score this model on every recorded clip whose sign name matches one of its labels."}
          </Empty>
        ) : (
          <>
            <div className="stat-row">
              <Stat
                label="Accuracy"
                value={pct(metrics.accuracy, 1)}
                tone={metrics.accuracy == null ? undefined : metrics.accuracy >= 0.85 ? "good" : metrics.accuracy >= 0.6 ? "warn" : "bad"}
                hint={metrics.source === "held-out" ? "on held-out clips" : metrics.source === "training" ? "on training clips" : "on recorded dataset"}
              />
              <Stat label="Clips evaluated" value={metrics.samples} />
              <Stat label="Signs" value={metrics.evaluated_signs?.length ?? metrics.labels.length} hint={`of ${model.labels.length} in the model`} />
              <Stat label="Evaluated" value={<span className="small">{formatDate(metrics.evaluated_at)}</span>} />
            </div>
            {metrics.source === "dataset" && source === "dataset" && (
              <p className="field-hint">
                <Badge tone="warn">Note</Badge> The recorded dataset includes clips used for training, so this score is optimistic for trained models.
              </p>
            )}
          </>
        )}
      </Card>

      {metrics && (
        <div className="grid-2">
          <Card title="Confusion matrix" icon="test">
            <ConfusionMatrix metrics={metrics} />
          </Card>
          <Card title="Per-sign metrics" icon="sparkle">
            <PerClassTable metrics={metrics} />
          </Card>
        </div>
      )}

      {source === "training" && model.history && model.history.length > 0 && (
        <Card title="Training curves" icon="train">
          <div className="chart-grid">
            <TrainingChart history={model.history} kind="accuracy" />
            <TrainingChart history={model.history} kind="loss" />
          </div>
        </Card>
      )}
    </div>
  );
}
