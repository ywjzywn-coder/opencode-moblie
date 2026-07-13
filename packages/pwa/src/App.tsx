import { useEffect, useState } from "react";
import { useStore, loadStoredConfig, type ConnectionConfig } from "./lib/store.js";
import { SetupView } from "./views/SetupView.js";
import { MachinesView } from "./views/MachinesView.js";
import { ProjectsView } from "./views/ProjectsView.js";
import { SessionsView } from "./views/SessionsView.js";
import { ChatView } from "./views/ChatView.js";
import { DiffView } from "./views/DiffView.js";

export type Screen = "setup" | "machines" | "projects" | "sessions" | "chat" | "diff";

export function App() {
  const { config, connectToRelay, setConfig, disconnect } = useStore();
  const [screen, setScreen] = useState<Screen>("setup");
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [selectedDirectory, setSelectedDirectory] = useState<string | null>(null);

  useEffect(() => {
    const stored = loadStoredConfig();
    if (stored) {
      setConfig(stored);
      connectToRelay()
        .then(() => setScreen("machines"))
        .catch(() => setScreen("setup"));
    }
  }, []);

  const handleConnected = async (cfg: ConnectionConfig) => {
    setConfig(cfg);
    await connectToRelay();
    setScreen("machines");
  };

  const handleLogout = () => {
    disconnect();
    try { localStorage.removeItem("oc-remote:config"); } catch { /* ignore */ }
    setScreen("setup");
  };

  if (!config || screen === "setup") {
    return <SetupView onConnected={handleConnected} />;
  }

  if (screen === "machines") {
    return (
      <MachinesView
        onOpenSessions={() => setScreen("projects")}
        onLogout={handleLogout}
      />
    );
  }

  if (screen === "projects") {
    return (
      <ProjectsView
        onBack={() => setScreen("machines")}
        onOpenProject={(dir) => {
          setSelectedDirectory(dir);
          setScreen("sessions");
        }}
      />
    );
  }

  if (screen === "sessions") {
    return (
      <SessionsView
        directory={selectedDirectory ?? undefined}
        onBack={() => setScreen("projects")}
        onOpenChat={(sessionId) => {
          setCurrentSessionId(sessionId);
          setScreen("chat");
        }}
      />
    );
  }

  if (screen === "chat" && currentSessionId) {
    return (
      <ChatView
        sessionId={currentSessionId}
        onBack={() => setScreen("sessions")}
        onOpenDiff={() => setScreen("diff")}
      />
    );
  }

  if (screen === "diff" && currentSessionId) {
    return (
      <DiffView
        sessionId={currentSessionId}
        onBack={() => setScreen("chat")}
      />
    );
  }

  return null;
}
