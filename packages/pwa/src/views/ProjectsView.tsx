import { useEffect, useState, useMemo, useCallback } from "react";
import { useStore } from "../lib/store.js";

interface SessionItem {
  id: string;
  title?: string;
  directory: string;
  time: { created: number; updated: number };
}

interface ProjectGroup {
  directory: string;
  name: string;
  sessionCount: number;
  lastUpdated: number;
  sessionIds: string[];
}

interface Props {
  onBack: () => void;
  onOpenProject: (directory: string) => void;
}

export function ProjectsView({ onBack, onOpenProject }: Props) {
  const getClient = useStore((s) => s.getClient);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const client = getClient();
    if (!client) return;
    setLoading(true);
    try {
      const res = await (client as any).session.list();
      const allSessions: SessionItem[] = res.data ?? [];

      const dirs = [...new Set(allSessions.map((s) => s.directory).filter(Boolean))];
      const existsRes = await (client as any).fs.existsBatch({ paths: dirs });
      const dirMap = new Map<string, boolean>();
      if (Array.isArray(existsRes.data)) {
        dirs.forEach((d, i) => dirMap.set(d, existsRes.data[i]));
      }
      setSessions(allSessions.filter((s) => dirMap.get(s.directory) !== false));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      const res = await (client as any).session.list();
      setSessions(res.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [getClient]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const projects = useMemo<ProjectGroup[]>(() => {
    const groups = new Map<string, ProjectGroup>();
    for (const s of sessions) {
      const dir = s.directory || "/unknown";
      if (!groups.has(dir)) {
        const name = dir.split("/").pop() || dir;
        groups.set(dir, {
          directory: dir,
          name,
          sessionCount: 0,
          lastUpdated: 0,
          sessionIds: [],
        });
      }
      const g = groups.get(dir)!;
      g.sessionCount++;
      g.sessionIds.push(s.id);
      if (s.time.updated > g.lastUpdated) g.lastUpdated = s.time.updated;
    }
    return Array.from(groups.values()).sort((a, b) => b.lastUpdated - a.lastUpdated);
  }, [sessions]);

  const deleteProject = async (p: ProjectGroup) => {
    if (!confirm(`删除项目 "${p.name}" 下的全部 ${p.sessionCount} 个会话？`)) return;
    const client = getClient();
    if (!client) return;
    setDeleting(p.directory);
    try {
      for (const sid of p.sessionIds) {
        await (client as any).session.delete({ path: { id: sid } });
      }
      setSessions((prev) => prev.filter((s) => s.directory !== p.directory));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="app">
      <div className="topbar">
        <button className="back-btn" onClick={onBack}>‹</button>
        <span className="title">项目列表</span>
        <button onClick={refresh} style={{ fontSize: 12, padding: "6px 10px" }}>刷新</button>
      </div>
      <div className="content">
        <div className="screen">
          {loading && <div className="muted"><span className="spinner" /> 加载中...</div>}
          {error && <div className="error-text">{error}</div>}
          {projects.length === 0 && !loading && (
            <div className="empty">
              <div className="icon">📂</div>
              <div>还没有项目</div>
            </div>
          )}
          {projects.map((p) => (
            <div
              key={p.directory}
              className="list-item"
              onClick={() => onOpenProject(p.directory)}
            >
              <svg
                width="22" height="22" viewBox="0 0 24 24" fill="none"
                stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
                style={{ flexShrink: 0 }}
              >
                <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
              </svg>
              <div className="meta">
                <div className="name">{p.name}</div>
                <div className="sub" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.directory}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{p.sessionCount} 个会话</div>
                {p.lastUpdated > 0 && (
                  <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
                    {new Date(p.lastUpdated).toLocaleDateString()}
                  </div>
                )}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteProject(p);
                }}
                disabled={deleting === p.directory}
                style={{
                  flexShrink: 0, background: "none", border: "none", padding: 6,
                  color: "var(--danger)", display: "flex", alignItems: "center",
                }}
                title="删除项目及所有会话"
              >
                {deleting === p.directory ? (
                  <span className="spinner" />
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                )}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
