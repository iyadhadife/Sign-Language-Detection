import { useNavigate } from "react-router-dom";
import { Icon } from "../components/Icon";
import { Badge, Card, Empty, PageHeader, formatDate, pct } from "../components/ui";
import { api } from "../lib/api";
import { useModels } from "../lib/hooks";
import { useSystem } from "../lib/system";

export default function Models() {
  const { models, loading, reload } = useModels();
  const { refresh, notify } = useSystem();
  const navigate = useNavigate();

  const activate = async (id: string) => {
    try {
      await api.activate(id);
      await Promise.all([reload(), refresh()]);
      notify("Active model updated.", "success");
    } catch (e) {
      notify((e as Error).message, "error");
    }
  };
  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete the model “${name}”? This cannot be undone.`)) return;
    try {
      await api.deleteModel(id);
      await Promise.all([reload(), refresh()]);
      notify(`Deleted “${name}”.`);
    } catch (e) {
      notify((e as Error).message, "error");
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Manage"
        title="Models"
        subtitle="Every model you train is stored here. The active model is used by default for live prediction and testing."
        actions={
          <button className="btn btn-primary" onClick={() => navigate("/train")}>
            <Icon name="plus" size={15} /> Train a new model
          </button>
        }
      />
      {loading ? (
        <Card>
          <Empty icon="models" title="Loading models…" />
        </Card>
      ) : (
        <div className="model-grid">
          {models.map((m) => (
            <article key={m.id} className={`model-card ${m.active ? "active" : ""}`}>
              <div className="model-card-head">
                <div>
                  <h3>{m.name}</h3>
                  <div className="muted small">{m.builtin ? "Built-in" : formatDate(m.created_at)}</div>
                </div>
                <div className="row gap-sm">
                  {m.builtin && <Badge>Pretrained</Badge>}
                  {m.active && <Badge tone="good">Active</Badge>}
                </div>
              </div>
              <div className="model-score">
                <div>
                  <span className="muted small">Accuracy</span>
                  <strong>{pct(m.metrics?.accuracy)}</strong>
                </div>
                <div>
                  <span className="muted small">Signs</span>
                  <strong>{m.labels.length}</strong>
                </div>
                <div>
                  <span className="muted small">Epochs</span>
                  <strong>{(m.params?.epochs as number) ?? "—"}</strong>
                </div>
              </div>
              <div className="chips small-chips">
                {m.labels.map((l) => (
                  <span key={l} className="chip">
                    {l}
                  </span>
                ))}
              </div>
              <div className="model-actions">
                <button className="btn btn-sm" disabled={m.active} onClick={() => activate(m.id)}>
                  <Icon name="check" size={14} /> {m.active ? "Active" : "Activate"}
                </button>
                <button className="btn btn-sm" onClick={() => navigate(`/test?model=${m.id}`)}>
                  <Icon name="test" size={14} /> Test
                </button>
                {!m.builtin && (
                  <button className="icon-btn danger" onClick={() => remove(m.id, m.name)} title="Delete model">
                    <Icon name="trash" size={16} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
