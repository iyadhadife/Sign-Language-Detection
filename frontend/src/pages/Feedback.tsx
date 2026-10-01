import { useState, type FormEvent } from "react";
import { Icon } from "../components/Icon";
import { Card, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { useSystem } from "../lib/system";

export default function Feedback() {
  const { notify } = useSystem();
  const [rating, setRating] = useState(5);
  const [fileName, setFileName] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    form.set("rating", String(rating));
    setSending(true);
    try {
      await api.feedback(form);
      setSent(true);
      notify("Thank you for your feedback!", "success");
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page narrow">
      <PageHeader eyebrow="About" title="Leave feedback" subtitle="Welcome to the customer feedback page — tell us what works and what could be better." />

      <div className="contact-grid">
        <a className="contact" href="tel:+33600000000">
          <Icon name="feedback" size={22} />
          <strong>Call us</strong>
          <span className="muted small">+33 6 00 00 00 00</span>
        </a>
        <a className="contact" href="mailto:contact@SignIA.fr">
          <Icon name="arrow" size={22} />
          <strong>Write to us</strong>
          <span className="muted small">contact@SignIA.fr</span>
        </a>
        <a className="contact" href="#faq">
          <Icon name="sparkle" size={22} />
          <strong>Browse the FAQ</strong>
          <span className="muted small">Common questions</span>
        </a>
      </div>

      <Card>
        {sent ? (
          <div className="empty">
            <div className="empty-icon good">
              <Icon name="check" size={26} />
            </div>
            <h3>Feedback received</h3>
            <p className="muted">Thanks for helping us improve SignIA.</p>
            <button className="btn" onClick={() => setSent(false)}>
              Send another
            </button>
          </div>
        ) : (
          <form className="form" onSubmit={submit}>
            <div className="grid-2 tight">
              <label className="field">
                <span className="field-label">Name</span>
                <input className="input" name="name" placeholder="Your name" required />
              </label>
              <label className="field">
                <span className="field-label">Email</span>
                <input className="input" name="email" type="email" placeholder="you@example.com" required />
              </label>
            </div>
            <div className="field">
              <span className="field-label">Rating</span>
              <div className="stars" role="radiogroup" aria-label="Rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    type="button"
                    key={n}
                    role="radio"
                    aria-checked={rating === n}
                    className={n <= rating ? "on" : ""}
                    onClick={() => setRating(n)}
                    aria-label={`${n} star${n > 1 ? "s" : ""}`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              <span className="field-label">Your feedback</span>
              <textarea className="input" name="message" rows={5} placeholder="What did you think?" required />
            </label>
            <label className="file-pick">
              <Icon name="plus" size={16} />
              <span>{fileName || "Attach an image (optional)"}</span>
              <input type="file" name="image" accept="image/*" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")} hidden />
            </label>
            <button className="btn btn-primary btn-lg" disabled={sending}>
              {sending ? <span className="spinner xs" /> : <Icon name="arrow" size={16} />} Send feedback
            </button>
          </form>
        )}
      </Card>

      <Card title="Frequently asked questions" icon="sparkle">
        <div id="faq" className="faq">
          <details>
            <summary>Do I need a GPU?</summary>
            <p>No. SignIA is designed to run entirely on the CPU, both for real-time prediction and for training new signs.</p>
          </details>
          <details>
            <summary>Is my video uploaded anywhere?</summary>
            <p>Frames are sent only to your own SignIA server for processing and are never stored, except the landmark data of clips you explicitly record for training.</p>
          </details>
          <details>
            <summary>How many clips do I need for a new sign?</summary>
            <p>At least 5, but 20–30 varied clips per sign give much more reliable results.</p>
          </details>
          <details>
            <summary>Why is my sign not recognised?</summary>
            <p>Keep your upper body and both hands in frame, use good lighting, and check that the sign is in the active model's vocabulary. You can lower the confidence threshold in Settings.</p>
          </details>
        </div>
      </Card>
    </div>
  );
}
