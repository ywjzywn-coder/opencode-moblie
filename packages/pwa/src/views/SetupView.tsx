import { useState } from "react";
import type { ConnectionConfig } from "../lib/store.js";

interface Props {
  onConnected: (config: ConnectionConfig) => Promise<void>;
}

export function SetupView({ onConnected }: Props) {
  const [relayUrl, setRelayUrl] = useState(() => {
    if (typeof window === "undefined") return "ws://127.0.0.1:4097";
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    if (window.location.protocol === "https:") {
      return `${proto}//${window.location.host}`;
    }
    return `${proto}//${window.location.hostname}:4097`;
  });
  const [userToken, setUserToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!relayUrl || !userToken) {
      setError("请填写中继地址和 User Token");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      await onConnected({ relayUrl, userToken });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="app">
      <div className="topbar">
        <span className="title">OpenCode Remote</span>
      </div>
      <div className="content">
        <div className="screen">
          <p className="muted" style={{ marginBottom: 16 }}>
            连接到中继服务器。User Token 从中继启动日志里获取。
          </p>
          <form onSubmit={submit}>
            <label>中继地址 (WebSocket URL)</label>
            <input
              type="text"
              value={relayUrl}
              onChange={(e) => setRelayUrl(e.target.value)}
              placeholder="wss://example.fly.dev 或 ws://192.168.1.100:4097"
              autoCapitalize="none"
              autoCorrect="off"
            />
            <label>User Token</label>
            <input
              type="password"
              value={userToken}
              onChange={(e) => setUserToken(e.target.value)}
              placeholder="从启动日志复制"
              autoCapitalize="none"
              autoCorrect="off"
            />
            {error && <div className="error-text">{error}</div>}
            <div style={{ marginTop: 20 }}>
              <button type="submit" className="primary" style={{ width: "100%" }} disabled={connecting}>
                {connecting ? <span className="spinner" /> : "连接"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
