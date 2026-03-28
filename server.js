import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import https from "https"; 
import fs from "fs";
import axios from "axios";
import Parser from "rss-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import translate from "translate-google-api";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import newsRoutes from "./routes/news.js";
import taxiRoute from "./routes/taxi.js";

const app = express();
const parser = new Parser();

// --- КОНФІГУРАЦІЯ ---
const BOT_TOKEN = process.env.BOT_TOKEN || "8381037035:AAGhfS8LbZQCgPf_oAVyvG9tXDLtfAxGVug";
const CHAT_ID = process.env.CHAT_ID || "8257665442";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "pedro2026";
const WEATHER_KEY = process.env.WEATHER_KEY || "42861347098e94589d9016e114030671";
const NEWS_FILE = path.join(__dirname, "news-data.json");
const uploadDir = path.join(__dirname, "uploads");

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

// 1. Загальний лімітер для всього сайту
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200, 
    message: "Захист активний. Спробуйте пізніше."
});
app.use("/api/", apiLimiter);

// 2. СУВОРИЙ лімітер для логіну (5 спроб) - ЗАХИСТ ВІД БРУТФОРСУ
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5, 
    message: { error: "Забагато спроб! Доступ заблоковано на 15 хвилин." },
    standardHeaders: true,
    legacyHeaders: false,
});

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(NEWS_FILE)) fs.writeFileSync(NEWS_FILE, JSON.stringify([]));

// --- СИСТЕМА СПОВІЩЕНЬ ---
const sendToTg = async (msg, type = "INFO") => {
    const icons = { INFO: "ℹ️", WARN: "⚠️", ALERT: "🚨", SUCCESS: "✅" };
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: `${icons[type] || "🔔"} <b>ПОРТАЛ LIVE:</b>\n${msg}`,
            parse_mode: "HTML"
        });
    } catch (e) {
        console.error("❌ TG ERROR:", e.response ? e.response.data : e.message);
    }
};

// --- ДЖЕРЕЛА НОВИН ---
const RSS_SOURCES = [
    { name: "ТСН Україна", url: "https://tsn.ua/rss/full.rss", translate: false },
    { name: "DW Німеччина", url: "https://rss.dw.com/xml/rss-ukr-all", translate: false },
    { name: "Дрезден Офіційно", url: "https://www.dresden.de/rss/de/presseservice.xml", translate: true },
    { name: "MDR Саксонія", url: "https://www.mdr.de/nachrichten/sachsen/index-rss.xml", translate: true },
    { name: "TAG24 Дрезден", url: "https://www.tag24.de/dresden/rss", translate: true },
    { name: "Радіо Свобода", url: "https://www.radiosvoboda.org/api/z-rq-v-iy-t", translate: false }
];

async function autoFetchNews() {
    console.log("🔄 Оновлення бази новин...");
    try {
        const fileData = fs.readFileSync(NEWS_FILE, "utf-8");
        let news = JSON.parse(fileData || "[]");
        let addedCount = 0;

        for (const source of RSS_SOURCES) {
            try {
                const response = await axios.get(source.url, { 
                    timeout: 20000, 
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' } 
                });
                const feed = await parser.parseString(response.data);

                for (const item of feed.items) {
                    if (!news.some(n => n.title === item.title)) {
                        let titleUA = item.title.trim();
                        let contentRaw = (item.contentSnippet || item.content || "").replace(/<[^>]*>?/gm, '').trim();
                        const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();

                        if (source.translate && titleUA) {
                            try {
                                const tr = await translate([titleUA, contentRaw], { from: 'de', to: 'uk' });
                                if (tr && tr.length >= 2) { titleUA = tr[0]; contentRaw = tr[1]; }
                            } catch (e) {}
                        }

                        news.push({
                            id: pubDate.getTime() + Math.floor(Math.random() * 1000),
                            date: pubDate.toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' }),
                            title: titleUA,
                            category: source.name,
                            img: "assets/img/auto-news.jpg",
                            content: contentRaw.substring(0, 500) + "...",
                            link: item.link
                        });
                        addedCount++;
                        await new Promise(r => setTimeout(r, 800));
                    }
                }
            } catch (err) { console.error(`❌ Помилка ${source.name}`); }
        }

        if (addedCount > 0) {
            news.sort((a, b) => Number(b.id) - Number(a.id));
            const tenDaysAgo = Date.now() - (10 * 24 * 60 * 60 * 1000);
            const finalNews = news.filter(n => n.id > tenDaysAgo).slice(0, 100);
            fs.writeFileSync(NEWS_FILE, JSON.stringify(finalNews, null, 2));
            console.log(`✅ Додано новин: ${addedCount}`);
        }
    } catch (err) { console.error("Помилка грабера."); }
}

setInterval(autoFetchNews, 3 * 60 * 60 * 1000);
setTimeout(autoFetchNews, 5000);

// --- МАРШРУТИ ---

app.get("/api/weather", async (req, res) => {
    try {
        const url = `https://api.openweathermap.org/data/2.5/weather?q=Dresden&appid=${WEATHER_KEY}&units=metric&lang=uk`;
        const response = await axios.get(url);
        res.json(response.data);
    } catch (e) { res.status(500).json({ error: "error" }); }
});

app.get("/api/news", (req, res) => {
    try {
        let news = JSON.parse(fs.readFileSync(NEWS_FILE, "utf-8") || "[]");
        news.sort((a, b) => Number(b.id) - Number(a.id));
        res.json(news);
    } catch (err) { res.status(500).send("Error"); }
});

// Захист від сканерів
app.use((req, res, next) => {
    const badPaths = ['.env', '.php', 'wp-admin', 'config', 'setup'];
    if (badPaths.some(p => req.url.toLowerCase().includes(p))) {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        sendToTg(`🧨 <b>БЛОКУВАННЯ:</b> Спроба сканування <code>${req.url}</code>\nIP: <code>${ip}</code>`, "ALERT");
        return res.status(403).send("Access Denied");
    }
    next();
});

// Застосовуємо суворий лімітер до маршрутів входу
app.post('/api/admin/login', loginLimiter, (req, res) => {
    const { pass } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    if (pass === ADMIN_PASSWORD) {
        sendToTg(`✅ Успішний вхід в адмінку!\nIP: <code>${ip}</code>`, "SUCCESS");
        return res.json({ success: true });
    } else {
        sendToTg(`🧨 Невдала спроба входу!\nIP: <code>${ip}</code>\nПароль: <code>${pass}</code>`, "ALERT");
        return res.status(401).json({ error: "Error" });
    }
});

// Захищаємо також вхід у таксі-адмінку
app.post('/api/taxi/admin', loginLimiter); 

app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname, "assets")));
app.use("/uploads", express.static(uploadDir));
app.use("/api/news", newsRoutes);
app.use("/api/taxi", taxiRoute);

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`--- ПОРТАЛ LIVE ДРЕЗДЕН АКТИВНИЙ ---`);
    sendToTg("🚀 Сервер успішно запущений!", "INFO");
});
