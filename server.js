import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";
import http from "http";
import fs from "fs";
import axios from "axios";
import Parser from "rss-parser";
import helmet from "helmet";
import multer from "multer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent'],
      ['enclosure', 'enclosure'],
      ['content:encoded', 'contentEncoded'],
      ['image', 'image']
    ]
  }
});

// --- КОНФІГУРАЦІЯ ---
const BOT_TOKEN = process.env.BOT_TOKEN || "8381037035:AAGhfS8LbZQCgPf_oAVyvG9tXDLtfAxGVug";
const CHAT_ID = process.env.CHAT_ID || "8257665442";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "pedro2026";
const NEWS_FILE = path.join(__dirname, "news-data.json");
const LOG_FILE = path.join(__dirname, "server.log");
const BLOCKS_FILE = path.join(__dirname, "blocks.json");
const UPLOADS_DIR = path.join(__dirname, "assets/news");

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(NEWS_FILE)) fs.writeFileSync(NEWS_FILE, "[]", "utf-8");
if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, "", "utf-8");
if (!fs.existsSync(BLOCKS_FILE)) fs.writeFileSync(BLOCKS_FILE, JSON.stringify({ attempts: {}, blocked: {} }, null, 2), "utf-8");

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Multer для завантажень
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    const name = `img_${Date.now()}${Math.floor(Math.random()*1000)}${ext}`;
    cb(null, name);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }); // до 5MB

// --- УТИЛІТИ ---
const safeReadJson = (file, fallback = []) => {
  try {
    const raw = fs.readFileSync(file, "utf-8");
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    try { fs.writeFileSync(file, JSON.stringify(fallback, null, 2), "utf-8"); } catch {}
    return fallback;
  }
};
const safeWriteJson = (file, data) => {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8"); return true; }
  catch (e) { try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] [ERROR] Write JSON failed: ${e.message}\n`); } catch {} return false; }
};
const getClientIp = (req) => {
  const xff = req.headers['x-forwarded-for'];
  if (xff && typeof xff === 'string') return xff.split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : req.ip;
};
const getSecData = () => safeReadJson(BLOCKS_FILE, { attempts: {}, blocked: {} });
const saveSecData = (d) => safeWriteJson(BLOCKS_FILE, d);

const sendTelegram = async (text) => {
  if (!BOT_TOKEN || !CHAT_ID) return;
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID, text, parse_mode: "HTML"
    }, { timeout: 8000 });
  } catch (e) { try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] [WARN] Telegram send failed: ${e.message}\n`); } catch {} }
};

const writeLog = async (msg, type = "INFO") => {
  try {
    const time = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' });
    fs.appendFileSync(LOG_FILE, `[${time}] [${type}] ${msg}\n`);
  } catch (e) {}
  if (["ALERT", "WARN", "SUCCESS", "MSG"].includes(type)) await sendTelegram(`<b>ПОРТАЛ LIVE:</b>\n${msg}`);
};

// --- ЕКСТРАКТОР ЗОБРАЖЕНЬ ---
function extractImage(item) {
  if (item.enclosure) {
    if (typeof item.enclosure === 'string') return item.enclosure;
    if (Array.isArray(item.enclosure) && item.enclosure.length) {
      const e = item.enclosure[0];
      if (typeof e === 'string') return e;
      if (e.url) return e.url;
      if (e['@url']) return e['@url'];
    }
    if (typeof item.enclosure === 'object') {
      if (item.enclosure.url) return item.enclosure.url;
      if (item.enclosure['@url']) return item.enclosure['@url'];
    }
  }
  const mc = item.mediaContent || item['media:content'];
  if (mc) {
    const candidate = Array.isArray(mc) ? mc[0] : mc;
    if (candidate) {
      if (candidate.$ && candidate.$.url) return candidate.$.url;
      if (candidate.url) return candidate.url;
      if (candidate['@url']) return candidate['@url'];
    }
  }
  if (item.image) {
    if (typeof item.image === 'string') return item.image;
    if (item.image.url) return item.image.url;
    if (item.image.src) return item.image.src;
    if (item.image['@url']) return item.image['@url'];
  }
  const body = (item.content || "") + (item.contentEncoded || "") + (item.contentSnippet || "");
  const m = body.match(/<img[^>]+src=(?:'|")([^'">]+)(?:'|")/i);
  if (m && m[1]) return m[1];
  return "assets/img/auto-news.jpg";
}

