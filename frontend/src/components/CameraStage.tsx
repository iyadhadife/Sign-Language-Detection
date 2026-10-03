import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { drawLandmarks } from "../lib/landmarks";
import { useSettings } from "../lib/settings";
import type { CameraState } from "../lib/useCamera";
import type { Landmarks, SocketState, StreamMetrics } from "../lib/useVision";
import { Icon } from "./Icon";

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  aspect: number;
  cameraState: CameraState;
  cameraError: string;
  socketState: SocketState;
  landmarks: Landmarks | null;
  hands?: number;
  metrics?: StreamMetrics;
  onStart?: () => void;
  /** Elements rendered on top of the (non-mirrored) stage. */
  children?: ReactNode;
  className?: string;
}

export function CameraStage(props: Props) {
  const { videoRef, aspect, cameraState, cameraError, socketState, landmarks, hands, metrics, onStart, children } = props;
  const { settings } = useSettings();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) drawLandmarks(canvasRef.current, settings.showLandmarks ? landmarks : null, settings.showFace);
  }, [landmarks, settings.showLandmarks, settings.showFace]);

  const live = cameraState === "ready" && socketState === "open";

  return (
    <div className={`stage ${props.className ?? ""}`} style={{ aspectRatio: String(aspect) }}>
      <div className={`stage-media ${settings.mirror ? "mirrored" : ""}`}>
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
      </div>

      {cameraState === "ready" && (
        <div className="hud hud-top">
          <span className={`pill ${live ? "pill-live" : "pill-warn"}`}>
            <span className="dot" /> {live ? "LIVE" : socketState === "connecting" ? "Connecting…" : "Server offline"}
          </span>
          {metrics && live && (
            <span className="pill pill-glass mono">
              {metrics.fps.toFixed(1)} FPS · {Math.round(metrics.latency)} ms
            </span>
          )}
          {hands !== undefined && live && (
            <span className={`pill pill-glass ${hands ? "" : "muted"}`}>
              <Icon name="hand" size={14} /> {hands ? `${hands} hand${hands > 1 ? "s" : ""}` : "No hands"}
            </span>
          )}
        </div>
      )}

      {cameraState !== "ready" && (
        <div className="stage-empty">
          {cameraState === "starting" && <div className="spinner" />}
          {cameraState === "starting" && <p>Starting camera…</p>}
          {cameraState === "off" && (
            <>
              <div className="stage-empty-icon">
                <Icon name="live" size={36} />
              </div>
              <p>Camera is off</p>
              {onStart && (
                <button className="btn btn-primary" onClick={onStart}>
                  <Icon name="play" size={16} /> Start camera
                </button>
              )}
            </>
          )}
          {cameraState === "error" && (
            <>
              <div className="stage-empty-icon error">
                <Icon name="x" size={36} />
              </div>
              <p>{cameraError}</p>
            </>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
