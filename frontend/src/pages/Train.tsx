import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CameraStage } from "../components/CameraStage";
import { TrainingChart } from "../components/charts";
import { Icon } from "../components/Icon";
import { Badge, Card, Empty, PageHeader, Segmented, Toggle, formatDate, pct } from "../components/ui";
import { api, isJobRunning, type JobState } from "../lib/api";
import { sleep, useDataset } from "../lib/hooks";
import { useSettings } from "../lib/settings";
import { useSystem } from "../lib/system";
import { useCamera } from "../lib/useCamera";
import { useVision, type ServerMessage } from "../lib/useVision";

const MIN_SAMPLES = 5;
const RECOMMENDED = 30;

type Tab = "record" | "train";

export default function Train() {
  const [tab, setTab] = useState<Tab>("record");
  const dataset = useDataset();
  const { status } = useSystem();
  const job = status?.training;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Workflow 2 · Training"
        title="Train New Signs"
        subtitle="Record example clips of each sign with your webcam, then train a new classifier. Training runs in the background on the CPU and never interrupts live prediction."
      />

      <div className="steps">
        <button className={`step ${tab === "record" ? "active" : ""}`} onClick={() => setTab("record")}>
          <span className="step-num">1</span>
          <span>
            <strong>Record samples</strong>
            <small>{dataset.signs.length} signs · {dataset.signs.reduce((a, s) => a + s.samples, 0)} clips</small>
          </span>
        </button>
        <span className="step-line" />
        <button className={`step ${tab === "train" ? "active" : ""}`} onClick={() => setTab("train")}>
          <span className="step-num">2</span>
          <span>
            <strong>Train model</strong>
            <small>{isJobRunning(job) ? `Running · epoch ${job!.epoch}/${job!.epochs}` : "Configure & launch"}</small>
          </span>
        </button>
        <span className="step-line" />
        <Link className="step" to={job?.model_id ? `/test?model=${job.model_id}` : "/test"}>
          <span className="step-num">3</span>
          <span>
            <strong>Test it</strong>
            <small>Evaluate the result</small>
          </span>
        </Link>
      </div>

      {tab === "record" ? (
        <RecordPanel dataset={dataset} onTrain={() => setTab("train")} />
      ) : (
        <TrainPanel dataset={dataset} />
      )}
    </div>
  );
}

// --------------------------------------------------------------------------------------------
type Phase = "idle" | "countdown" | "recording" | "saved";

