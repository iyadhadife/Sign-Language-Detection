import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { isJobRunning } from "../lib/api";
import { useSystem } from "../lib/system";
import { Icon } from "./Icon";

const NAV = [
  {
    group: "Workflows",
    items: [
      { to: "/live", label: "Live Prediction", icon: "live" },
      { to: "/train", label: "Train New Signs", icon: "train" },
      { to: "/test", label: "Test & Evaluate", icon: "test" },
    ],
  },
  {
    group: "Manage",
    items: [
      { to: "/models", label: "Models", icon: "models" },
      { to: "/settings", label: "Settings", icon: "settings" },
    ],
  },
  {
    group: "About",
    items: [
      { to: "/feedback", label: "Feedback", icon: "feedback" },
      { to: "/privacy", label: "Privacy Policy", icon: "privacy" },
    ],
  },
];

interface FocusCtx {
  focus: boolean;
  setFocus: (v: boolean) => void;
}
const FocusContext = createContext<FocusCtx>({ focus: false, setFocus: () => undefined });
export const useFocusMode = () => useContext(FocusContext);

export function Layout() {
  const { status, online } = useSystem();
  const [focus, setFocus] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const training = status?.training;

  useEffect(() => setMenuOpen(false), [location.pathname]);

  // "F" toggles the distraction-free presentation mode, Escape leaves it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "f" || e.key === "F") setFocus((f) => !f);
      if (e.key === "Escape") setFocus(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <FocusContext.Provider value={{ focus, setFocus }}>
      <div className={`app ${focus ? "focus-mode" : ""} ${menuOpen ? "menu-open" : ""}`}>
        <aside className="sidebar">
          <NavLink to="/" className="brand" end>
            <img src="/logo.png" alt="SignIA" />
          </NavLink>
          <nav>
            <NavLink to="/" end className="nav-link">
              <Icon name="home" /> Overview
            </NavLink>
            {NAV.map((g) => (
              <div key={g.group} className="nav-group">
                <div className="nav-group-title">{g.group}</div>
                {g.items.map((it) => (
                  <NavLink key={it.to} to={it.to} className="nav-link">
                    <Icon name={it.icon} /> {it.label}
                    {it.to === "/train" && isJobRunning(training) && <span className="nav-pulse" title="Training in progress" />}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>

          <div className="sys-card">
            <div className="sys-row">
              <span className={`status-dot ${online ? "ok" : "bad"}`} />
              <span>{online ? "Backend online" : "Backend offline"}</span>
            </div>
            <div className="sys-row muted">
              <Icon name="cpu" size={15} />
              <span>
                {status ? `CPU · ${status.cpu_count} cores` : "CPU inference"}
              </span>
            </div>
            {status && (
              <div className="sys-row muted" title={status.active_model.name}>
                <Icon name="models" size={15} />
                <span className="truncate">{status.active_model.name}</span>
              </div>
            )}
            {isJobRunning(training) && training && (
              <NavLink to="/train" className="sys-training">
                <div className="sys-row">
                  <span className="spinner sm" /> Training · {training.epoch}/{training.epochs}
                </div>
                <div className="progress thin">
                  <div style={{ width: `${(training.epoch / training.epochs) * 100}%` }} />
                </div>
              </NavLink>
            )}
          </div>
        </aside>

        <div className="main">
          <div className="mobile-bar">
            <button className="icon-btn" onClick={() => setMenuOpen((o) => !o)} aria-label="Toggle menu">
              <span className="burger" />
            </button>
            <img src="/logo.png" alt="SignIA" height={28} />
            <span className={`status-dot ${online ? "ok" : "bad"}`} />
          </div>
          {!online && (
            <div className="banner banner-bad">
              Cannot reach the SignIA backend. Make sure the server is running (<code>docker compose up</code>).
            </div>
          )}
          <main className="content">
            <Outlet />
          </main>
        </div>

        {focus && (
          <button className="focus-exit" onClick={() => setFocus(false)}>
            <Icon name="x" size={14} /> Exit presentation mode <kbd>Esc</kbd>
          </button>
        )}
      </div>
    </FocusContext.Provider>
  );
}
