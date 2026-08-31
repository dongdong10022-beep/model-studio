// ---- state ----
let MODELS = [];
let SITE = {};
let unlocked = false; // whether access password verified
let currentFilter = 'all';
let visitorId = localStorage.getItem('mstudio_vid') || crypto.randomUUID();
localStorage.setItem('mstudio_vid', visitorId);

let ws = null;
let wsOpen = false;
let chatOpened = false;

const $ = (s) => document.querySelector(s);

// ---- toast ----
let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---- load models ----
async function loadModels() {
  const res = await fetch('/api/models');
  const data = await res.json();
  SITE = data.site;
  $('#accessHint').textContent = unlocked ? '乌克兰 / 欧美籍已解锁 ✅' : '乌克兰 / 欧美籍需访问密码';
  $('#accessHint').classList.toggle('ok', unlocked);
  render(data.models);
}

function render(models) {
  MODELS = models;
  const grid = $('#grid');
  grid.innerHTML = '';
  const filtered = currentFilter === 'all'
    ? MODELS
    : MODELS.filter(m => m.nationality === currentFilter || m.nationality === filterToNat(currentFilter));
  if (!filtered.length) { $('#empty').style.display = 'block'; return; }
  $('#empty').style.display = 'none';
  filtered.forEach(m => grid.appendChild(modelCard(m)));
}

function filterToNat(f) {
  return f; // UA, EU, CN are already nationality codes
}

function modelCard(m) {
  const el = document.createElement('div');
  el.className = 'card';
  let photoInner;
  if (m.photo) photoInner = `<img src="${m.photo}" alt="" onerror="this.parentNode.innerHTML='<div class=&quot;ph-fallback&quot;>${m.englishName[0]||'M'}</div>';">`;
  else photoInner = `<div class="ph-fallback">${(m.englishName[0]||'M')}</div>`;

  const locked = m.locked && !unlocked;
  el.innerHTML = `
    <div class="photo">
      ${photoInner}
      <span class="nation">${m.flag} ${m.nationLabel}</span>
      ${(m.locked && !unlocked) ? '<span class="lock-badge">🔒 密码</span>' : ''}
      ${locked ? `<div class="overlay">
          <div style="font-size:15px;color:var(--gold2);">以下资料需访问密码</div>
          <button data-unlock="1">输入密码解锁</button>
        </div>` : ''}
    </div>
    <div class="body">
      <div class="name-row">
        <span class="name">${m.name}</span>
        <span class="ename">${m.englishName}</span>
      </div>
      <div class="meta">
        <div><b>${m.age}</b> 岁 · 身高 <b>${m.height}</b>cm · 三围 <b>${m.figure}</b></div>
        <div>${m.style}</div>
      </div>
      <div class="tags">${m.specialties.map(t => `<span class="tag">${t}</span>`).join('')}</div>
      <div class="price">
        <span class="amount">${m.price}</span>
        <button class="btn-contract" data-contract="${m.id}">预约 / 咨询</button>
      </div>
    </div>`;

  if (locked) {
    el.querySelector('[data-unlock]').addEventListener('click', openLock);
  }
  el.querySelector('[data-contract]').addEventListener('click', () => openContract(m));
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-unlock]') || e.target.closest('[data-contract]')) return;
    openDetail(m);
  });
  return el;
}

// ---- lock modal ----
function openLock() { $('#lockModal').classList.add('show'); $('#lockInput').value=''; $('#lockError').textContent=''; $('#lockOk').style.display='none'; setTimeout(()=>$('#lockInput').focus(),50); }
async function submitLock() {
  const code = $('#lockInput').value.trim();
  if (!code) { $('#lockError').textContent = '请输入访问密码'; return; }
  const res = await fetch('/api/verify', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({code}) });
  const data = await res.json();
  if (data.ok) {
    unlocked = true;
    $('#lockModal').classList.remove('show');
    $('#accessHint').textContent = '乌克兰 / 欧美籍已解锁 ✅';
    $('#accessHint').classList.add('ok');
    toast('访问密码验证成功');
    // replace known data with unlocked full data
    const byId = Object.fromEntries(data.models.map(m => [m.id, m]));
    render(MODELS.map(m => byId[m.id] || m));
  } else {
    $('#lockError').textContent = data.message || '访问密码错误';
    $('#lockOk').style.display='none';
  }
}
$('#lockSubmit').addEventListener('click', submitLock);
$('#lockInput').addEventListener('keydown', e => { if (e.key==='Enter') submitLock(); });

