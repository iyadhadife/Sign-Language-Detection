import type { Landmarks } from "./useVision";

// MediaPipe connection lists (upper body only for the pose).
const POSE: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [11, 23], [12, 24], [23, 24],
];
const HAND: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

function drawGraph(
  ctx: CanvasRenderingContext2D,
  pts: number[],
  edges: [number, number][],
  w: number,
  h: number,
  color: string,
  lineWidth: number,
  radius: number,
  maxIndex = Infinity,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const [a, b] of edges) {
    if (a * 2 + 1 >= pts.length || b * 2 + 1 >= pts.length) continue;
    ctx.moveTo(pts[a * 2] * w, pts[a * 2 + 1] * h);
    ctx.lineTo(pts[b * 2] * w, pts[b * 2 + 1] * h);
  }
  ctx.stroke();
  ctx.fillStyle = color;
  for (let i = 0; i < pts.length / 2 && i <= maxIndex; i++) {
    ctx.beginPath();
    ctx.arc(pts[i * 2] * w, pts[i * 2 + 1] * h, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawLandmarks(canvas: HTMLCanvasElement, lm: Landmarks | null, showFace: boolean) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!lm) return;
  const s = Math.max(1, w / 640);

  if (showFace && lm.face) {
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    for (let i = 0; i < lm.face.length; i += 2) ctx.fillRect(lm.face[i] * w - 0.75, lm.face[i + 1] * h - 0.75, 1.5, 1.5);
  }
  if (lm.pose) {
    // Only joints of the upper body are drawn (indices 11-24 carry the arms and torso).
    const upper = lm.pose.slice();
    drawGraph(ctx, upper, POSE, w, h, "rgba(255,255,255,0.75)", 3 * s, 0, -1);
    for (const i of [11, 12, 13, 14, 15, 16, 23, 24]) {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(upper[i * 2] * w, upper[i * 2 + 1] * h, 4 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (lm.left_hand) drawGraph(ctx, lm.left_hand, HAND, w, h, "#3fd6a4", 2.5 * s, 3.5 * s);
  if (lm.right_hand) drawGraph(ctx, lm.right_hand, HAND, w, h, "#ff8a5c", 2.5 * s, 3.5 * s);
}
