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
// Налаштовуємо парсер на максимальний пошук полів
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
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
    return true;
  } catch (e) {
    try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] [ERROR] Write JSON failed: ${e.message}\n`); } catch {}
    return false;
  }
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
      chat_id: CHAT_ID,
      text,
      parse_mode: "HTML"
    }, { timeout: 8000 });
  } catch (e) {
    try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] [WARN] Telegram send failed: ${e.message}\n`); } catch {}
  }
};

const writeLog = async (msg, type = "INFO") => {
  try {
    const time = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' });
    fs.appendFileSync(LOG_FILE, `[${time}] [${type}] ${msg}\n`);
  } catch (e) {
    console.error("Failed to append log:", e);
  }

  if (["ALERT", "WARN", "SUCCESS", "MSG"].includes(type)) {
    await sendTelegram(`<b>ПОРТАЛ LIVE:</b>\n${msg}`);
  }
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

// --- ГРАБЕР (З "ZAXID.NET" ВИДАЛЕНО) ---
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
        const res = await axios.get(s.u, {
          timeout: 12000,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
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
          } catch (inner) {
            // ignore single item errors
          }
        });
      } catch (e) {
        await writeLog(`Error fetching source ${s.n}: ${e.message || e}`, "WARN");
      }
    }

    const now = Date.now();
    news = news.filter(n => (now - n.id) < 172800000);
    news.sort((a, b) => b.id - a.id);
    news = news.slice(0, 150);

    safeWriteJson(NEWS_FILE, news);
  } catch (e) {
    await writeLog(`autoFetchNews failed: ${e.message || e}`, "WARN");
  }
}

setInterval(autoFetchNews, 20 * 60 * 1000);
setTimeout(autoFetchNews, 3000);

// --- API ---
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
    await writeLog(`Taxi endpoint error: ${e.message || e}`, "WARN");
    res.status(500).json({ success: false });
  }
});

// --- АДМІН ЛОГІН (3 СПРОБИ + БАН) ---
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

  if (!ADMIN_PASSWORD) {
    await writeLog(`Спроба входу без налаштованого ADMIN_PASSWORD. IP: ${ip}`, "WARN");
    return res.status(500).json({ error: "Server misconfiguration" });
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

// Статика
app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// --- СТАРТ СЕРВЕРА ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("LIVE SERVER READY on port", PORT);

  const pingHostRaw = process.env.RENDER_EXTERNAL_HOSTNAME || process.env.PING_HOST || "";
  if (pingHostRaw) {
    const pingUrl = pingHostRaw.startsWith("http://") || pingHostRaw.startsWith("https://")
      ? pingHostRaw
      : `https://${pingHostRaw}`;
    setInterval(() => {
      try {
        if (pingUrl.startsWith("https://")) {
          https.get(pingUrl, () => {}).on('error', () => {});
        } else {
          http.get(pingUrl, () => {}).on('error', () => {});
        }
      } catch (e) {}
    }, 12 * 60 * 1000);
  }
});