// ---- detail modal ----
function detailRows(m) {
  return `
    <div class="row"><span class="k">国籍</span><span>${m.flag} ${m.nationLabel}</span></div>
    <div class="row"><span class="k">年龄</span><span>${m.age} 岁</span></div>
    <div class="row"><span class="k">身高</span><span>${m.height} cm</span></div>
    <div class="row"><span class="k">三围</span><span>${m.figure}</span></div>
    <div class="row"><span class="k">擅长风格</span><span>${m.style}</span></div>`;
}
function openDetail(m) {
  $('#dName').textContent = m.name;
  $('#dEname').textContent = m.englishName;
  $('#dNation').textContent = `${m.flag} ${m.nationLabel}`;
  $('#dRows').innerHTML = detailRows(m);
  $('#dDesc').textContent = m.description || '详细资料请在客服咨询。';
  $('#dPrice').textContent = `拍摄费用：${m.price}`;
  $('#dImg').innerHTML = m.photo
    ? `<img src="${m.photo}" alt="">`
    : `<div class="ph-fallback">${(m.englishName[0]||'M')}</div>`;
  $('#detailModal').classList.add('show');
  $('#dContract').onclick = () => { $('#detailModal').classList.remove('show'); openChat(); openContractMessage(m); };
}
function openContract(m) {
  openDetail(m);
}
function openContractMessage(m) {
  if (wsOpen) {
    ws.send(JSON.stringify({ type:'chat', text:`你好，我想咨询模特「${m.name}（${m.nationLabel}）」的拍摄档期与价格。` }));
  }
}
$('#dClose').addEventListener('click', () => $('#detailModal').classList.remove('show'));

// ---- filter bar ----
document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentFilter = chip.dataset.filter;
    render(MODELS);
  });
});

