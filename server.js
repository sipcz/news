import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";
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
      ["media:content", "mediaContent"],
      ["enclosure", "enclosure"],
      ["content:encoded", "contentEncoded"],
      ["image", "image"]
    ]
  }
});

// --- КОНФІГУРАЦІЯ ---
const BOT_TOKEN = "8381037035:AAGhfS8LbZQCgPf_oAVyvG9tXDLtfAxGVug";
const CHAT_ID = "8257665442";
const ADMIN_PASSWORD = "pedro2026";

const NEWS_FILE = path.join(__dirname, "news-data.json");
const LOG_FILE = path.join(__dirname, "server.log");
const BLOCKS_FILE = path.join(__dirname, "blocks.json");
const GUIDE_FILE = path.join(__dirname, "guide-data.json");
const UPLOADS_DIR = path.join(__dirname, "assets/news");

const defaultGuide = {
  p24: { title: "🛡️ Параграф 24: Деталі", text: "Інформація про реєстрацію..." },
  house: { title: "🏠 Пошук житла (Wohnung)", text: "Як шукати квартиру в Дрездені..." },
  job: { title: "💼 Робота та Jobcenter", text: "Контакти центру зайнятості..." },
  med: { title: "🏥 Страхування", text: "Як обрати медичну касу..." }
};

// --- ІНІЦІАЛІЗАЦІЯ ФАЙЛІВ ---
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(NEWS_FILE)) fs.writeFileSync(NEWS_FILE, "[]", "utf-8");
if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, "", "utf-8");
if (!fs.existsSync(BLOCKS_FILE)) fs.writeFileSync(BLOCKS_FILE, JSON.stringify({ attempts: {}, blocked: {} }), "utf-8");
if (!fs.existsSync(GUIDE_FILE)) fs.writeFileSync(GUIDE_FILE, JSON.stringify(defaultGuide), "utf-8");

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

// --- MULTER (Завантаження фото) ---
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS_DIR),
  filename: (_, file, cb) => cb(null, `img_${Date.now()}${path.extname(file.originalname).toLowerCase()}`)
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// --- УТИЛІТИ ---
const safeRead = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, "utf-8")); } catch { return fb; } };
const safeWrite = (f, d) => fs.writeFile(f, JSON.stringify(d, null, 2), "utf-8", () => {});
const getIP = (req) => req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress;

// --- РОЗУМНА СИСТЕМА ЛОГУВАННЯ ---
let lastTelegram = {};
let logBuffer = [];

const flushLogs = () => {
  if (logBuffer.length === 0) return;
  const data = logBuffer.join("");
  logBuffer = [];
  fs.appendFile(LOG_FILE, data, "utf-8", () => {});
};
setInterval(flushLogs, 5000); // Записуємо на диск кожні 5 секунд

const normalizeError = (arg) => {
  if (arg instanceof Error) return `${arg.message}\n${arg.stack}`;
  if (typeof arg === "object") return JSON.stringify(arg, null, 2);
  return String(arg);
};

const writeLog = async (msg, type = "INFO") => {
  const time = new Date().toLocaleString("uk-UA", { timeZone: "Europe/Berlin" });
  const logStr = `[${time}] [${type}] ${msg}\n`;

  logBuffer.push(logStr);
  console.log(logStr.trim());

  // Авто-очищення логів якщо файл > 5МБ
  fs.stat(LOG_FILE, (err, stats) => {
    if (!err && stats.size > 5 * 1024 * 1024) fs.writeFile(LOG_FILE, "[LOG RESET]\n", "utf-8", () => {});
  });

  // Надсилаємо в ТГ тільки критичне і не частіше ніж раз на хвилину для одного типу
  if (["ERROR", "ALERT", "SUCCESS", "MSG"].includes(type)) {
    const now = Date.now();
    if (!lastTelegram[type] || now - lastTelegram[type] > 60000) {
      lastTelegram[type] = now;
      axios.post(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        { chat_id: CHAT_ID, text: `<b>ПОРТАЛ LIVE [${type}]:</b>\n${msg.substring(0, 3500)}`, parse_mode: "HTML" },
        { timeout: 5000 }
      ).catch(() => {});
    }
  }
};

// --- GLOBAL ERROR HOOKS ---
process.on("uncaughtException", (err) => writeLog(`❌ Uncaught: ${normalizeError(err)}`, "ERROR"));
process.on("unhandledRejection", (reason) => writeLog(`⚠️ Rejection: ${normalizeError(reason)}`, "ERROR"));

const origError = console.error;
console.error = (...args) => {
  writeLog(`🛑 Console Error: ${args.map(normalizeError).join(" ")}`, "ERROR");
  origError(...args);
};

