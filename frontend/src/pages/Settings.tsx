import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { Card, PageHeader, Segmented, Toggle } from "../components/ui";
import { useSettings } from "../lib/settings";
import { useSystem } from "../lib/system";
import { listCameras } from "../lib/useCamera";

export default function Settings() {
  const { settings, update, reset } = useSettings();
  const { status, notify } = useSystem();
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    listCameras().then(setCameras).catch(() => undefined);
  }, []);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Manage"
        title="Settings"
        subtitle="Preferences are stored in this browser."
        actions={
          <button
            className="btn"
            onClick={() => {
              reset();
              notify("Settings restored to defaults.");
            }}
          >
            <Icon name="refresh" size={15} /> Restore defaults
          </button>
        }
      />
      <div className="grid-2">
        <Card title="Appearance" icon="sparkle">
          <div className="field">
            <span className="field-label">Theme</span>
            <Segmented
              value={settings.theme}
              onChange={(theme) => update({ theme })}
              options={[
                { value: "system", label: "System" },
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
            />
          </div>
          <Toggle checked={settings.showLandmarks} onChange={(showLandmarks) => update({ showLandmarks })} label="Show landmarks" hint="Draw the detected skeleton and hands on the video." />
          <Toggle checked={settings.showFace} onChange={(showFace) => update({ showFace })} label="Show face mesh" hint="Draw the face landmarks (lighter overlay when off)." />
          <Toggle checked={settings.mirror} onChange={(mirror) => update({ mirror })} label="Mirror video" hint="Display only — frames sent to the model are never mirrored." />
          <p className="field-hint">
            Tip: press <kbd>F</kbd> anywhere to enter presentation mode for clean screen recordings.
          </p>
        </Card>

        <Card title="Camera" icon="live">
          <label className="field">
            <span className="field-label">Device</span>
            <select className="select" value={settings.cameraId} onChange={(e) => update({ cameraId: e.target.value })}>
              <option value="">Default camera</option>
              {cameras.map((c, i) => (
                <option key={c.deviceId || i} value={c.deviceId}>
                  {c.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span className="field-label">Frame size sent to the server</span>
            <Segmented
              value={settings.frameWidth}
              onChange={(frameWidth) => update({ frameWidth })}
              options={[
                { value: 320, label: "320 px · fastest" },
                { value: 480, label: "480 px" },
                { value: 640, label: "640 px" },
              ]}
            />
            <span className="field-hint">Smaller frames reduce CPU load and network latency.</span>
          </div>
          <label className="field">
            <span className="field-label">
              JPEG quality <strong className="mono">{Math.round(settings.jpegQuality * 100)}%</strong>
            </span>
            <input type="range" min={0.4} max={0.95} step={0.05} value={settings.jpegQuality} onChange={(e) => update({ jpegQuality: +e.target.value })} />
          </label>
        </Card>

        <Card title="Prediction" icon="cpu">
          <label className="field">
            <span className="field-label">
              Confidence threshold <strong className="mono">{Math.round(settings.threshold * 100)}%</strong>
            </span>
            <input type="range" min={0.3} max={0.99} step={0.01} value={settings.threshold} onChange={(e) => update({ threshold: +e.target.value })} />
            <span className="field-hint">A sign is accepted only above this probability.</span>
          </label>
          <label className="field">
            <span className="field-label">
              Stability <strong className="mono">{settings.stability} frames</strong>
            </span>
            <input type="range" min={1} max={15} step={1} value={settings.stability} onChange={(e) => update({ stability: +e.target.value })} />
            <span className="field-hint">The same sign must be predicted for this many consecutive frames before it is added to the transcript.</span>
          </label>
          <Toggle
            checked={settings.requireHands}
            onChange={(requireHands) => update({ requireHands })}
            label="Require visible hands"
            hint="Ignore predictions while no hand is in view (avoids false positives when nobody is signing)."
          />
        </Card>

        <Card title="Recording" icon="record">
          <label className="field">
            <span className="field-label">
              Countdown <strong className="mono">{settings.countdown} s</strong>
            </span>
            <input type="range" min={1} max={5} step={1} value={settings.countdown} onChange={(e) => update({ countdown: +e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">
              Pause between clips <strong className="mono">{settings.pauseBetweenClips} s</strong>
            </span>
            <input type="range" min={0.5} max={4} step={0.5} value={settings.pauseBetweenClips} onChange={(e) => update({ pauseBetweenClips: +e.target.value })} />
          </label>
        </Card>

        {status && (
          <Card title="System information" icon="cpu" className="span-2">
            <dl className="kv">
              <dt>Compute device</dt>
              <dd>{status.device} ({status.cpu_count} cores)</dd>
              <dt>Platform</dt>
              <dd>{status.platform}</dd>
              <dt>Python</dt>
              <dd>{status.python}</dd>
              <dt>TensorFlow</dt>
              <dd>{status.tensorflow}</dd>
              <dt>MediaPipe</dt>
              <dd>
                {status.mediapipe} (Holistic complexity {status.model_complexity})
              </dd>
              <dt>Sequence length</dt>
              <dd>{status.sequence_length} frames</dd>
              <dt>Uptime</dt>
              <dd>{Math.round(status.uptime_s / 60)} min</dd>
            </dl>
          </Card>
        )}
      </div>
    </div>
  );
}
