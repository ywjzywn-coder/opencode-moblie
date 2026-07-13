import { useEffect, useState, useCallback } from "react";
import { useStore } from "../lib/store.js";

interface Props {
  sessionId: string;
  onBack: () => void;
}

interface FileDiff {
  path: string;
  before?: string;
  after?: string;
  additions: number;
  deletions: number;
}

export function DiffView({ sessionId, onBack }: Props) {
  const getClient = useStore((s) => s.getClient);
  const [diffs, setDiffs] = useState<FileDiff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadDiff = useCallback(async () => {
    const client = getClient();
    if (!client) return;
    try {
      const res = await (client as any).session.diff({ path: { id: sessionId } });
      setDiffs(res.data ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [getClient, sessionId]);

  useEffect(() => {
    loadDiff();
  }, [loadDiff]);

  return (
    <div className="app">
      <div className="topbar">
        <button className="back-btn" onClick={onBack}>‹</button>
        <span className="title" style={{ fontSize: 14 }}>文件改动</span>
        <button onClick={loadDiff} style={{ fontSize: 12, padding: "6px 10px" }}>刷新</button>
      </div>
      <div className="content">
        <div className="screen">
          {loading && <div className="muted"><span className="spinner" /> 加载中...</div>}
          {error && <div className="error-text">{error}</div>}
          {diffs.length === 0 && !loading && (
            <div className="empty">
              <div className="icon">📄</div>
              <div>本次会话没有文件改动</div>
            </div>
          )}
          {diffs.map((d, i) => (
            <div key={i} className="list-item" onClick={() => setExpanded(expanded === d.path ? null : d.path)}>
              <div className="meta">
                <div className="name" style={{ fontSize: 13, fontFamily: "ui-monospace, monospace" }}>{d.path}</div>
                <div className="sub">
                  <span style={{ color: "var(--success)" }}>+{d.additions}</span>
                  {" "}
                  <span style={{ color: "var(--danger)" }}>-{d.deletions}</span>
                </div>
              </div>
            </div>
          ))}
          {expanded && (
            <DiffDetail
              diff={diffs.find((d) => d.path === expanded)}
              onClose={() => setExpanded(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function DiffDetail({ diff, onClose }: { diff?: FileDiff; onClose: () => void }) {
  if (!diff) return null;
  const beforeLines = (diff.before ?? "").split("\n");
  const afterLines = (diff.after ?? "").split("\n");
  const maxLines = Math.max(beforeLines.length, afterLines.length);

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--bg)", zIndex: 100, display: "flex", flexDirection: "column" }}>
      <div className="topbar">
        <button className="back-btn" onClick={onClose}>‹</button>
        <span className="title" style={{ fontSize: 12, fontFamily: "ui-monospace, monospace" }}>{diff.path}</span>
      </div>
      <div className="content">
        <div className="diff-view" style={{ padding: "8px 0" }}>
          {Array.from({ length: maxLines }).map((_, i) => {
            const before = beforeLines[i];
            const after = afterLines[i];
            if (before === after) {
              return <div key={i} className="line ctx"> {after ?? ""}</div>;
            }
            return (
              <div key={i}>
                {before !== undefined && <div className="line del">-{before}</div>}
                {after !== undefined && <div className="line add">+{after}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