// --- ГРАБЕР НОВИН ---
async function fetchNews() {
  const sources = [
    { n: "ТСН Україна", u: "https://tsn.ua/rss/full.rss" },
    { n: "MDR Саксонія", u: "https://www.mdr.de/nachrichten/sachsen/index-rss.xml" },
    { n: "DW Новини", u: "https://rss.dw.com/xml/rss-ukr-all" }
  ];

  let news = safeRead(NEWS_FILE, []);

  for (const s of sources) {
    try {
      const res = await axios.get(s.u, {
        timeout: 15000,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36" }
      });

      const feed = await parser.parseString(res.data);

      feed.items.forEach(item => {
        const title = (item.title || "").trim();
        if (!title || news.some(n => n.title === title)) return;

        let content = (item.contentEncoded || item.contentSnippet || item.content || "")
          .replace(/<[^>]*>?/gm, " ").trim();

        let image = item.enclosure?.url || item.mediaContent?.$.url;
        if (!image && item.content) {
          const m = item.content.match(/src="([^"]+)"/);
          if (m) image = m[1];
        }

        news.push({
          id: Date.now() + Math.random(),
          date: new Date(item.pubDate || Date.now()).toISOString(),
          title,
          category: s.n,
          link: item.link,
          img: image || "assets/img/auto-news.jpg",
          content: content.substring(0, 2000)
        });
      });
    } catch (e) {
      console.error(`Помилка грабера ${s.n}: ${e.message}`);
    }
  }

  news.sort((a, b) => new Date(b.date) - new Date(a.date));
  safeWrite(NEWS_FILE, news.slice(0, 150));
}

setInterval(fetchNews, 20 * 60 * 1000);
fetchNews();

// --- API МАРШРУТИ ---
app.get("/api/news", (req, res) => {
  const news = safeRead(NEWS_FILE, []).map(n => ({
    ...n,
    displayDate: new Date(n.date).toLocaleString("uk-UA", {
      timeZone: "Europe/Berlin",
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
    })
  }));
  res.json(news);
});

app.get("/api/guide", (_, res) => res.json(safeRead(GUIDE_FILE, defaultGuide)));

app.post("/api/taxi", async (req, res) => {
  const { fax, userName, userContact, message } = req.body;
  if (fax) {
    await writeLog(`🛡️ БОТ ЗАБЛОКОВАНИЙ (Honeypot). IP: ${getIP(req)}`, "WARN");
    return res.json({ success: true });
  }
  await writeLog(`📩 ПОВІДОМЛЕННЯ:\n👤 ${userName}\n📞 ${userContact}\n💬 ${message}`, "MSG");
  res.json({ success: true });
});

app.post("/api/admin/login", async (req, res) => {
  const ip = getIP(req);
  const sec = safeRead(BLOCKS_FILE, { attempts: {}, blocked: {} });

  if (sec.blocked[ip] && Date.now() < sec.blocked[ip])
    return res.status(403).json({ error: "Ви заблоковані на годину" });

  if (req.body.pass === ADMIN_PASSWORD) {
    sec.attempts[ip] = 0;
    safeWrite(BLOCKS_FILE, sec);
    await writeLog(`🔓 Вхід в адмінку. IP: ${ip}`, "SUCCESS");
    return res.json({ success: true });
  }

  sec.attempts[ip] = (sec.attempts[ip] || 0) + 1;
  if (sec.attempts[ip] >= 3) {
    sec.blocked[ip] = Date.now() + 3600000;
    await writeLog(`🚨 БЛОКУВАННЯ IP ${ip} (3 невдалі спроби)`, "ALERT");
  }
  safeWrite(BLOCKS_FILE, sec);
  res.status(401).json({ error: "Невірний пароль" });
});

app.post("/api/guide/update", (req, res) => {
  if (req.body.pass !== ADMIN_PASSWORD) return res.status(401).send();
  safeWrite(GUIDE_FILE, req.body.guideData);
  writeLog("📘 Оновлено довідник", "SUCCESS");
  res.json({ success: true });
});

app.post("/api/news/add", upload.single("image"), (req, res) => {
  if (req.body.pass !== ADMIN_PASSWORD) return res.status(401).send();
  const news = safeRead(NEWS_FILE, []);
  news.unshift({
    id: Date.now(),
    date: new Date().toISOString(),
    title: req.body.title,
    category: req.body.category,
    content: req.body.content.substring(0, 2000),
    img: req.file ? `assets/news/${req.file.filename}` : "assets/img/auto-news.jpg"
  });
  safeWrite(NEWS_FILE, news.slice(0, 150));
  res.json({ success: true });
});

app.get("/api/admin/logs", (req, res) => {
  if (req.query.pass !== ADMIN_PASSWORD) return res.status(401).send();
  fs.readFile(LOG_FILE, "utf-8", (err, data) => {
    res.send(err ? "Логи порожні" : data);
  });
});

// --- СТАТИКА ---
app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// --- СТАРТ ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server on port ${PORT}`);
  // Анти-сон для Render
  setInterval(() => {
    const host = process.env.RENDER_EXTERNAL_HOSTNAME;
    if (host) https.get(`https://${host}/`).on("error", () => {});
  }, 13 * 60 * 1000);
});
