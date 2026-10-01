import type { HistoryPoint, Metrics, Prob } from "../lib/api";
import { pct } from "./ui";

export function ProbabilityBars({ items, highlight, limit = 5, threshold }: {
  items: Prob[];
  highlight?: string | null;
  limit?: number;
  threshold?: number;
}) {
  return (
    <ul className="probs">
      {items.slice(0, limit).map((it, i) => (
        <li key={it.label} className={`${it.label === highlight ? "hl" : ""} ${i === 0 ? "top" : ""}`}>
          <div className="probs-row">
            <span className="probs-label">{it.label}</span>
            <span className="probs-value mono">{pct(it.p, 1)}</span>
          </div>
          <div className="probs-track">
            <div className="probs-fill" style={{ width: `${Math.max(1, it.p * 100)}%` }} />
            {threshold !== undefined && <div className="probs-threshold" style={{ left: `${threshold * 100}%` }} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ConfusionMatrix({ metrics }: { metrics: Metrics }) {
  const { labels, confusion_matrix: cm } = metrics;
  return (
    <div className="cm-wrap">
      <table className="cm">
        <thead>
          <tr>
            <th className="cm-corner">
              <span>actual ↓ / predicted →</span>
            </th>
            {labels.map((l) => (
              <th key={l} className="cm-col">
                <span>{l}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cm.map((row, i) => {
            const total = row.reduce((a, b) => a + b, 0);
            return (
              <tr key={labels[i]}>
                <th className="cm-row">{labels[i]}</th>
                {row.map((v, j) => {
                  const share = total ? v / total : 0;
                  return (
                    <td
                      key={j}
                      className={`${i === j ? "diag" : "off"} ${v ? "" : "zero"}`}
                      style={{ "--share": share } as React.CSSProperties}
                      title={`${labels[i]} → ${labels[j]}: ${v}`}
                    >
                      {v || ""}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PerClassTable({ metrics }: { metrics: Metrics }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Sign</th>
          <th className="num">Precision</th>
          <th className="num">Recall</th>
          <th className="num">F1</th>
          <th className="num">Samples</th>
        </tr>
      </thead>
      <tbody>
        {metrics.per_class
          .filter((c) => c.support > 0 || metrics.source !== "dataset")
          .map((c) => (
            <tr key={c.label}>
              <td>{c.label}</td>
              <td className="num mono">{pct(c.precision)}</td>
              <td className="num mono">{pct(c.recall)}</td>
              <td className="num">
                <span className="mini-bar">
                  <span style={{ width: `${c.f1 * 100}%` }} />
                </span>
                <span className="mono">{pct(c.f1)}</span>
              </td>
              <td className="num mono">{c.support}</td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}

type SeriesKey = keyof Omit<HistoryPoint, "epoch">;

export function TrainingChart({ history, totalEpochs, kind }: {
  history: HistoryPoint[];
  totalEpochs?: number;
  kind: "accuracy" | "loss";
}) {
  const W = 520;
  const H = 180;
  const P = { l: 36, r: 10, t: 12, b: 24 };
  const series: { key: SeriesKey; label: string; cls: string }[] =
    kind === "accuracy"
      ? [
          { key: "categorical_accuracy", label: "Train", cls: "s1" },
          { key: "val_categorical_accuracy", label: "Validation", cls: "s2" },
        ]
      : [
          { key: "loss", label: "Train", cls: "s1" },
          { key: "val_loss", label: "Validation", cls: "s2" },
        ];
  const maxEpoch = Math.max(totalEpochs ?? 0, history.length ? history[history.length - 1].epoch : 1, 2);
  const values = history.flatMap((h) => series.map((s) => h[s.key]).filter((v): v is number => v != null && isFinite(v)));
  const maxY = kind === "accuracy" ? 1 : Math.max(0.1, ...values) * 1.05;
  const x = (e: number) => P.l + ((e - 1) / (maxEpoch - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - v / maxY) * (H - P.t - P.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * maxY);

  return (
    <figure className="chart">
      <figcaption>
        <span>{kind === "accuracy" ? "Accuracy" : "Loss"}</span>
        <span className="legend">
          {series.map((s) => (
            <span key={s.key} className={`legend-item ${s.cls}`}>
              <i /> {s.label}
            </span>
          ))}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${kind} per epoch`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} />
            <text className="tick" x={P.l - 6} y={y(t) + 3} textAnchor="end">
              {kind === "accuracy" ? `${Math.round(t * 100)}%` : t.toFixed(1)}
            </text>
          </g>
        ))}
        <text className="tick" x={P.l} y={H - 6}>1</text>
        <text className="tick" x={W - P.r} y={H - 6} textAnchor="end">
          {maxEpoch}
        </text>
        {series.map((s) => {
          const pts = history.filter((h) => h[s.key] != null && isFinite(h[s.key] as number));
          if (!pts.length) return null;
          const d = pts.map((h, i) => `${i ? "L" : "M"}${x(h.epoch).toFixed(1)},${y(h[s.key] as number).toFixed(1)}`).join("");
          return <path key={s.key} className={`line ${s.cls}`} d={d} vectorEffect="non-scaling-stroke" />;
        })}
      </svg>
    </figure>
  );
}
