interface Props {
  description: string;
  onAllow: () => void;
  onDeny: () => void;
}

export function PermissionCard({ description, onAllow, onDeny }: Props) {
  return (
    <div className="permission-card">
      <div className="label">⚡ 权限请求</div>
      <div className="desc">{description}</div>
      <div className="actions">
        <button className="danger" onClick={onDeny}>拒绝</button>
        <button className="primary" onClick={onAllow}>允许</button>
      </div>
    </div>
  );
}