// ---- websocket chat ----
function ensureWS() {
  if (ws && wsOpen) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?role=visitor&vid=${encodeURIComponent(visitorId)}`);
  ws.onopen = () => {
    wsOpen = true;
    $('#chatStatus').textContent = '在线客服在线';
    loadHistory();
  };
  ws.onclose = () => {
    wsOpen = false;
    $('#chatStatus').textContent = '连接已断开，重连中…';
    setTimeout(ensureWS, 2000);
  };
  ws.onerror = () => { wsOpen = false; };
  ws.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    if (data.type === 'hello') {
      visitorId = data.visitorId || visitorId;
      localStorage.setItem('mstudio_vid', visitorId);
    } else if (data.type === 'echo') {
      toast(data.msg || '已发送');
    } else if (data.type === 'message') {
      appendChatMsg(data.msg, true); // admin msg
    } else if (data.type === 'request-location') {
      sendLocation(true);
    }
  };
}

// persistence of chat history (server-based via ws handshake? keep local simple)
async function loadHistory() {
  try {
    // fetch history from server if we add endpoint; else skip
  } catch(e){}
}

function openChat() {
  ensureWS();
  $('#chatPanel').classList.add('show');
  chatOpened = true;
}
function closeChat() { $('#chatPanel').classList.remove('show'); chatOpened = false; }
$('#chatFAB').addEventListener('click', () => {
  if ($('#chatPanel').classList.contains('show')) closeChat();
  else openChat();
});
$('#chatClose').addEventListener('click', closeChat);

function appendChatMsg(m, fromServer) {
  const body = $('#chatBody');
  const el = document.createElement('div');
  const isAdmin = m.from === 'admin';
  el.className = 'chat-msg ' + (isAdmin ? 'admin' : 'visitor');
  const time = new Date(m.at).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' });
  if (m.type === 'text') {
    if (isAdmin) el.innerHTML = `<div>${escapeHtml(m.text)}</div><span class="time">客服 · ${time}</span>`;
    else el.innerHTML = `<div>${escapeHtml(m.text)}</div><span class="time">${time}</span>`;
  } else if (m.type === 'image') {
    el.innerHTML = `<img src="${m.url}" alt="图片"><span class="time">${time}</span>`;
    el.querySelector('img').onclick = (ev)=>openImg(ev.target.src);
  } else if (m.type === 'location') {
    const amap = `https://uri.amap.com/marker?position=${m.lng},${m.lat}&name=${encodeURIComponent('我的位置')}`;
    el.innerHTML = `<div class="loc"><span>📍</span><a href="${amap}" target="_blank">我在这里 (${m.lat.toFixed(5)}, ${m.lng.toFixed(5)})</a></div><span class="time">位置 · ${time}</span>`;
  }
  body.appendChild(el);
  body.scrollTop = body.scrollHeight;
}
function escapeHtml(s){ return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function openImg(src){ const w=window.open('','_blank'); w.document.write(`<img src="${src}" style="max-width:100vw">`); }

function sendText() {
  const input = $('#chatInput');
  const text = input.value.trim();
  if (!text || !wsOpen) return;
  ws.send(JSON.stringify({ type:'chat', text }));
  appendChatMsg({ from:'visitor', type:'text', text, at:Date.now() });
  input.value = '';
}
$('#chatSend').addEventListener('click', sendText);
$('#chatInput').addEventListener('keydown', e => { if (e.key==='Enter') sendText(); });

// image
$('#toolImage').addEventListener('click', () => $('#fileImage').click());
$('#fileImage').addEventListener('change', (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    if (dataUrl.length > 8 * 1024 * 1024) { toast('图片过大，请压缩后上传'); return; }
    if (wsOpen) ws.send(JSON.stringify({ type:'image', data: dataUrl, name: file.name }));
    appendChatMsg({ from:'visitor', type:'image', url: dataUrl, at:Date.now() });
    toast('图片已发送');
  };
  reader.readAsDataURL(file);
  ev.target.value = '';
});

// location
function sendLocation(auto) {
  if (!('geolocation' in navigator)) { toast('当前浏览器不支持定位'); return; }
  toast(auto ? '客服请求你的位置…' : '正在获取位置…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      if (wsOpen) ws.send(JSON.stringify({ type:'location', lat: latitude, lng: longitude }));
      appendChatMsg({ from:'visitor', type:'location', lat: latitude, lng: longitude, at: Date.now() });
      toast('位置已发送给客服');
    },
    (err) => {
      if (err.code === 1) toast('已拒绝定位权限');
      else toast('定位失败：' + err.message);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}
$('#toolLoc').addEventListener('click', () => sendLocation(false));

// quick replies
$('#toolInfo').addEventListener('click', () => {
  const p = ['请问有哪些档期可约？', '我想了解拍摄价格。', '能发一些模特的照片吗？', '请问拍摄流程是怎样的？'];
  const t = '<div style="display:flex;flex-direction:column;gap:6px;">' + p.map(x=>`<button class="quick" data-q="${x}" style="background:var(--card2);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:8px;font-size:12px;">${x}</button>`).join('') + '</div>';
  const body = $('#chatBody');
  body.insertAdjacentHTML('beforeend', t);
  body.querySelectorAll('.quick').forEach(b => b.onclick = () => { $('#chatInput').value = b.dataset.q; sendText(); body.querySelector('.chat-msg, [class="quick"]') && 0; });
  body.scrollTop = body.scrollHeight;
});

// init
loadModels();
