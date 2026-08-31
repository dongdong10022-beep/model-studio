// ---- admin state ----
let TOKEN = localStorage.getItem('mstudio_admin_token') || '';
let ws = null;
let wsOpen = false;
let visitors = [];
let currentVisitorId = null;
let modelsCache = [];
let threadMessages = [];

const $ = (s) => document.querySelector(s);

// 高德地图分享链接（经度在前：position=lng,lat）
function amapUrl(lat, lng, name) {
  return `https://uri.amap.com/marker?position=${lng},${lat}&name=${encodeURIComponent(name || '我的位置')}`;
}

function toast(text) {
  const t = $('#toast');
  if (!t) { alert(text); return; }
  t.textContent = text;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function showShell(show) {
  $('#loginWrap').style.display = show ? 'none' : 'flex';
  $('#shell').classList.toggle('show', show);
}

// ---- auth ----
async function login() {
  const username = $('#loginUser').value.trim();
  const password = $('#loginPass').value;
  if (!username || !password) { $('#loginErr').textContent = '请输入账号与密码'; return; }
  const res = await fetch('/api/admin/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username,password}) });
  const data = await res.json();
  if (data.ok) {
    TOKEN = data.token;
    localStorage.setItem('mstudio_admin_token', TOKEN);
    $('#loginErr').textContent = '';
    enter();
  } else {
    $('#loginErr').textContent = data.message || '登录失败';
  }
}
$('#loginBtn').addEventListener('click', login);
$('#loginPass').addEventListener('keydown', e => { if (e.key==='Enter') login(); });

function logout() {
  fetch('/api/admin/logout', { method:'POST', headers:{ 'Content-Type':'application/json', 'x-token': TOKEN } }).catch(()=>{});
  TOKEN = '';
  localStorage.removeItem('mstudio_admin_token');
  if (ws) ws.close();
  showShell(false);
}

function api(path, opts={}) {
  const headers = { 'Content-Type':'application/json', 'x-token': TOKEN, ...(opts.headers||{}) };
  return fetch(path, { ...opts, headers }).then(r => r.json());
}

function enter() {
  showShell(true);
  connectWS();
  loadModelsMgmt();
  loadSettings();
  switchTab('chat');
}

// ---- tabs ----
function switchTab(tab) {
  document.querySelectorAll('.topbar .tab').forEach(t => t.classList.toggle('active', t.dataset.tab===tab));
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = p.dataset.pane===tab ? '' : 'none');
}
document.querySelectorAll('.topbar .tab').forEach(t => t.addEventListener('click', ()=>switchTab(t.dataset.tab)));

// ---- websocket (admin) ----
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?role=admin&token=${encodeURIComponent(TOKEN)}`);
  ws.onopen = () => { wsOpen = true; };
  ws.onclose = () => { wsOpen = false; setTimeout(connectWS, 2500); };
  ws.onmessage = (ev) => {
    const d = JSON.parse(ev.data);
    if (d.type === 'visitors') { renderVisitorList(d.list); }
    else if (d.type === 'message') { onNewMessage(d); }
    else if (d.type === 'visitor:online') { flashVisitor(d.id, true); }
    else if (d.type === 'visitor:offline') { flashVisitor(d.id, false); }
    else if (d.type === 'location:update' && d.id === currentVisitorId) { renderInfo(); }
  };
}

function flashVisitor(id, online) {
  const v = visitors.find(x => x.id === id);
  if (v) { v.online = online; renderVisitorList(visitors); }
  // refresh list anyway
  api('/api/admin/visitors').then(d => { if (d.ok) { visitors = d.list; renderVisitorList(visitors); } });
}

function onNewMessage(d) {
  const vid = d.visitorId;
  const v = visitors.find(x => x.id === vid);
  if (v) v.messageCount = (v.messageCount||0)+1;
  if (vid === currentVisitorId) {
    threadMessages.push(d.msg);
    renderThread();
    if (d.msg.from === 'visitor') { renderVisitorList(visitors); }
  } else {
    renderVisitorList(visitors);
  }
}

// ---- visitor list ----
function renderVisitorList(list) {
  visitors = list;
  $('#vCount').textContent = `(${list.length})`;
  const box = $('#visitorList');
  // remove existing items but keep header
  box.querySelectorAll('.v-item').forEach(e => e.remove());
  $('#vEmpty').style.display = list.length ? 'none' : 'block';
  if (!list.length) { if (currentVisitorId) clearThread(); return; }
  list.forEach(v => {
    const el = document.createElement('div');
    el.className = 'v-item' + (v.id === currentVisitorId ? ' active' : '');
    el.dataset.vid = v.id;
    const dev = v.device || {};
    el.innerHTML = `
      <div class="v-top">
        <span class="dot ${v.online?'on':''}"></span>
        <span class="v-name">${dev.type || '访客'} · ${dev.model || '未知'}</span>
      </div>
      <div class="v-meta">IP ${v.ip || '-'}${v.location ? ' · 📍 已定位' : ''}<span class="v-count">${v.messageCount||0} 条</span></div>`;
    el.onclick = () => openVisitor(v.id);
    box.appendChild(el);
  });
}

// ---- open visitor ----
function openVisitor(id) {
  currentVisitorId = id;
  document.querySelectorAll('.v-item').forEach(e => e.classList.toggle('active', e.dataset.vid===id));
  const d = visitors.find(x => x.id===id);
  api(`/api/admin/visitor/${id}/messages`).then(res => {
    if (!res.ok) return;
    threadMessages = res.messages || [];
    renderThread(!!(d && d.online));
    renderInfo();
  });
}

function renderThread(isOnline) {
  const thread = $('#thread');
  thread.style.display = 'flex';
  $('#chatEmpty').style.display = 'none';
  $('#chatTools').style.display = 'flex';
  $('#chatSendRow').style.display = 'flex';
  thread.innerHTML = '';
  const now = new Date().toLocaleString('zh-CN');
  if (isOnline === false) thread.innerHTML = `<div class="hd">该访客已离线（消息将保留，再次打开时可继续回复）</div>`;
  threadMessages.forEach(m => thread.appendChild(msgEl(m)));
  thread.scrollTop = thread.scrollHeight;
}

function msgEl(m) {
  const el = document.createElement('div');
  const isAdmin = m.from === 'admin';
  el.className = 'chat-msg ' + (isAdmin ? 'admin' : 'visitor');
  const t = new Date(m.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
  if (m.type==='text') {
    el.innerHTML = `<div>${escapeHtml(m.text)}</div><span class="time">${isAdmin?'我':'访客'} · ${t}</span>`;
  } else if (m.type==='image') {
    el.innerHTML = `<img src="${m.url}" alt="图片"><span class="time">${t}</span>`;
    el.querySelector('img').onclick = (ev)=>{ const w=window.open('','_blank'); w.document.write(`<img src="${ev.target.src}" style="max-width:100vw">`); };
  } else if (m.type==='location') {
    el.innerHTML = `<div class="loc"><span>📍</span><a href="${amapUrl(m.lat, m.lng, '访客位置')}" target="_blank">访客位置 (${m.lat.toFixed(5)}, ${m.lng.toFixed(5)})</a></div><span class="time">位置 · ${t}</span>`;
  }
  return el;
}
function escapeHtml(s){ return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function renderInfo() {
  const v = visitors.find(x => x.id===currentVisitorId);
  if (!v) return;
  $('#infoEmpty').style.display='none';
  $('#infoBody').style.display='block';
  const dev = v.device || {};
  const mapLink = v.location ? amapUrl(v.location.lat, v.location.lng, '访客位置') : '';
  $('#infoBody').innerHTML = `
    <div class="kv"><div class="k">访客标识</div><div class="v">${v.id||'-'}</div></div>
    <div class="kv"><div class="k">IP 地址</div><div class="v">${v.ip||'-'}</div></div>
    <div class="kv"><div class="k">在线状态</div><div class="v">${v.online?'<span style="color:var(--ok)">● 在线</span>':'<span style="color:var(--muted)">○ 离线</span>'}</div></div>
    <div class="kv"><div class="k">设备类型</div><div class="v">${dev.type||'-'}</div></div>
    <div class="kv"><div class="k">手机型号 / 设备</div><div class="v">${dev.model||'-'}</div></div>
    <div class="kv"><div class="k">操作系统</div><div class="v">${dev.os||'-'}</div></div>
    <div class="kv"><div class="k">浏览器</div><div class="v">${dev.browser||'-'}</div></div>
    <div class="kv"><div class="k">首次访问</div><div class="v">${v.firstSeen?new Date(v.firstSeen).toLocaleString('zh-CN'):'-'}</div></div>
    <div class="kv"><div class="k">最近活跃</div><div class="v">${v.lastSeen?new Date(v.lastSeen).toLocaleString('zh-CN'):'-'}</div></div>
    <div class="kv"><div class="k">位置</div>
      <div class="loc-box">${v.location ? `<a href="${mapLink}" target="_blank">📍 ${v.location.lat.toFixed(6)}, ${v.location.lng.toFixed(6)}</a><div style="color:var(--muted);font-size:11px;margin-top:4px;">${new Date(v.location.at).toLocaleString('zh-CN')} 上报</div>` : '尚未定位（可点击"请求位置"让访客授权）'}</div>
    </div>
    <div style="margin-top:8px;font-size:11px;color:var(--muted);">设备识别基于 User-Agent，可能不精确。</div>`;
}

function clearThread() {
  currentVisitorId = null;
  $('#thread').style.display='none';
  $('#chatTools').style.display='none';
  $('#chatSendRow').style.display='none';
  $('#chatEmpty').style.display='block';
  $('#infoEmpty').style.display='block';
  $('#infoBody').style.display='none';
}

// ---- send reply ----
$('#aSend').addEventListener('click', sendReply);
$('#aInput').addEventListener('keydown', e => { if (e.key==='Enter') sendReply(); });
function sendReply() {
  const input = $('#aInput');
  const text = input.value.trim();
  if (!text || !currentVisitorId) return;
  if (!wsOpen) { toast('连接中断，请稍候'); return; }
  ws.send(JSON.stringify({ type:'chat', visitorId: currentVisitorId, text }));
  threadMessages.push({ id:'t'+Date.now(), from:'admin', type:'text', text, at:Date.now() });
  renderThread();
  const v = visitors.find(x=>x.id===currentVisitorId); if (v) v.messageCount=(v.messageCount||0)+1;
  renderVisitorList(visitors);
  input.value='';
}

$('#aToolImage').addEventListener('click', ()=>$('#aFileImage').click());
$('#aFileImage').addEventListener('change', (ev)=>{
  const f = ev.target.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = () => {
    if (r.result.length > 8*1024*1024){ toast('图片过大'); return; }
    if (!currentVisitorId || !wsOpen){ toast('请先选择访客'); return; }
    ws.send(JSON.stringify({ type:'image', visitorId: currentVisitorId, data: r.result }));
    threadMessages.push({ id:'t'+Date.now(), from:'admin', type:'image', url: r.result, at:Date.now() });
    renderThread();
  };
  r.readAsDataURL(f);
  ev.target.value='';
});

$('#aToolLoc').addEventListener('click', ()=>{
  if(!currentVisitorId || !wsOpen){ toast('请先选择在线访客'); return; }
  ws.send(JSON.stringify({ type:'ping', visitorId: currentVisitorId }));
  toast('已向访客请求位置（需对方同意授权）');
});

$('#aToolLocShow').addEventListener('click', ()=>{
  const v = visitors.find(x=>x.id===currentVisitorId);
  if (v && v.location) window.open(amapUrl(v.location.lat, v.location.lng, '访客位置'),'_blank');
  else toast('该访客暂未上报位置');
});

// ---- models mgmt ----
async function loadModelsMgmt() {
  const res = await fetch('/api/models');
  const data = await res.json();
  modelsCache = data.models;
  renderModelRows();
}
function renderModelRows() {
  const tbody = $('#modelRows');
  tbody.innerHTML = '';
  modelsCache.forEach(m => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><b>${m.name}</b> <span style="color:var(--muted);font-size:12px;">${m.englishName}</span></td>
      <td><img src="${m.photo}" alt="" style="width:44px;height:58px;object-fit:cover;border-radius:6px;border:1px solid var(--line);cursor:pointer;" onerror="this.src='/img/${m.id}.svg'"> <span class="edit-link" data-upload="${m.id}">📷传照</span></td>
      <td>${m.flag} ${m.nationLabel}</td>
      <td>${m.age}</td><td>${m.height}</td>
      <td style="color:var(--gold2);">${m.price}</td>
      <td>${m.locked ? '<span class="badge-lock">🔒 需密码</span>' : '<span class="badge-free">公开</span>'}</td>
      <td><span class="edit-link" data-id="${m.id}">编辑</span></td>`;
    tr.querySelector('.edit-link[data-id]').onclick = () => editModel(m);
    tr.querySelector('[data-upload]').onclick = (e) => { e.stopPropagation(); uploadModelPhoto(m.id); };
    tbody.appendChild(tr);
  });
}

