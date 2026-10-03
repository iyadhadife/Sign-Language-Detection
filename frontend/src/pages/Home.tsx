import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { Card, Stat } from "../components/ui";
import { isJobRunning } from "../lib/api";
import { useSystem } from "../lib/system";

const WORKFLOWS = [
  {
    to: "/live",
    icon: "live",
    title: "Real-time prediction",
    text: "Translate signs from your webcam live, with confidence scores, a running transcript and CPU performance metrics.",
    cta: "Open live view",
  },
  {
    to: "/train",
    icon: "train",
    title: "Train new signs",
    text: "Record a few dozen clips of any new sign and train a custom model in the background — no code required.",
    cta: "Start training",
  },
  {
    to: "/test",
    icon: "test",
    title: "Test & evaluate",
    text: "Run a guided quiz against any model and inspect accuracy, per-sign metrics and the confusion matrix.",
    cta: "Evaluate a model",
  },
];

const PIPELINE = [
  { title: "Webcam", text: "Browser captures frames" },
  { title: "MediaPipe Holistic", text: "1,662 body, face & hand keypoints" },
  { title: "30-frame window", text: "Sequence of recent frames" },
  { title: "LSTM classifier", text: "TensorFlow, CPU only" },
  { title: "Prediction", text: "Sign + confidence" },
];

export default function Home() {
  const { status, online } = useSystem();
  const job = status?.training;

  return (
    <div className="page">
      <section className="hero">
        <div className="hero-text">
          <div className="eyebrow">Sign language recognition · runs on CPU</div>
          <h1>
            Understand signs <span className="accent">in real time.</span>
          </h1>
          <p>
            SignIA turns webcam video into words. It tracks your hands, face and pose with MediaPipe and recognises signs with a
            lightweight LSTM network — fast enough for live use on an ordinary laptop CPU, no GPU needed.
          </p>
          <div className="row gap">
            <Link to="/live" className="btn btn-primary btn-lg">
              <Icon name="play" size={16} /> Start live prediction
            </Link>
            <Link to="/train" className="btn btn-lg">
              <Icon name="plus" size={16} /> Teach a new sign
            </Link>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <img src="/logo.png" alt="" />
        </div>
      </section>

      <div className="stat-row cards">
        <Stat label="System" value={online ? "Online" : "Offline"} tone={online ? "good" : "bad"} hint={status ? `${status.device} · ${status.cpu_count} cores` : "—"} />
        <Stat label="Active model" value={<span className="truncate">{status?.active_model.name ?? "—"}</span>} hint={status ? `${status.active_model.labels.length} signs` : ""} />
        <Stat label="Recorded data" value={status ? `${status.dataset.samples} clips` : "—"} hint={status ? `${status.dataset.signs} signs` : ""} />
        <Stat
          label="Training"
          value={isJobRunning(job) ? `Epoch ${job!.epoch}/${job!.epochs}` : job ? job.state[0].toUpperCase() + job.state.slice(1) : "Idle"}
          tone={isJobRunning(job) ? "warn" : job?.state === "completed" ? "good" : undefined}
          hint={`${status?.models ?? 0} model${status?.models === 1 ? "" : "s"} available`}
        />
      </div>

      <div className="workflow-grid">
        {WORKFLOWS.map((w, i) => (
          <Link key={w.to} to={w.to} className="workflow">
            <div className="workflow-num">0{i + 1}</div>
            <div className="workflow-icon">
              <Icon name={w.icon} size={22} />
            </div>
            <h3>{w.title}</h3>
            <p>{w.text}</p>
            <span className="workflow-cta">
              {w.cta} <Icon name="arrow" size={14} />
            </span>
          </Link>
        ))}
      </div>

      <Card title="How it works" icon="sparkle">
        <ol className="flow">
          {PIPELINE.map((p) => (
            <li key={p.title}>
              <strong>{p.title}</strong>
              <span>{p.text}</span>
            </li>
          ))}
        </ol>
      </Card>

      {status && (
        <Card title="Vocabulary of the active model" icon="hand">
          <div className="chips">
            {status.active_model.labels.map((l) => (
              <span key={l} className="chip">
                {l}
              </span>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
