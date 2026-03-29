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
    item: [['media:content', 'mediaContent'], ['enclosure', 'enclosure'], ['content:encoded', 'contentEncoded'], ['image', 'image']]
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

// Ініціалізація файлів та папок
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(NEWS_FILE)) fs.writeFileSync(NEWS_FILE, "[]", "utf-8");
if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, "", "utf-8");
if (!fs.existsSync(BLOCKS_FILE)) fs.writeFileSync(BLOCKS_FILE, JSON.stringify({ attempts: {}, blocked: {} }, null, 2), "utf-8");

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

// --- НАДІЙНИЙ ЗАХИСТ ВІД ЗАВАНТАЖЕННЯ СКРИПТІВ ТА ВІРУСІВ ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    let ext = path.extname(file.originalname).toLowerCase();
    // Якщо файл не картинка - примусово робимо його .jpg
    if (!['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
        ext = '.jpg'; 
    }
    cb(null, `img_${Date.now()}${Math.floor(Math.random()*1000)}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('HACK_ATTEMPT'), false);
    }
};

const upload = multer({ 
    storage: storage, 
    limits: { fileSize: 5 * 1024 * 1024 }, // Ліміт 5 МБ
    fileFilter: fileFilter 
});

// --- УТИЛІТИ ---
const safeReadJson = (file, fallback = []) => {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch (e) { return fallback; }
};
const safeWriteJson = (file, data) => {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8"); return true; } catch (e) { return false; }
};
const getSecData = () => safeReadJson(BLOCKS_FILE, { attempts: {}, blocked: {} });
const saveSecData = (d) => safeWriteJson(BLOCKS_FILE, d);

// НАДІЙНЕ ОТРИМАННЯ IP (Для Render)
const getClientIp = (req) => {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return req.socket.remoteAddress || "unknown_ip";
};

// ЛОГУВАННЯ ТА ТЕЛЕГРАМ
const writeLog = async (msg, type = "INFO") => {
  const time = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' });
  const logStr = `[${time}] [${type}] ${msg}\n`;
  console.log(logStr.trim());
  try { fs.appendFileSync(LOG_FILE, logStr); } catch (e) {}

  if (["ALERT", "WARN", "SUCCESS", "MSG"].includes(type)) {
    try {
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        chat_id: CHAT_ID, text: `<b>ПОРТАЛ LIVE:</b>\n${msg}`, parse_mode: "HTML"
      });
    } catch (e) {}
  }
};

// --- ЕКСТРАКТОР ЗОБРАЖЕНЬ ---
function extractImage(item) {
  if (item.enclosure && item.enclosure.url) return item.enclosure.url;
  if (item.mediaContent && item.mediaContent.$ && item.mediaContent.$.url) return item.mediaContent.$.url;
  const body = (item.content || "") + (item.contentEncoded || "") + (item.contentSnippet || "");
  const m = body.match(/<img[^>]+src=(?:'|")([^'">]+)(?:'|")/i);
  if (m && m[1]) return m[1];
  return "assets/img/auto-news.jpg";
}

// --- ГРАБЕР НОВИН ---
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
        feed.items.forEach(item => {
          const title = (item.title || "").trim();
          if (!title || news.some(n => n.title === title)) return;
          news.push({
            id: new Date(item.pubDate || Date.now()).getTime(),
            date: new Date(item.pubDate || Date.now()).toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' }),
            title, category: s.n, img: extractImage(item),
            content: (item.contentSnippet || item.content || "").replace(/<[^>]*>?/gm, '').substring(0, 450) + "...",
            link: item.link || ""
          });
        });
      } catch (e) { }
    }
    
    const now = Date.now();
    const twoDays = 172800000;
    
    // Чистка старих фото
    news.filter(n => (now - n.id) >= twoDays).forEach(n => {
        if (n.img && n.img.startsWith('assets/news/')) {
            const fp = path.join(__dirname, n.img);
            if (fs.existsSync(fp)) fs.unlinkSync(fp);
        }
    });

    news = news.filter(n => (now - n.id) < twoDays).sort((a, b) => b.id - a.id).slice(0, 150);
    safeWriteJson(NEWS_FILE, news);
  } catch (e) { }
}
setInterval(autoFetchNews, 20 * 60 * 1000);
setTimeout(autoFetchNews, 3000);

// --- API ---
app.get("/api/news", (req, res) => res.json(safeReadJson(NEWS_FILE, [])));
app.post("/api/taxi", async (req, res) => {
  await writeLog(`📩 ПОВІДОМЛЕННЯ:\n👤 ${req.body.name}\n📞 ${req.body.phone}\n💬 ${req.body.comment}`, "MSG");
  res.json({ success: true });
});

// --- АДМІНКА: ЛОГІН ТА БАН ---
app.post('/api/admin/login', async (req, res) => {
  const ip = getClientIp(req);
  const now = Date.now();
  const sec = getSecData();

  if (sec.blocked[ip] && now < sec.blocked[ip]) return res.status(403).json({ error: "БЛОК", showPedro: true });
  if (sec.blocked[ip] && now >= sec.blocked[ip]) { delete sec.blocked[ip]; delete sec.attempts[ip]; saveSecData(sec); }

  if (req.body.pass === ADMIN_PASSWORD) {
    delete sec.attempts[ip]; saveSecData(sec);
    await writeLog(`🔑 Вхід в адмінку. IP: ${ip}`, "SUCCESS");
    return res.json({ success: true });
  } else {
    sec.attempts[ip] = (sec.attempts[ip] || 0) + 1;
    if (sec.attempts[ip] >= 3) {
      sec.blocked[ip] = now + 3600000; // 1 година бану
      await writeLog(`🚨 БАН IP ${ip} (3 спроби)`, "ALERT");
    }
    saveSecData(sec);
    if (sec.blocked[ip]) return res.status(403).json({ error: "БЛОК", showPedro: true });
    return res.status(401).json({ error: `Невірний пароль! Залишилося спроб: ${3 - sec.attempts[ip]}` });
  }
});

// --- АДМІНКА: ДОДАТИ НОВИНУ ---
app.post('/api/news/add', upload.single('image'), async (req, res) => {
  try {
    const { pass, title, category, content } = req.body;
    if (pass !== ADMIN_PASSWORD) return res.status(401).json({ error: "Unauthorized" });

    const news = safeReadJson(NEWS_FILE, []);
    const item = {
      id: Date.now(),
      date: new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' }),
      title: String(title).trim(),
      category: category || "Адмін",
      img: req.file ? `assets/news/${req.file.filename}` : "assets/img/auto-news.jpg",
      content: String(content).trim().substring(0, 1000)
    };
    news.unshift(item);
    safeWriteJson(NEWS_FILE, news.slice(0, 150));
    await writeLog(`✅ Додано новину: ${item.title}`, "SUCCESS");
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Помилка' }); }
});

// --- АДМІНКА: ВИДАЛИТИ НОВИНУ ---
app.post('/api/news/delete', async (req, res) => {
  if (req.body.pass !== ADMIN_PASSWORD) return res.status(401).json({ error: "Unauthorized" });
  try {
    let news = safeReadJson(NEWS_FILE, []);
    const idToDelete = String(req.body.id);
    
    const item = news.find(n => String(n.id) === idToDelete);
    if (item && item.img && item.img.startsWith('assets/news/')) {
        const fp = path.join(__dirname, item.img);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }

    news = news.filter(n => String(n.id) !== idToDelete);
    safeWriteJson(NEWS_FILE, news);
    await writeLog(`🗑️ Видалено новину ID: ${idToDelete}`, "WARN");
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: "Error" }); }
});

// --- АДМІНКА: ЧИТАТИ ЛОГИ ---
app.get('/api/admin/logs', (req, res) => {
  if (req.query.pass !== ADMIN_PASSWORD) return res.status(401).send("No access");
  try { 
      // Відправляємо тільки останні 500 рядків, щоб не "завісити" адмінку
      const raw = fs.readFileSync(LOG_FILE, "utf-8");
      const lines = raw.split(/\r?\n/).filter(Boolean);
      res.type('text/plain').send(lines.slice(-500).join('\n')); 
  } catch (e) { res.send("Логи порожні"); }
});

// --- СТАТИКА ---
app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// --- СТАРТ СЕРВЕРА ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log("LIVE SERVER READY on port", PORT);
  await writeLog(`🚀 СЕРВЕР ПЕРЕЗАПУЩЕНО\nСтатус: Активний`, "SUCCESS");
  
  // Антисон для Render
  setInterval(() => {
    const host = process.env.RENDER_EXTERNAL_HOSTNAME;
    if(host) https.get(`https://${host}/`, () => {}).on('error', ()=>{});
  }, 12 * 60 * 1000);
});
