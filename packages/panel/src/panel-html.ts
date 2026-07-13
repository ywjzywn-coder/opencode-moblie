export const PANEL_HTML = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>OpenCode Remote 控制面板</title>
<style>
  :root {
    --bg: #0a0a0a; --panel: #141414; --elem: #1e1e1e;
    --border: #3c3c3c; --text: #eeeeee; --muted: #808080;
    --primary: #fab283; --accent: #9d7cd8; --error: #e06c75;
    --success: #7fd88f; --warning: #f5a742;
    --mono: ui-monospace, "SF Mono", Menlo, monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: var(--mono);
    font-size: 14px; line-height: 1.5; padding: 24px; max-width: 720px; margin: 0 auto; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  .sub { color: var(--muted); font-size: 12px; margin-bottom: 24px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
    padding: 16px; margin-bottom: 16px; }
  .card h2 { font-size: 13px; color: var(--muted); font-weight: 600; margin-bottom: 12px;
    text-transform: uppercase; letter-spacing: 0.5px; }
  .qr-wrap { display: flex; gap: 20px; align-items: center; flex-wrap: wrap; }
  .qr-box { background: #fff; padding: 10px; border-radius: 8px; width: 200px; height: 200px;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .qr-box svg { width: 100%; height: 100%; }
  .qr-info { flex: 1; min-width: 200px; }
  .qr-info p { color: var(--muted); font-size: 12px; margin-bottom: 12px; }
  .code-label { color: var(--muted); font-size: 11px; margin-bottom: 4px; }
  .code-box { background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
    padding: 8px 10px; font-size: 11px; word-break: break-all; margin-bottom: 8px;
    max-height: 80px; overflow-y: auto; }
  .btn { background: var(--elem); color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 8px 14px; font-family: var(--mono); font-size: 13px;
    cursor: pointer; transition: border-color .1s; }
  .btn:hover { border-color: var(--muted); }
  .btn.primary { background: var(--primary); border-color: var(--primary); color: var(--bg); font-weight: 600; }
  .btn.danger { background: var(--error); border-color: var(--error); color: var(--bg); font-weight: 600; }
  .btn.copy { padding: 4px 10px; font-size: 11px; }
  .btns { display: flex; gap: 8px; margin-top: 8px; }
  .svc { display: flex; align-items: center; gap: 10px; padding: 8px 0;
    border-bottom: 1px solid var(--border); }
  .svc:last-child { border-bottom: none; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .dot.running { background: var(--success); }
  .dot.stopped { background: var(--muted); }
  .dot.starting { background: var(--warning); animation: pulse 1s infinite; }
  .dot.error { background: var(--error); }
  @keyframes pulse { 50% { opacity: .3; } }
  .svc .name { flex: 1; }
  .svc .state { color: var(--muted); font-size: 12px; }
  .row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; }
  .row .k { color: var(--muted); }
  .toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
    background: var(--success); color: var(--bg); padding: 8px 16px; border-radius: 6px;
    font-size: 13px; font-weight: 600; opacity: 0; transition: opacity .2s; pointer-events: none; }
  .toast.show { opacity: 1; }
</style>
</head>
<body>
  <h1>OpenCode Remote</h1>
  <div class="sub">控制面板 · 电脑端服务管理</div>

  <div class="card">
    <h2>手机配对</h2>
    <div class="qr-wrap">
      <div class="qr-box" id="qr">加载中...</div>
      <div class="qr-info">
        <p>用 iPhone 相机对准二维码，点击弹出的链接即可自动配对连接。也可以复制下面的配对码，在手机 App 里手动粘贴。</p>
        <div class="code-label">配对码</div>
        <div class="code-box" id="pairCode">—</div>
        <button class="btn copy" onclick="copyText('pairCode')">复制配对码</button>
        <div class="code-label" style="margin-top:12px">手机访问地址</div>
        <div class="code-box" id="pwaUrl">—</div>
        <button class="btn copy" onclick="copyText('pwaUrl')">复制地址</button>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>服务状态</h2>
    <div id="services"></div>
    <div class="btns">
      <button class="btn primary" onclick="post('/api/start')">全部启动</button>
      <button class="btn" onclick="post('/api/restart')">重启</button>
      <button class="btn danger" onclick="post('/api/stop')">全部停止</button>
    </div>
  </div>

  <div class="card">
    <h2>连接信息</h2>
    <div class="row"><span class="k">局域网 IP</span><span id="lanIp">—</span></div>
    <div class="row"><span class="k">中继端口</span><span id="relayPort">—</span></div>
    <div class="row"><span class="k">User Token</span><span id="userToken" style="font-size:11px">—</span></div>
  </div>

  <div class="toast" id="toast"></div>

<script>
async function refresh() {
  try {
    const r = await fetch('/api/status');
    const d = await r.json();
    document.getElementById('lanIp').textContent = d.lanIp;
    document.getElementById('relayPort').textContent = d.relayPort;
    document.getElementById('userToken').textContent = d.userToken || '未生成';
    document.getElementById('pairCode').textContent = d.pairingCode || '未生成（请先启动中继）';
    document.getElementById('pwaUrl').textContent = d.pwaUrl || '—';
    const el = document.getElementById('services');
    el.innerHTML = d.services.map(s =>
      '<div class="svc"><span class="dot ' + s.status + '"></span>' +
      '<span class="name">' + s.label + '</span>' +
      '<span class="state">' + statusText(s.status) + '</span></div>'
    ).join('');
  } catch (e) { /* ignore */ }
}
function statusText(s) {
  return { running: '运行中', stopped: '已停止', starting: '启动中', error: '错误' }[s] || s;
}
function loadQr() {
  fetch('/api/qr').then(r => r.ok ? r.text() : null).then(svg => {
    if (svg) document.getElementById('qr').innerHTML = svg;
    else document.getElementById('qr').textContent = '等待中继启动';
  }).catch(() => {});
}
async function post(path) {
  await fetch(path, { method: 'POST' });
  toast('已执行');
  setTimeout(() => { refresh(); loadQr(); }, 500);
}
function copyText(id) {
  const t = document.getElementById(id).textContent;
  navigator.clipboard.writeText(t).then(() => toast('已复制'));
}
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1500);
}
refresh(); loadQr();
setInterval(refresh, 2000);
setInterval(loadQr, 10000);
</script>
</body>
</html>`;
