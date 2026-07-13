import { useEffect, useState, useCallback, useMemo } from "react";
import { useStore } from "../lib/store.js";

interface SessionItem {
  id: string;
  title?: string;
  directory: string;
  time: { created: number; updated: number };
}

interface Props {
  directory?: string;
  onBack: () => void;
  onOpenChat: (sessionId: string) => void;
}

export function SessionsView({ directory, onBack, onOpenChat }: Props) {
  const getClient = useStore((s) => s.getClient);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectName = useMemo(() => {
    if (!directory) return "会话列表";
    return directory.split("/").pop() || directory;
  }, [directory]);

  const refresh = useCallback(async () => {
    const client = getClient();
    if (!client) return;
    try {
      const res = await (client as any).db.session.list();
      let list: SessionItem[] = res.data ?? [];
      if (directory) {
        list = list.filter((s: SessionItem) => s.directory === directory);
      }
      list.sort((a, b) => b.time.updated - a.time.updated);
      setSessions(list);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [getClient, directory]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createSession = async () => {
    const client = getClient();
    if (!client) return;
    setCreating(true);
    try {
      const res = await (client as any).session.create({ body: {} });
      await (client as any).db.invalidate();
      if (res.data) {
        onOpenChat(res.data.id);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const deleteSession = async (id: string) => {
    const client = getClient();
    if (!client) return;
    try {
      await (client as any).session.delete({ path: { id } });
      await (client as any).db.invalidate();
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="app">
      <div className="topbar">
        <button className="back-btn" onClick={onBack}>‹</button>
        <span className="title">{projectName}</span>
        <button onClick={refresh} style={{ fontSize: 12, padding: "6px 10px" }}>刷新</button>
      </div>
      <div className="content">
        <div className="screen">
          {loading && <div className="muted"><span className="spinner" /> 加载中...</div>}
          {error && <div className="error-text">{error}</div>}
          {sessions.length === 0 && !loading && (
            <div className="empty">
              <div className="icon">💬</div>
              <div>还没有会话</div>
            </div>
          )}
          {sessions.map((s) => (
            <div key={s.id} className="list-item" onClick={() => onOpenChat(s.id)}>
              <div className="meta">
                <div className="name">{s.title || "未命名会话"}</div>
                <div className="sub">{new Date(s.time.created).toLocaleString()}</div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); if (confirm(`删除会话 "${s.title || "未命名会话"}"？`)) deleteSession(s.id); }}
                style={{ fontSize: 11, padding: "4px 8px", color: "var(--error)" }}
              >删除</button>
            </div>
          ))}
        </div>
      </div>
      <button className="fab" onClick={createSession} disabled={creating}>
        {creating ? <span className="spinner" /> : "+"}
      </button>
    </div>
  );
}
