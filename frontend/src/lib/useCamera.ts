import { useEffect, useRef, useState } from "react";

export type CameraState = "off" | "starting" | "ready" | "error";

/** Opens the webcam with getUserMedia and binds it to a <video> element. */
export function useCamera(enabled: boolean, deviceId: string) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<CameraState>("off");
  const [error, setError] = useState<string>("");
  const [aspect, setAspect] = useState(4 / 3);

  useEffect(() => {
    if (!enabled) {
      setState("off");
      return;
    }
    let stream: MediaStream | null = null;
    let cancelled = false;
    setState("starting");
    setError("");

    const constraints: MediaStreamConstraints = {
      audio: false,
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30 },
        ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" }),
      },
    };

    if (!navigator.mediaDevices?.getUserMedia) {
      setState("error");
      setError("Camera access requires a secure context (use http://localhost or HTTPS).");
      return;
    }

    navigator.mediaDevices
      .getUserMedia(constraints)
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = s;
        await video.play().catch(() => undefined);
        const update = () => {
          if (video.videoWidth && video.videoHeight) setAspect(video.videoWidth / video.videoHeight);
          setState("ready");
        };
        if (video.readyState >= 1) update();
        else video.onloadedmetadata = update;
      })
      .catch((e: DOMException) => {
        if (cancelled) return;
        setState("error");
        setError(
          e.name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access in your browser and reload."
            : e.name === "NotFoundError" || e.name === "OverconstrainedError"
              ? "No camera found. Connect a webcam or pick another one in Settings."
              : `Could not start the camera (${e.name}).`,
        );
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [enabled, deviceId]);

  return { videoRef, state, error, aspect };
}

export async function listCameras(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "videoinput");
}
