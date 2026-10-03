import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Prob } from "./api";
import { useSettings } from "./settings";

export interface Landmarks {
  pose: number[] | null;
  face: number[] | null;
  left_hand: number[] | null;
  right_hand: number[] | null;
}

export interface LiveInfo {
  buffer: number;
  ready: boolean;
  model_id?: string;
  probabilities?: Prob[];
  prediction?: string;
  confidence?: number;
  confident?: boolean;
  stable?: boolean;
  no_hands?: boolean;
}

export interface FrameMessage {
  type: "frame";
  landmarks: Landmarks;
  hands: number;
  timing: { detect_ms: number; model_ms: number | null; total_ms: number };
  live?: LiveInfo;
  recording?: { purpose: string; frame: number; frames: number; sign?: string };
}

export interface TrialResult {
  type: "trial_result";
  model_id: string;
  expected: string | null;
  prediction: string;
  confidence: number;
  probabilities: Prob[];
  model_ms: number;
  hands_ratio: number;
}

export type ServerMessage =
  | FrameMessage
  | TrialResult
  | { type: "ready"; sequence_length: number }
  | { type: "sample_saved"; sign: string; samples: number; hands_ratio: number }
  | { type: "record_started"; purpose: string }
  | { type: "record_cancelled" }
  | { type: "configured"; mode: string }
  | { type: "status"; message: string }
  | { type: "error"; message: string };

export type SocketState = "connecting" | "open" | "closed";

export interface StreamMetrics {
  fps: number;
  latency: number;
  detect: number;
  model: number | null;
}

interface Options {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Stream frames only while true (camera ready, page visible...). */
  active: boolean;
  /** Sent every time the socket (re)opens. */
  config?: Record<string, unknown>;
  onMessage?: (msg: ServerMessage) => void;
}

const wsUrl = () => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/vision`;

/**
 * Streams downscaled JPEG frames from the camera to the backend over a WebSocket.
 * Only one frame is in flight at a time, so the frame rate adapts to the CPU speed
 * and latency never builds up.
 */
export function useVision({ videoRef, active, config, onMessage }: Options) {
  const { settings } = useSettings();
  const [socketState, setSocketState] = useState<SocketState>("connecting");
  const [frame, setFrame] = useState<FrameMessage | null>(null);
  const [metrics, setMetrics] = useState<StreamMetrics>({ fps: 0, latency: 0, detect: 0, model: null });

  const wsRef = useRef<WebSocket | null>(null);
  const readyRef = useRef(false);
  const onMessageRef = useRef(onMessage);
  const configRef = useRef(config);
  const settingsRef = useRef(settings);
  onMessageRef.current = onMessage;
  configRef.current = config;
  settingsRef.current = settings;

  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, []);

  // Connection with automatic reconnection.
  useEffect(() => {
    let closed = false;
    let retry: number | undefined;

    const connect = () => {
      setSocketState("connecting");
      const ws = new WebSocket(wsUrl());
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as ServerMessage;
        if (msg.type === "ready") {
          readyRef.current = true;
          setSocketState("open");
          if (configRef.current) ws.send(JSON.stringify({ type: "config", ...configRef.current }));
        }
        if (msg.type === "frame") handleFrame(msg);
        onMessageRef.current?.(msg);
      };
      ws.onclose = () => {
        readyRef.current = false;
        inFlight.current = false;
        if (closed) return;
        setSocketState("closed");
        retry = window.setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      closed = true;
      window.clearTimeout(retry);
      wsRef.current?.close();
    };
  }, []);

  // Frame pump.
  const inFlight = useRef(false);
  const sentAt = useRef(0);
  const lastFrameAt = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const handleFrame = (msg: FrameMessage) => {
    const now = performance.now();
    inFlight.current = false;
    const dt = now - lastFrameAt.current;
    lastFrameAt.current = now;
    setFrame(msg);
    setMetrics((m) => {
      const fps = dt > 0 && dt < 2000 ? 1000 / dt : m.fps;
      const ema = (a: number, b: number) => (a === 0 ? b : a * 0.85 + b * 0.15);
      return {
        fps: ema(m.fps, fps),
        latency: ema(m.latency, now - sentAt.current),
        detect: ema(m.detect, msg.timing.detect_ms),
        model: msg.timing.model_ms == null ? m.model : ema(m.model ?? 0, msg.timing.model_ms),
      };
    });
  };

  useEffect(() => {
    if (!active) {
      setFrame(null);
      return;
    }
    let raf = 0;
    let stopped = false;
    const canvas = (canvasRef.current ??= document.createElement("canvas"));
    const ctx = canvas.getContext("2d");

    const pump = () => {
      if (stopped) return;
      raf = requestAnimationFrame(pump);
      const ws = wsRef.current;
      const video = videoRef.current;
      if (inFlight.current && performance.now() - sentAt.current > 5000) inFlight.current = false; // lost reply
      if (inFlight.current || !ws || ws.readyState !== WebSocket.OPEN || !readyRef.current) return;
      if (!video || video.readyState < 2 || !video.videoWidth || !ctx) return;

      const { frameWidth, jpegQuality } = settingsRef.current;
      const w = Math.min(frameWidth, video.videoWidth);
      const h = Math.round((w * video.videoHeight) / video.videoWidth);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      // Frames are sent un-mirrored, like the original OpenCV capture used for training.
      ctx.drawImage(video, 0, 0, w, h);
      inFlight.current = true;
      sentAt.current = performance.now();
      canvas.toBlob(
        (blob) => {
          if (!blob || stopped || ws.readyState !== WebSocket.OPEN) {
            inFlight.current = false;
            return;
          }
          blob.arrayBuffer().then((buf) => ws.send(buf));
        },
        "image/jpeg",
        jpegQuality,
      );
    };
    raf = requestAnimationFrame(pump);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [active, videoRef]);

  return { socketState, frame, metrics, send };
}
