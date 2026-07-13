import { useState } from "react";
import { useStore } from "../lib/store.js";

interface Props {
  onOpenSessions: () => void;
  onLogout: () => void;
}

export function MachinesView({ onOpenSessions, onLogout }: Props) {
  const { machines, selectedMachineId, selectMachine, renameMachine, connecting, error } = useStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEdit = (id: string, currentName: string) => {
    setEditingId(id);
    setEditValue(currentName);
  };

  const saveEdit = () => {
    if (editingId && editValue.trim()) {
      renameMachine(editingId, editValue.trim());
    }
    setEditingId(null);
    setEditValue("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue("");
  };

  return (
    <div className="app">
      <div className="topbar">
        <span className="title">电脑列表</span>
        <button onClick={onLogout} style={{ fontSize: 12, padding: "6px 10px" }}>退出登录</button>
      </div>
      <div className="content">
        <div className="screen">
          {connecting && <div className="muted"><span className="spinner" /> 连接中...</div>}
          {error && <div className="error-text">{error}</div>}
          {machines.length === 0 && !connecting && (
            <div className="empty">
              <div className="icon">💻</div>
              <div>没有已注册的电脑</div>
              <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
                在电脑上运行插件：<br />
                <code style={{ fontSize: 11 }}>opencode-remote-plugin</code>
              </div>
            </div>
          )}
          {machines.map((m) => (
            <div
              key={m.id}
              className="list-item"
              onClick={() => {
                if (editingId === m.id) return;
                if (!m.online) return;
                selectMachine(m.id);
                onOpenSessions();
              }}
              style={
                selectedMachineId === m.id
                  ? { borderColor: "var(--accent)" }
                  : !m.online
                    ? { opacity: 0.5 }
                    : undefined
              }
            >
              <div style={{
                width: 10, height: 10, borderRadius: "50%",
                background: m.online ? "var(--success)" : "var(--text-dim)",
                flexShrink: 0,
              }} />
              <div className="meta">
                {editingId === m.id ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); saveEdit(); }
                        if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                      style={{ fontSize: 14, padding: "4px 8px" }}
                    />
                    <button onClick={(e) => { e.stopPropagation(); saveEdit(); }} style={{ padding: "4px 8px", fontSize: 12, background: "var(--accent)", borderColor: "var(--accent)", color: "white" }}>✓</button>
                    <button onClick={(e) => { e.stopPropagation(); cancelEdit(); }} style={{ padding: "4px 8px", fontSize: 12 }}>✕</button>
                  </div>
                ) : (
                  <>
                    <div className="name">{m.name}</div>
                    <div className="sub">
                      {m.online ? "在线" : "离线"}
                      {m.opencodeVersion ? ` · opencode ${m.opencodeVersion}` : ""}
                    </div>
                  </>
                )}
              </div>
              {editingId !== m.id && (
                <button
                  onClick={(e) => { e.stopPropagation(); startEdit(m.id, m.name); }}
                  style={{
                    flexShrink: 0, background: "none", border: "none", padding: 6,
                    color: "var(--text-dim)", display: "flex", alignItems: "center",
                  }}
                  title="编辑名称"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9"/>
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
                  </svg>
                </button>
              )}
              {editingId !== m.id && m.online && <span style={{ color: "var(--text-dim)" }}>›</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