// --- ГРАБЕР (без ZAXID.NET) ---
async function autoFetchNews() {
  try {
    let news = safeReadJson(NEWS_FILE, []);
    const sources = [
      { n: "ТСН Україна", u: "https://tsn.ua/rss/full.rss" },
      { n: "MDR Саксонія", u: "https://www.mdr.de/nachrichten/sachsen/index-rss.xml" },
      { n: "TAG24 Дрезден", u: "https://www.tag24.de/dresden/rss" },
      { n: "DW Новини", u: "https://rss.dw.com/xml/rss-ukr-all" }
    ];
    for (const s of sources) {
      try {
        const res = await axios.get(s.u, { timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        const feed = await parser.parseString(res.data);
        if (!feed || !Array.isArray(feed.items)) continue;
        feed.items.forEach(item => {
          try {
            const title = (item.title || "").trim();
            if (!title) return;
            if (news.some(n => n.title === title)) return;
            const img = extractImage(item);
            const pubTime = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();
            const dateStr = new Date(pubTime).toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' });
            const contentSnippet = (item.contentSnippet || item.content || item.contentEncoded || "").replace(/<[^>]*>?/gm, '');
            news.push({
              id: pubTime,
              date: dateStr,
              title,
              category: s.n,
              img,
              content: contentSnippet.substring(0, 450) + (contentSnippet.length > 450 ? "..." : ""),
              link: item.link || ""
            });
          } catch (inner) {}
        });
      } catch (e) {
        await writeLog(`Error fetching source ${s.n}: ${e.message || e}`, "WARN");
      }
    }
    
    const now = Date.now();
    const twoDays = 172800000;
    
    // ВАЖЛИВО: Видаляємо старі ФОТОГРАФІЇ з диску
    const toDelete = news.filter(n => (now - n.id) >= twoDays);
    toDelete.forEach(n => {
        if (n.img && n.img.startsWith('assets/news/')) {
            const fp = path.join(__dirname, n.img);
            if (fs.existsSync(fp)) { try { fs.unlinkSync(fp); } catch(e){} }
        }
    });

    news = news.filter(n => (now - n.id) < twoDays);
    news.sort((a, b) => b.id - a.id);
    news = news.slice(0, 150);
    safeWriteJson(NEWS_FILE, news);
  } catch (e) {
    await writeLog(`autoFetchNews failed: ${e.message || e}`, "WARN");
  }
}
setInterval(autoFetchNews, 20 * 60 * 1000);
setTimeout(autoFetchNews, 3000);

// --- API: публічні ---
app.get("/api/news", (req, res) => {
  const data = safeReadJson(NEWS_FILE, []);
  res.json(data);
});

app.post("/api/taxi", async (req, res) => {
  try {
    const name = req.body.name || "Невідомо";
    const phone = req.body.phone || "Невідомо";
    const comment = req.body.comment || "";
    await writeLog(`📩 ПОВІДОМЛЕННЯ:\n👤 ${name}\n📞 ${phone}\n💬 ${comment}`, "MSG");
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});

// --- API: адмін (захищені паролем) ---
app.post('/api/admin/login', async (req, res) => {
  const ip = getClientIp(req);
  const now = Date.now();
  const sec = getSecData();

  if (sec.blocked && sec.blocked[ip] && now >= sec.blocked[ip]) {
    delete sec.blocked[ip];
    delete sec.attempts[ip];
    saveSecData(sec);
  }
  if (sec.blocked && sec.blocked[ip] && now < sec.blocked[ip]) {
    return res.status(403).json({ error: "БЛОК", showPedro: true });
  }
  if (req.body && req.body.pass === ADMIN_PASSWORD) {
    delete sec.attempts[ip];
    saveSecData(sec);
    await writeLog(`Успішний вхід. IP: ${ip}`, "SUCCESS");
    return res.json({ success: true });
  } else {
    sec.attempts[ip] = (sec.attempts[ip] || 0) + 1;
    if (sec.attempts[ip] >= 3) {
      sec.blocked[ip] = now + 3600000;
      await writeLog(`🚨 БАН IP ${ip} (3 спроби)`, "ALERT");
      delete sec.attempts[ip];
    }
    saveSecData(sec);
    if (sec.blocked[ip]) return res.status(403).json({ error: "БЛОК", showPedro: true });
    return res.status(401).json({ error: `Спроба ${sec.attempts[ip] || 0} з 3` });
  }
});

app.post('/api/admin/upload-image', upload.single('image'), async (req, res) => {
  try {
    const pass = req.body.pass || "";
    if (pass !== ADMIN_PASSWORD) {
      if (req.file && req.file.path) try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!req.file) return res.status(400).json({ error: "No file" });
    const rel = path.join('assets/news', path.basename(req.file.path)).replace(/\\/g, '/');
    res.json({ success: true, path: rel }); // Повернув форматування шляху
  } catch (e) {
    res.status(500).json({ error: e.message || 'Upload failed' });
  }
});

// Додавання новини (перейменовано на /api/news/add для сумісності з адмінкою)
app.post('/api/news/add', async (req, res) => {
  try {
    const { pass, title, category, content, link, img } = req.body || {};
    if (pass !== ADMIN_PASSWORD) return res.status(401).json({ error: "Unauthorized" });
    if (!title) return res.status(400).json({ error: "Title required" });

    const news = safeReadJson(NEWS_FILE, []);
    const item = {
      id: Date.now(),
      date: new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' }),
      title: String(title).trim(),
      category: category || "Адмін",
      img: img || "assets/img/auto-news.jpg",
      content: (content || "").toString().substring(0, 1000),
      link: link || ""
    };
    news.unshift(item);
    safeWriteJson(NEWS_FILE, news.slice(0, 150));
    await writeLog(`Додано новину: ${item.title}`, "SUCCESS");
    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

// ВАЖЛИВО: Маршрут для видалення новин
app.post('/api/news/delete', async (req, res) => {
    if (req.body.pass !== ADMIN_PASSWORD) return res.status(401).send("No access");
    try {
        let news = safeReadJson(NEWS_FILE, []);
        
        // Видаляємо картинку з сервера, якщо вона була завантажена
        const itemToDelete = news.find(n => n.id == req.body.id);
        if (itemToDelete && itemToDelete.img && itemToDelete.img.startsWith('assets/news/')) {
            const filePath = path.join(__dirname, itemToDelete.img);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }

        news = news.filter(n => n.id != req.body.id);
        safeWriteJson(NEWS_FILE, news);
        await writeLog(`Видалено новину ID: ${req.body.id}`, "WARN");
        res.json({ success: true });
    } catch (e) { 
        res.status(500).json({ error: "Server error" }); 
    }
});

app.get('/api/admin/logs', (req, res) => {
  const pass = req.query.pass || req.headers['x-admin-pass'] || "";
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ error: "Unauthorized" });
  try {
    const raw = fs.readFileSync(LOG_FILE, "utf-8");
    res.type('text/plain').send(raw); // Повернув текстовий формат для консолі в адмінці
  } catch (e) {
    res.status(500).json({ error: 'Failed to read logs' });
  }
});

app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log("LIVE SERVER READY on port", PORT);
  
  // ВАЖЛИВО: Сповіщення в ТГ про запуск сервера
  await writeLog(`🚀 СЕРВЕР ПЕРЕЗАПУЩЕНО\nСтатус: Активний`, "SUCCESS");

  const pingHostRaw = process.env.RENDER_EXTERNAL_HOSTNAME || process.env.PING_HOST || "";
  if (pingHostRaw) {
    const pingUrl = pingHostRaw.startsWith("http://") || pingHostRaw.startsWith("https://") ? pingHostRaw : `https://${pingHostRaw}`;
    setInterval(() => {
      try {
        if (pingUrl.startsWith("https://")) https.get(pingUrl, () => {}).on('error', () => {});
        else http.get(pingUrl, () => {}).on('error', () => {});
      } catch (e) {}
    }, 12 * 60 * 1000);
  }
});
