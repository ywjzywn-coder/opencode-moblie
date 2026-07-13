import { useState } from "react";
import { type ConnectionConfig, decodePairingCode } from "../lib/store.js";

interface Props {
  onConnected: (config: ConnectionConfig) => Promise<void>;
}

export function SetupView({ onConnected }: Props) {
  const [mode, setMode] = useState<"pair" | "manual">("pair");
  const [pairCode, setPairCode] = useState("");
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

  const submitPair = async (e: React.FormEvent) => {
    e.preventDefault();
    const cfg = decodePairingCode(pairCode);
    if (!cfg) {
      setError("配对码无效，请检查后重新粘贴");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      await onConnected(cfg);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConnecting(false);
    }
  };

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
          <div className="tabs" style={{ marginBottom: 16 }}>
            <button className={`tab ${mode === "pair" ? "active" : ""}`} onClick={() => { setMode("pair"); setError(null); }}>
              配对码
            </button>
            <button className={`tab ${mode === "manual" ? "active" : ""}`} onClick={() => { setMode("manual"); setError(null); }}>
              手动输入
            </button>
          </div>

          {mode === "pair" ? (
            <form onSubmit={submitPair}>
              <p className="muted" style={{ marginBottom: 16 }}>
                用 iPhone 相机扫描电脑面板上的二维码会自动配对。也可以把电脑面板上的配对码复制粘贴到这里。
              </p>
              <label>配对码</label>
              <textarea
                value={pairCode}
                onChange={(e) => setPairCode(e.target.value)}
                placeholder="粘贴电脑控制面板显示的配对码"
                autoCapitalize="none"
                autoCorrect="off"
                style={{ minHeight: 80, resize: "none" }}
              />
              {error && <div className="error-text">{error}</div>}
              <div style={{ marginTop: 20 }}>
                <button type="submit" className="primary" style={{ width: "100%" }} disabled={connecting}>
                  {connecting ? <span className="spinner" /> : "配对连接"}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={submit}>
              <p className="muted" style={{ marginBottom: 16 }}>
                连接到中继服务器。User Token 从电脑控制面板或启动日志里获取。
              </p>
              <label>中继地址 (WebSocket URL)</label>
              <input
                type="text"
                value={relayUrl}
                onChange={(e) => setRelayUrl(e.target.value)}
                placeholder="ws://192.168.1.100:4097"
                autoCapitalize="none"
                autoCorrect="off"
              />
              <label>User Token</label>
              <input
                type="password"
                value={userToken}
                onChange={(e) => setUserToken(e.target.value)}
                placeholder="从控制面板复制"
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
          )}
        </div>
      </div>
    </div>
  );
}