function uploadModelPhoto(id) {
  const input = $('#aFileModelImage');
  input.dataset.modelid = id;
  input.click();
}

$('#aFileModelImage').addEventListener('change', () => {
  const input = $('#aFileModelImage');
  const f = input.files[0];
  if (!f) return;
  const id = input.dataset.modelid;
  if (!id) return;
  const reader = new FileReader();
  reader.onload = async () => {
    if (reader.result.length > 8 * 1024 * 1024) { toast('图片过大，请压缩后再上传'); return; }
    const d = await api('/api/admin/upload-model-photo', { method: 'POST', body: JSON.stringify({ id, data: reader.result }) });
    if (d.ok) { toast('照片已更新 ✅'); await loadModelsMgmt(); }
    else toast(d.message || '上传失败');
  };
  reader.readAsDataURL(f);
  input.value = '';
});
function editModel(m) {
  const price = prompt('修改拍摄价格：', m.price);
  if (price === null) return;
  const description = prompt('修改个人简介：', m.description || '');
  if (description === null) return;
  const locked = confirm('是否设为需访问密码（乌克兰/欧美籍模式）？\n确定=锁定，取消=公开') ? true : false;
  api(`/api/admin/model/${m.id}`, { method:'POST', body: JSON.stringify({ price, description, locked }) }).then(d => {
    if (d.ok) { toast('已保存'); loadModelsMgmt(); }
    else toast(d.message || '保存失败');
  });
}

// ---- settings ----
async function loadSettings() {
  const d = await api('/api/admin/config');
  if (!d.ok) return;
  $('#setCode').value = d.config.accessCode || '';
  $('#setUser').value = d.config.admin?.username || '';
  $('#setPass').value = '';
}
$('#saveSettings').addEventListener('click', async () => {
  const body = { accessCode: $('#setCode').value.trim(), username: $('#setUser').value.trim() };
  const np = $('#setPass').value;
  if (np) body.password = np;
  const d = await api('/api/admin/config', { method:'POST', body: JSON.stringify(body) });
  if (d.ok) {
    $('#setHint').style.display='block'; $('#setErr').textContent='';
    setTimeout(()=>$('#setHint').style.display='none', 2500);
  } else { $('#setErr').textContent='保存失败'; }
});

// ---- init ----
$('#logoutBtn').addEventListener('click', logout);
if (TOKEN) { loginSilent(); }
function loginSilent(){
  api('/api/admin/visitors').then(d => { if (d.ok) enter(); else showShell(false); }).catch(()=>showShell(false));
}
if (!TOKEN) { showShell(false); }
