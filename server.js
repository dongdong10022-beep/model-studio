const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const MSG_DIR = path.join(DATA_DIR, 'messages');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PUBLIC_DIR = path.join(ROOT, 'public');

for (const d of [DATA_DIR, MSG_DIR, UPLOAD_DIR, PUBLIC_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOAD_DIR));

const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const CONFIG_DEFAULTS = {
  siteName: 'MODEL STUDIO',
  siteTagline: '高端模特经纪 · 影像定制',
  admin: { username: 'admin', password: 'change-me-on-deploy' },
  lockedModels: { accessCode: 'VIP2026', enabled: true }
};
let config;
try {
  config = Object.assign({}, CONFIG_DEFAULTS, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
} catch (e) {
  config = JSON.parse(JSON.stringify(CONFIG_DEFAULTS));
}
// Secrets read from environment vars (so nothing sensitive is committed to the repo)
if (process.env.ADMIN_USERNAME) config.admin.username = process.env.ADMIN_USERNAME;
if (process.env.ADMIN_PASSWORD) config.admin.password = process.env.ADMIN_PASSWORD;
if (process.env.LOCKED_ACCESS_CODE) config.lockedModels.accessCode = process.env.LOCKED_ACCESS_CODE;

function saveConfig() {
  fs.writeFileSync(path.join(DATA_DIR, 'config.json'), JSON.stringify(config, null, 2));
}

function loadModels() {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'models.json'), 'utf8')).models;
}
function saveModels(models) {
  fs.writeFileSync(path.join(DATA_DIR, 'models.json'), JSON.stringify({ models }, null, 2));
}

const VISITORS_FILE = path.join(DATA_DIR, 'visitors.json');
let visitors = {};
if (fs.existsSync(VISITORS_FILE)) {
  try { visitors = JSON.parse(fs.readFileSync(VISITORS_FILE, 'utf8')); } catch (e) { visitors = {}; }
}
function saveVisitors() {
  fs.writeFileSync(VISITORS_FILE, JSON.stringify(visitors, null, 2));
}

function messagesPath(id) { return path.join(MSG_DIR, `${id}.json`); }
function loadMessages(id) {
  try {
    const p = messagesPath(id);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [];
  } catch (e) { return []; }
}
function saveMessages(id, msgs) {
  fs.writeFileSync(messagesPath(id), JSON.stringify(msgs || [], null, 2));
}

// ---- helpers ----
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket.remoteAddress || '').replace('::ffff:', '');
}