function RecordPanel({ dataset, onTrain }: { dataset: ReturnType<typeof useDataset>; onTrain: () => void }) {
  const { settings } = useSettings();
  const { notify, refresh } = useSystem();
  const [cameraOn, setCameraOn] = useState(true);
  const camera = useCamera(cameraOn, settings.cameraId);

  const [sign, setSign] = useState("");
  const [target, setTarget] = useState(20);
  const [phase, setPhase] = useState<Phase>("idle");
  const [count, setCount] = useState(0);
  const [done, setDone] = useState(0);
  const [session, setSession] = useState<{ sign: string; total: number } | null>(null);
  const stopRef = useRef(false);
  const pending = useRef<((ok: boolean) => void) | null>(null);
  const warnedHands = useRef(false);

  const onMessage = (msg: ServerMessage) => {
    if (msg.type === "sample_saved") {
      if (msg.hands_ratio < 0.2 && !warnedHands.current) {
        warnedHands.current = true;
        notify("Few or no hands were detected in this clip. Make sure your hands are in frame.", "error");
      }
      dataset.setSigns((list) => {
        const found = list.some((s) => s.name.toLowerCase() === msg.sign.toLowerCase());
        return found
          ? list.map((s) => (s.name.toLowerCase() === msg.sign.toLowerCase() ? { ...s, samples: msg.samples } : s))
          : [...list, { name: msg.sign, slug: msg.sign, samples: msg.samples, updated_at: Date.now() / 1000 }];
      });
      pending.current?.(true);
    }
    if (msg.type === "error") {
      notify(msg.message, "error");
      pending.current?.(false);
    }
  };
  const vision = useVision({ videoRef: camera.videoRef, active: camera.state === "ready", onMessage });
  const recording = vision.frame?.recording;
  const busy = session !== null;
  const ready = camera.state === "ready" && vision.socketState === "open";

  const recordOne = (name: string) =>
    new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => finish(false), 30000);
      const finish = (ok: boolean) => {
        window.clearTimeout(timer);
        pending.current = null;
        resolve(ok);
      };
      pending.current = finish;
      if (!vision.send({ type: "record", purpose: "collect", sign: name })) finish(false);
    });

  const start = async () => {
    const name = sign.trim();
    if (!name) return notify("Enter the name of the sign first.", "error");
    stopRef.current = false;
    warnedHands.current = false;
    setSession({ sign: name, total: target });
    setDone(0);
    let saved = 0;
    for (let i = 0; i < target && !stopRef.current; i++) {
      setPhase("countdown");
      const seconds = i === 0 ? settings.countdown : Math.max(1, Math.round(settings.pauseBetweenClips));
      for (let c = seconds; c > 0 && !stopRef.current; c--) {
        setCount(c);
        await sleep(i === 0 ? 1000 : (settings.pauseBetweenClips * 1000) / seconds);
      }
      if (stopRef.current) break;
      setPhase("recording");
      const ok = await recordOne(name);
      if (!ok) break;
      saved++;
      setDone(saved);
      setPhase("saved");
      await sleep(350);
    }
    setPhase("idle");
    setSession(null);
    refresh();
    if (saved) notify(`Saved ${saved} clip${saved > 1 ? "s" : ""} for “${name}”.`, "success");
  };

  const stop = () => {
    stopRef.current = true;
    if (pending.current) {
      vision.send({ type: "cancel_record" });
      pending.current(false);
    }
  };

  useEffect(() => () => void (stopRef.current = true), []);

  const undo = async (name: string) => {
    try {
      await api.deleteLastSample(name);
      await dataset.reload();
      refresh();
    } catch (e) {
      notify((e as Error).message, "error");
    }
  };
  const remove = async (name: string) => {
    if (!confirm(`Delete all recorded clips for “${name}”?`)) return;
    await api.deleteSign(name);
    await dataset.reload();
    refresh();
    notify(`Deleted “${name}”.`);
  };

  const trainable = dataset.signs.filter((s) => s.samples >= MIN_SAMPLES).length;

  return (
    <div className="two-col">
      <div className="col-main">
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
          {session && phase === "countdown" && (
            <div className="overlay-center">
              <div className="overlay-kicker">
                {done === 0 ? "Get ready" : "Next clip"} · “{session.sign}”
              </div>
              <div key={count} className="countdown">{count}</div>
            </div>
          )}
          {session && phase === "recording" && (
            <div className="overlay-bottom">
              <span className="rec-badge">
                <span className="rec-dot" /> REC
              </span>
              <span>Perform “{session.sign}” now</span>
              <div className="progress">
                <div style={{ width: `${((recording?.frame ?? 0) / (recording?.frames ?? 30)) * 100}%` }} />
              </div>
            </div>
          )}
          {session && phase === "saved" && (
            <div className="overlay-center">
              <div className="saved-check">
                <Icon name="check" size={40} />
              </div>
            </div>
          )}
        </CameraStage>
      </div>

      <div className="col-side">
        <Card title="Recording session" icon="record">
          <label className="field">
            <span className="field-label">Sign name</span>
            <input
              className="input"
              list="known-signs"
              placeholder="e.g. Thank you"
              value={sign}
              maxLength={40}
              disabled={busy}
              onChange={(e) => setSign(e.target.value)}
            />
            <datalist id="known-signs">
              {dataset.signs.map((s) => (
                <option key={s.slug} value={s.name} />
              ))}
            </datalist>
            <span className="field-hint">Use an existing name to add more clips to that sign.</span>
          </label>
          <label className="field">
            <span className="field-label">
              Clips to record <strong className="mono">{target}</strong>
            </span>
            <input type="range" min={5} max={60} step={5} value={target} disabled={busy} onChange={(e) => setTarget(+e.target.value)} />
            <span className="field-hint">Each clip is {30} frames (about 1–2 s). 20–30 clips per sign works well.</span>
          </label>

          {session ? (
            <>
              <div className="session-progress">
                <div className="row-between small">
                  <span>
                    Clip <strong>{Math.min(done + 1, session.total)}</strong> of {session.total}
                  </span>
                  <span className="mono">{pct(done / session.total)}</span>
                </div>
                <div className="progress">
                  <div style={{ width: `${(done / session.total) * 100}%` }} />
                </div>
              </div>
              <button className="btn btn-danger btn-block" onClick={stop}>
                <Icon name="stop" size={15} /> Stop recording
              </button>
            </>
          ) : (
            <button className="btn btn-primary btn-block btn-lg" onClick={start} disabled={!ready || !sign.trim()}>
              <Icon name="record" size={16} /> Start recording
            </button>
          )}
          {!ready && !busy && <p className="field-hint center">Waiting for the camera and server…</p>}

          <ul className="tips">
            <li>Keep your upper body and both hands in frame.</li>
            <li>Vary position, distance and speed slightly between clips.</li>
            <li>Hold still briefly between clips — the countdown gives you time.</li>
          </ul>
        </Card>
      </div>

      <Card
        className="span-2"
        title="Recorded dataset"
        icon="models"
        actions={
          <button className="btn btn-primary btn-sm" onClick={onTrain} disabled={trainable < 2}>
            Continue to training <Icon name="arrow" size={14} />
          </button>
        }
      >
        {dataset.signs.length === 0 ? (
          <Empty icon="hand" title="No signs recorded yet">
            Enter a sign name above and press <strong>Start recording</strong>. You need at least two signs with {MIN_SAMPLES}+ clips each to train.
          </Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Sign</th>
                <th>Clips</th>
                <th>Last recorded</th>
                <th className="num">Actions</th>
              </tr>
            </thead>
            <tbody>
              {dataset.signs.map((s) => (
                <tr key={s.slug}>
                  <td>
                    <strong>{s.name}</strong>
                  </td>
                  <td>
                    <div className="count-cell">
                      <span className="mono">{s.samples}</span>
                      <span className="mini-bar wide">
                        <span
                          className={s.samples >= RECOMMENDED ? "good" : s.samples >= MIN_SAMPLES ? "" : "warn"}
                          style={{ width: `${Math.min(100, (s.samples / RECOMMENDED) * 100)}%` }}
                        />
                      </span>
                      {s.samples < MIN_SAMPLES && <Badge tone="warn">needs {MIN_SAMPLES - s.samples} more</Badge>}
                    </div>
                  </td>
                  <td className="muted">{formatDate(s.updated_at)}</td>
                  <td className="num actions">
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setSign(s.name)} title="Record more clips">
                      <Icon name="plus" size={14} /> More
                    </button>
                    <button className="icon-btn" disabled={busy} onClick={() => undo(s.name)} title="Remove last clip">
                      <Icon name="undo" size={16} />
                    </button>
                    <button className="icon-btn danger" disabled={busy} onClick={() => remove(s.name)} title="Delete sign">
                      <Icon name="trash" size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// --------------------------------------------------------------------------------------------
const STATE_LABEL: Record<JobState, string> = {
  pending: "Queued",
  preparing: "Preparing data",
  training: "Training",
  evaluating: "Evaluating",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

function TrainPanel({ dataset }: { dataset: ReturnType<typeof useDataset> }) {
  const { status, refresh, notify } = useSystem();
  const navigate = useNavigate();
  const job = status?.training ?? null;
  const running = isJobRunning(job);

  const eligible = dataset.signs.filter((s) => s.samples >= MIN_SAMPLES);
  const [selected, setSelected] = useState<string[] | null>(null);
  const chosen = useMemo(() => selected ?? eligible.map((s) => s.name), [selected, eligible]);
  const [name, setName] = useState("My signs");
  const [epochs, setEpochs] = useState(150);
  const [pretrained, setPretrained] = useState(true);
  const [augment, setAugment] = useState(true);
  const [split, setSplit] = useState(0.2);
  const [submitting, setSubmitting] = useState(false);

  const toggle = (n: string) => setSelected(chosen.includes(n) ? chosen.filter((x) => x !== n) : [...chosen, n]);

  const start = async () => {
    setSubmitting(true);
    try {
      await api.startTraining({ name, signs: chosen, epochs, use_pretrained: pretrained, augment, test_fraction: split });
      await refresh();
      notify("Training started. You can keep using the app meanwhile.", "success");
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const activate = async (id: string) => {
    await api.activate(id);
    await refresh();
    notify("Model activated for live prediction.", "success");
  };

  const elapsed = job ? ((job.finished_at ?? Date.now() / 1000) - job.started_at) : 0;
  const eta = job && running && job.epoch > 0 ? (elapsed / job.epoch) * (job.epochs - job.epoch) : null;
  const totalSamples = eligible.filter((s) => chosen.includes(s.name)).reduce((a, s) => a + s.samples, 0);

  return (
    <div className="two-col">
      <div className="col-main stack">
        {job ? (
          <Card
            title={
              <>
                Training job <span className="muted mono small">#{job.id}</span>
              </>
            }
            icon="train"
            actions={
              <Badge tone={job.state === "completed" ? "good" : job.state === "failed" ? "bad" : running ? "brand" : "neutral"}>
                {running && <span className="spinner xs" />} {STATE_LABEL[job.state]}
              </Badge>
            }
          >
            <div className="job-head">
              <div>
                <div className="job-name">{job.name}</div>
                <div className="muted small">{job.signs.join(" · ")}</div>
              </div>
              {running && (
                <button className="btn btn-sm" onClick={() => api.cancelTraining().then(refresh)}>
                  <Icon name="stop" size={14} /> Cancel
                </button>
              )}
            </div>
            <div className="progress lg">
              <div className={running ? "striped" : ""} style={{ width: `${(job.epoch / job.epochs) * 100}%` }} />
            </div>
            <div className="row-between small muted job-meta">
              <span>{job.message}</span>
              <span className="mono">
                {job.epoch}/{job.epochs} epochs · {Math.round(elapsed)}s{eta != null && ` · ~${Math.round(eta)}s left`}
              </span>
            </div>
            {job.history.length > 0 && (
              <div className="chart-grid">
                <TrainingChart history={job.history} totalEpochs={job.epochs} kind="accuracy" />
                <TrainingChart history={job.history} totalEpochs={job.epochs} kind="loss" />
              </div>
            )}
            {job.state === "completed" && job.model_id && (
              <div className="job-result">
                <div className="job-score">
                  <span className="muted small">{job.metrics?.source === "held-out" ? "Held-out accuracy" : "Training accuracy"}</span>
                  <strong>{pct(job.metrics?.accuracy)}</strong>
                </div>
                <div className="row gap">
                  <button className="btn" onClick={() => activate(job.model_id!)}>
                    <Icon name="live" size={15} /> Use for live prediction
                  </button>
                  <button className="btn btn-primary" onClick={() => navigate(`/test?model=${job.model_id}`)}>
                    <Icon name="test" size={15} /> Test this model
                  </button>
                </div>
              </div>
            )}
          </Card>
        ) : (
          <Card>
            <Empty icon="train" title="No training job yet">
              Choose the signs to include and press <strong>Start training</strong>. Progress, accuracy and loss curves will appear here in real time.
            </Empty>
          </Card>
        )}
      </div>

      <div className="col-side">
        <Card title="Training configuration" icon="settings">
          <div className="field">
            <span className="field-label">Signs to include</span>
            {dataset.signs.length === 0 && <p className="muted small">Record samples first.</p>}
            <div className="check-list">
              {dataset.signs.map((s) => {
                const ok = s.samples >= MIN_SAMPLES;
                return (
                  <label key={s.slug} className={`check-item ${ok ? "" : "disabled"}`}>
                    <input type="checkbox" disabled={!ok || running} checked={ok && chosen.includes(s.name)} onChange={() => toggle(s.name)} />
                    <span>{s.name}</span>
                    <span className="mono muted small">{s.samples}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <label className="field">
            <span className="field-label">Model name</span>
            <input className="input" value={name} maxLength={40} disabled={running} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">
              Epochs <strong className="mono">{epochs}</strong>
            </span>
            <input type="range" min={20} max={500} step={10} value={epochs} disabled={running} onChange={(e) => setEpochs(+e.target.value)} />
          </label>
          <div className="field">
            <span className="field-label">Held-out test split</span>
            <Segmented
              value={split}
              onChange={setSplit}
              options={[
                { value: 0, label: "None" },
                { value: 0.1, label: "10%" },
                { value: 0.2, label: "20%" },
                { value: 0.3, label: "30%" },
              ]}
            />
          </div>
          <Toggle
            checked={pretrained}
            onChange={setPretrained}
            label="Transfer learning"
            hint="Start from the base model's LSTM layers. Converges faster with few clips."
          />
          <Toggle checked={augment} onChange={setAugment} label="Data augmentation" hint="Add jittered copies of each clip for robustness." />
          <button
            className="btn btn-primary btn-block btn-lg"
            onClick={start}
            disabled={running || submitting || chosen.length < 2}
          >
            {running ? <span className="spinner xs" /> : <Icon name="play" size={15} />}
            {running ? "Training in progress…" : `Start training · ${chosen.length} signs, ${totalSamples} clips`}
          </button>
          {chosen.length < 2 && <p className="field-hint center">Select at least two signs with {MIN_SAMPLES}+ clips.</p>}
        </Card>
      </div>
    </div>
  );
}
