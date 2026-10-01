import { useEffect, useMemo, useState } from "react";
import { CameraStage } from "../components/CameraStage";
import { ProbabilityBars } from "../components/charts";
import { Icon } from "../components/Icon";
import { useFocusMode } from "../components/Layout";
import { Card, PageHeader, pct } from "../components/ui";
import { useModels } from "../lib/hooks";
import { useSettings } from "../lib/settings";
import { useSystem } from "../lib/system";
import { useCamera } from "../lib/useCamera";
import { useVision, type ServerMessage } from "../lib/useVision";

interface Word {
  id: number;
  text: string;
  confidence: number;
}

export default function Live() {
  const { settings } = useSettings();
  const { status, notify } = useSystem();
  const { focus, setFocus } = useFocusMode();
  const { models } = useModels();
  const [cameraOn, setCameraOn] = useState(true);
  const [modelId, setModelId] = useState<string>("");
  const [words, setWords] = useState<Word[]>([]);
  const [serverNote, setServerNote] = useState("");

  useEffect(() => {
    if (!modelId && status) setModelId(status.active_model.id);
  }, [status, modelId]);

  const model = models.find((m) => m.id === modelId) ?? status?.active_model;
  const camera = useCamera(cameraOn, settings.cameraId);

  const config = useMemo(
    () => ({
      mode: "live",
      model_id: modelId || null,
      threshold: settings.threshold,
      stability: settings.stability,
      include_face: settings.showLandmarks && settings.showFace,
      require_hands: settings.requireHands,
    }),
    [modelId, settings.threshold, settings.stability, settings.showLandmarks, settings.showFace, settings.requireHands],
  );

  const onMessage = (msg: ServerMessage) => {
    if (msg.type === "status") setServerNote(msg.message);
    if (msg.type === "configured") setServerNote("");
    if (msg.type === "error") notify(msg.message, "error");
    if (msg.type === "frame" && msg.live?.stable && msg.live.prediction) {
      const text = msg.live.prediction;
      const confidence = msg.live.confidence ?? 0;
      setWords((w) => (w.length && w[w.length - 1].text === text ? w : [...w.slice(-11), { id: Date.now(), text, confidence }]));
    }
  };

  const vision = useVision({ videoRef: camera.videoRef, active: camera.state === "ready", config, onMessage });

  // Push configuration changes to the running session.
  useEffect(() => {
    if (vision.socketState === "open") vision.send({ type: "config", ...config });
  }, [config, vision.socketState, vision.send]);

  const live = vision.frame?.live;
  const lastWord = words[words.length - 1];
  const showCaption = camera.state === "ready" && vision.socketState === "open";

  let captionState: "warming" | "waiting" | "hands" | "uncertain" | "confident" = "waiting";
  if (live && !live.ready) captionState = "warming";
  else if (live?.no_hands) captionState = "hands";
  else if (live?.stable) captionState = "confident";
  else if (live?.ready && !live.confident) captionState = "uncertain";

  return (
    <div className="page page-live">
      {!focus && (
        <PageHeader
          eyebrow="Workflow 1 · Inference"
          title="Real-time Prediction"
          subtitle="Sign in front of your webcam. Landmarks are extracted with MediaPipe and classified by the LSTM model — entirely on the CPU."
          actions={
            <>
              <select className="select" value={modelId} onChange={(e) => setModelId(e.target.value)} aria-label="Model">
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.labels.length} signs)
                  </option>
                ))}
              </select>
              <button className="btn" onClick={() => setCameraOn((v) => !v)}>
                <Icon name={cameraOn ? "stop" : "play"} size={15} /> {cameraOn ? "Stop camera" : "Start camera"}
              </button>
              <button className="btn btn-primary" onClick={() => setFocus(true)} title="Presentation mode (F)">
                <Icon name="focus" size={15} /> Presentation mode
              </button>
            </>
          }
        />
      )}

      <div className="live-grid">
        <div className="live-main">
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
          >
            {showCaption && (
              <div className={`caption caption-${captionState}`}>
                {captionState === "warming" && (
                  <>
                    <span className="caption-sub">Collecting frames</span>
                    <div className="progress caption-progress">
                      <div style={{ width: `${((live?.buffer ?? 0) / (status?.sequence_length ?? 30)) * 100}%` }} />
                    </div>
                  </>
                )}
                {captionState === "waiting" && <span className="caption-sub">{serverNote || "Waiting for a sign…"}</span>}
                {captionState === "hands" && (
                  <span className="caption-sub">
                    <Icon name="hand" size={16} /> Raise your hands to start signing
                  </span>
                )}
                {captionState === "uncertain" && (
                  <span className="caption-sub">
                    Watching… <span className="mono">{live?.prediction} {pct(live?.confidence)}</span>
                  </span>
                )}
                {captionState === "confident" && live?.prediction && (
                  <>
                    <span key={lastWord?.id} className="caption-word">
                      {live.prediction}
                    </span>
                    <span className="caption-conf mono">{pct(live.confidence)}</span>
                  </>
                )}
              </div>
            )}
          </CameraStage>

          <div className="transcript">
            <div className="transcript-label">Transcript</div>
            <div className="transcript-words">
              {words.length === 0 && <span className="muted">Recognised signs will appear here.</span>}
              {words.map((w, i) => (
                <span key={w.id} className={`word ${i === words.length - 1 ? "word-new" : ""}`} title={pct(w.confidence)}>
                  {w.text}
                </span>
              ))}
            </div>
            <button className="icon-btn" onClick={() => setWords([])} title="Clear transcript" disabled={!words.length}>
              <Icon name="trash" size={16} />
            </button>
          </div>
        </div>

        <div className="live-side">
          <Card title="Top predictions" icon="sparkle">
            {live?.probabilities ? (
              <>
                <ProbabilityBars items={live.probabilities} highlight={live.stable ? live.prediction : null} threshold={settings.threshold} />
                {live.no_hands && <p className="field-hint">No hands in view — predictions are paused.</p>}
              </>
            ) : (
              <p className="muted small">
                {live && !live.ready
                  ? `Filling the ${status?.sequence_length ?? 30}-frame window… ${live.buffer}/${status?.sequence_length ?? 30}`
                  : "Predictions appear once the camera is streaming."}
              </p>
            )}
          </Card>

          <Card title="CPU performance" icon="cpu">
            <div className="metric-grid">
              <Metric label="Throughput" value={vision.metrics.fps ? vision.metrics.fps.toFixed(1) : "—"} unit="FPS" />
              <Metric label="End-to-end" value={vision.metrics.latency ? Math.round(vision.metrics.latency) : "—"} unit="ms" />
              <Metric label="Landmarks" value={vision.metrics.detect ? Math.round(vision.metrics.detect) : "—"} unit="ms" />
              <Metric label="LSTM model" value={vision.metrics.model != null ? vision.metrics.model.toFixed(1) : "—"} unit="ms" />
            </div>
            <ul className="pipeline">
              <PipelineStep ok={camera.state === "ready"} label="Camera" detail={camera.state === "ready" ? "Streaming" : camera.state} />
              <PipelineStep ok={vision.socketState === "open"} label="Server connection" detail={vision.socketState} />
              <PipelineStep ok={!!live?.model_id} label="Model loaded" detail={model?.name ?? "—"} />
              <PipelineStep
                ok={!!live?.ready}
                label="Sequence window"
                detail={`${live?.buffer ?? 0}/${status?.sequence_length ?? 30} frames`}
              />
            </ul>
            {status && (
              <p className="footnote">
                {status.device} only · {status.cpu_count} cores · TensorFlow {status.tensorflow} · MediaPipe {status.mediapipe}
              </p>
            )}
          </Card>

          {model && !focus && (
            <Card title="Vocabulary" icon="hand">
              <div className="chips">
                {model.labels.map((l) => (
                  <span key={l} className={`chip ${l === live?.prediction && live?.stable ? "chip-on" : ""}`}>
                    {l}
                  </span>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, unit }: { label: string; value: string | number; unit: string }) {
  return (
    <div className="metric">
      <div className="metric-value mono">
        {value}
        <small>{unit}</small>
      </div>
      <div className="metric-label">{label}</div>
    </div>
  );
}

function PipelineStep({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className={ok ? "ok" : ""}>
      <span className="pipeline-dot">{ok && <Icon name="check" size={11} />}</span>
      <span className="pipeline-label">{label}</span>
      <span className="pipeline-detail truncate">{detail}</span>
    </li>
  );
}