function parseDevice(ua) {
  ua = (ua || '').toLowerCase();
  let model = '未知设备';
  const iphone = ua.match(/iphone os (\d+)[_\s]?(\d+)?/);
  const android = ua.match(/android (\d+[\.\d]*)/);
  let os = 'PC / 未知系统';
  let type = 'Web / 桌面端';

  if (iphone || /ipad/.test(ua)) {
    os = 'iOS';
    type = '手机 / 平板';
    const m = ua.match(/\(iPhone[^)]*\)/) || ua.match(/\(iPad[^)]*\)/);
    model = m ? m[0].replace(/[()]/g, '').trim() : 'Apple iPhone';
  } else if (android) {
    os = 'Android';
    type = '手机';
    const m = ua.match(/; ([\w\s.-]+) (Build|\))/i);
    model = m ? m[1].trim() : 'Android 设备';
  } else if (/windows nt/.test(ua)) {
    os = 'Windows';
    type = '桌面端';
    model = 'Windows 电脑';
  } else if (/mac os x/.test(ua)) {
    os = 'macOS';
    type = '桌面端';
    model = 'Apple Mac';
  }

  let browser = '未知浏览器';
  if (/edg\//.test(ua)) browser = 'Edge';
  else if (/chrome\//.test(ua)) browser = 'Chrome';
  else if (/safari\//.test(ua)) browser = 'Safari';
  else if (/firefox\//.test(ua)) browser = 'Firefox';
  else if (/micromessenger/.test(ua)) browser = '微信';
  else if (/qq\//.test(ua)) browser = 'QQ';

  return { model, os, browser, type };
}

// ---- visitor registry ----
const wsByVisitor = {}; // visitorId -> ws
const adminSockets = []; // [ws]
const adminTokens = new Set(); // token strings

function ensureVisitor(vid, ip, ua) {
  if (!visitors[vid]) {
    const dev = parseDevice(ua);
    visitors[vid] = {
      id: vid,
      ip,
      ua,
      device: dev,
      location: null,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      messageCount: 0,
      online: false
    };
    saveVisitors();
  } else {
    visitors[vid].ip = ip;
    visitors[vid].ua = ua;
    if (!visitors[vid].device) visitors[vid].device = parseDevice(ua);
    visitors[vid].lastSeen = Date.now();
    saveVisitors();
  }
  return visitors[vid];
}

function broadcastToAdmins(obj) {
  for (const socket of adminSockets) {
    try {
      if (socket.readyState === 1) socket.send(JSON.stringify(obj));
    } catch (e) {}
  }
}

function sendToVisitor(vid, obj) {
  const socket = wsByVisitor[vid];
  if (socket && socket.readyState === 1) {
    socket.send(JSON.stringify(obj));
  }
}

function broadcastVisitorList() {
  const list = Object.values(visitors).map(v => ({
    id: v.id, ip: v.ip, device: v.device, location: v.location,
    firstSeen: v.firstSeen, lastSeen: v.lastSeen, messageCount: v.messageCount,
    online: !!wsByVisitor[v.id]
  })).sort((a, b) => b.lastSeen - a.lastSeen);
  broadcastToAdmins({ type: 'visitors', list });
}

// ---- HTTP / REST ----
app.get('/api/models', (req, res) => {
  const models = loadModels();
  const publicList = models.map(m => ({
    id: m.id, name: m.name, englishName: m.englishName,
    nationality: m.nationality, nationLabel: m.nationLabel, flag: m.flag,
    age: m.age, height: m.height, figure: m.figure, style: m.style,
    price: m.price, photo: m.photo, locked: m.locked,
    specialties: m.specialties,
    // description hidden unless unlocked
    description: m.locked ? null : m.description
  }));
  res.json({ site: { name: config.siteName, tagline: config.siteTagline }, models: publicList });
});

app.post('/api/verify', (req, res) => {
  const code = String(req.body.code || '').trim();
  if (code === config.lockedModels.accessCode) {
    const models = loadModels();
    const unlocked = models.map(m => ({
      id: m.id, name: m.name, englishName: m.englishName,
      nationality: m.nationality, nationLabel: m.nationLabel, flag: m.flag,
      age: m.age, height: m.height, figure: m.figure, style: m.style,
      price: m.price, photo: m.photo, locked: m.locked,
      specialties: m.specialties, description: m.description
    }));
    res.json({ ok: true, models: unlocked });
  } else {
    res.status(403).json({ ok: false, message: '访问密码错误' });
  }
});

// Admin auth
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === config.admin.username && password === config.admin.password) {
    const token = crypto.randomBytes(24).toString('hex');
    adminTokens.add(token);
    res.json({ ok: true, token });
  } else {
    res.status(401).json({ ok: false, message: '账号或密码错误' });
  }
});

function requireAdmin(req, res, next) {
  const token = req.headers['x-token'] || req.query.token;
  if (token && adminTokens.has(token)) { next(); } else { res.status(401).json({ ok: false, message: '未授权' }); }
}

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  const token = req.headers['x-token'];
  adminTokens.delete(token);
  res.json({ ok: true });
});

app.get('/api/admin/visitors', requireAdmin, (req, res) => {
  const list = Object.values(visitors).map(v => ({
    id: v.id, ip: v.ip, device: v.device, location: v.location,
    firstSeen: v.firstSeen, lastSeen: v.lastSeen, messageCount: v.messageCount,
    online: !!wsByVisitor[v.id]
  })).sort((a, b) => b.lastSeen - a.lastSeen);
  res.json({ ok: true, list });
});

app.get('/api/admin/visitor/:id/messages', requireAdmin, (req, res) => {
  const id = req.params.id;
  const v = visitors[id];
  const msgs = loadMessages(id);
  res.json({ ok: true, visitor: v || null, messages: msgs });
});

app.get('/api/admin/config', requireAdmin, (req, res) => {
  res.json({ ok: true, config: { accessCode: config.lockedModels.accessCode, admin: { username: config.admin.username } } });
});

