import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { SettingsProvider } from "./lib/settings";
import { SystemProvider } from "./lib/system";
import Feedback from "./pages/Feedback";
import Home from "./pages/Home";
import Live from "./pages/Live";
import Models from "./pages/Models";
import Privacy from "./pages/Privacy";
import Settings from "./pages/Settings";
import Test from "./pages/Test";
import Train from "./pages/Train";

export default function App() {
  return (
    <SettingsProvider>
      <SystemProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="live" element={<Live />} />
              <Route path="train" element={<Train />} />
              <Route path="test" element={<Test />} />
              <Route path="models" element={<Models />} />
              <Route path="settings" element={<Settings />} />
              <Route path="feedback" element={<Feedback />} />
              <Route path="privacy" element={<Privacy />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </SystemProvider>
    </SettingsProvider>
  );
}