app.post('/api/admin/config', requireAdmin, (req, res) => {
  const { accessCode, username, password } = req.body;
  if (typeof accessCode === 'string') config.lockedModels.accessCode = accessCode;
  if (typeof username === 'string' && username) config.admin.username = username;
  if (typeof password === 'string' && password) config.admin.password = password;
  saveConfig();
  res.json({ ok: true });
});

app.post('/api/admin/model/:id', requireAdmin, (req, res) => {
  const models = loadModels();
  const m = models.find(x => x.id === req.params.id);
  if (!m) return res.status(404).json({ ok: false, message: '模特不存在' });
  const { name, englishName, age, height, figure, style, price, description, locked } = req.body;
  if (name !== undefined) m.name = name;
  if (englishName !== undefined) m.englishName = englishName;
  if (age !== undefined) m.age = Number(age);
  if (height !== undefined) m.height = Number(height);
  if (figure !== undefined) m.figure = figure;
  if (style !== undefined) m.style = style;
  if (price !== undefined) m.price = price;
  if (description !== undefined) m.description = description;
  if (locked !== undefined) m.locked = !!locked;
  saveModels(models);
  res.json({ ok: true, model: m });
});

// Upload model photo (admin)
app.post('/api/admin/upload-model-photo', requireAdmin, (req, res) => {
  const { id, data } = req.body;
  const models = loadModels();
  const m = models.find(x => x.id === id);
  if (!m) return res.status(404).json({ ok: false, message: '模特不存在' });
  if (!data || typeof data !== 'string') return res.status(400).json({ ok: false, message: '缺少图片数据' });
  const url = saveImageData(data);
  if (!url) return res.status(400).json({ ok: false, message: '图片数据无效' });
  m.photo = url;
  saveModels(models);
  res.json({ ok: true, photo: url });
});

// Upload (for both visitor & admin image sending) → returns file url
app.post('/api/upload', (req, res) => {
  const { data, name } = req.body;
  if (!data || typeof data !== 'string') return res.status(400).json({ ok: false, message: '缺少图片数据' });
  const extMap = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
  const base64 = data.split(',')[1] || data;
  let ext = '.jpg';
  const m = /data:image\/([a-zA-Z0-9]+);/;
  const mime = (data.match(m) || [])[1];
  ext = extMap['image/' + mime] || ext;
  const filename = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
  try {
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), Buffer.from(base64, 'base64'));
    res.json({ ok: true, url: `/uploads/${filename}` });
  } catch (e) {
    res.status(500).json({ ok: false, message: '保存失败' });
  }
});

const server = http.createServer(app);

// ---- WebSocket ----
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const vid = url.searchParams.get('vid');
  const token = url.searchParams.get('token');
  const role = url.searchParams.get('role') || 'visitor';
  const ip = clientIp(req);
  const ua = req.headers['user-agent'] || '';
  const dev = parseDevice(ua);

  if (role === 'admin' && token && adminTokens.has(token)) {
    ws.isAdmin = true;
    adminSockets.push(ws);
    // send initial visitor list
    const list = Object.values(visitors).map(v => ({
      id: v.id, ip: v.ip, device: v.device, location: v.location,
      firstSeen: v.firstSeen, lastSeen: v.lastSeen, messageCount: v.messageCount,
      online: !!wsByVisitor[v.id]
    })).sort((a, b) => b.lastSeen - a.lastSeen);
    ws.send(JSON.stringify({ type: 'visitors', list }));
    ws.send(JSON.stringify({ type: 'hello', role: 'admin' }));
    console.log('[ws] admin connected');
  } else {
    // visitor
    let visitorId = vid;
    if (!visitorId) visitorId = crypto.randomUUID();
    const v = ensureVisitor(visitorId, ip, ua);
    v.online = true;
    wsByVisitor[visitorId] = ws;
    ws.visitorId = visitorId;
    ws.send(JSON.stringify({ type: 'hello', role: 'visitor', visitorId }));
    console.log('[ws] visitor connected', visitorId, dev.model);
    broadcastToAdmins({ type: 'visitor:online', id: visitorId });
    broadcastVisitorList();
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }

    if (ws.isAdmin) {
      handleAdminMessage(ws, msg);
    } else {
      handleVisitorMessage(ws, msg);
    }
  });

  ws.on('close', () => {
    if (ws.isAdmin) {
      const i = adminSockets.indexOf(ws);
      if (i >= 0) adminSockets.splice(i, 1);
    } else if (ws.visitorId) {
      delete wsByVisitor[ws.visitorId];
      if (visitors[ws.visitorId]) {
        visitors[ws.visitorId].online = false;
        visitors[ws.visitorId].lastSeen = Date.now();
        saveVisitors();
      }
      broadcastToAdmins({ type: 'visitor:offline', id: ws.visitorId });
      broadcastVisitorList();
    }
  });
});

function handleVisitorMessage(ws, m) {
  const vid = ws.visitorId;
  const v = visitors[vid];
  if (!v) return;

  if (m.type === 'chat') {
    const text = String(m.text || '').slice(0, 2000);
    if (!text) return;
    const mObj = { id: crypto.randomUUID(), from: 'visitor', type: 'text', text, at: Date.now() };
    const msgs = loadMessages(vid); msgs.push(mObj); saveMessages(vid, msgs);
    v.messageCount = (v.messageCount || 0) + 1; v.lastSeen = Date.now(); saveVisitors();
    broadcastToAdmins({ type: 'message', visitorId: vid, msg: mObj });
    broadcastVisitorList();
  }

  if (m.type === 'image') {
    // save base64
    const saved = saveImageData(m.data);
    if (!saved) return;
    const mObj = { id: crypto.randomUUID(), from: 'visitor', type: 'image', url: saved, at: Date.now() };
    const msgs = loadMessages(vid); msgs.push(mObj); saveMessages(vid, msgs);
    v.messageCount = (v.messageCount || 0) + 1; v.lastSeen = Date.now(); saveVisitors();
    broadcastToAdmins({ type: 'message', visitorId: vid, msg: mObj });
    broadcastVisitorList();
  }

  if (m.type === 'location') {
    const lat = Number(m.lat), lng = Number(m.lng);
    if (!isNaN(lat) && !isNaN(lng)) {
      v.location = { lat, lng, at: Date.now() };
      v.lastSeen = Date.now(); saveVisitors();
      const mObj = { id: crypto.randomUUID(), from: 'visitor', type: 'location', lat, lng, at: Date.now() };
      const msgs = loadMessages(vid); msgs.push(mObj); saveMessages(vid, msgs);
      broadcastToAdmins({ type: 'message', visitorId: vid, msg: mObj });
      broadcastToAdmins({ type: 'location:update', id: vid, location: v.location });
      sendToVisitor(vid, { type: 'echo', msg: '位置已发送给客服' });
      broadcastVisitorList();
    }
  }
}

function saveImageData(data) {
  if (!data || typeof data !== 'string') return null;
  const mime = (data.match(/data:image\/([a-zA-Z0-9]+);/) || [])[1];
  const extMap = { png: '.png', jpeg: '.jpg', jpg: '.jpg', gif: '.gif', webp: '.webp' };
  const ext = extMap[mime] || '.jpg';
  const base64 = data.split(',')[1] || data;
  const filename = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
  try {
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), Buffer.from(base64, 'base64'));
    return `/uploads/${filename}`;
  } catch (e) { return null; }
}

function handleAdminMessage(ws, m) {
  if (!ws.isAdmin) return;

  if (m.type === 'chat' && m.visitorId) {
    const text = String(m.text || '').slice(0, 2000);
    if (!text) return;
    const mObj = { id: crypto.randomUUID(), from: 'admin', type: 'text', text, at: Date.now() };
    const msgs = loadMessages(m.visitorId); msgs.push(mObj); saveMessages(m.visitorId, msgs);
    sendToVisitor(m.visitorId, { type: 'message', msg: mObj });
  }

  if (m.type === 'image' && m.visitorId) {
    const saved = saveImageData(m.data);
    if (!saved) return;
    const mObj = { id: crypto.randomUUID(), from: 'admin', type: 'image', url: saved, at: Date.now() };
    const msgs = loadMessages(m.visitorId); msgs.push(mObj); saveMessages(m.visitorId, msgs);
    sendToVisitor(m.visitorId, { type: 'message', msg: mObj });
  }

  if (m.type === 'ping' && m.visitorId) {
    // prompt visitor for location
    sendToVisitor(m.visitorId, { type: 'request-location' });
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Model Studio running at http://localhost:${PORT}`);
  console.log(`Admin dashboard at http://localhost:${PORT}/admin.html`);
});
