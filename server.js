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

// --- БЕЗПЕКА (HELMET + RATE LIMIT) ---
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 150,
    message: "Забагато запитів від вас. Спробуйте через 15 хвилин."
});
app.use("/api/", apiLimiter);

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(NEWS_FILE)) fs.writeFileSync(NEWS_FILE, JSON.stringify([]));

// --- СИСТЕМА СПОВІЩЕНЬ В TELEGRAM ---
const sendToTg = async (msg, type = "INFO") => {
    const icons = { INFO: "ℹ️", WARN: "⚠️", ALERT: "🛑", SUCCESS: "✅" };
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: `${icons[type] || "🔔"} <b>ПОРТАЛ LIVE:</b>\n${msg}`,
            parse_mode: "HTML"
        });
    } catch (e) { console.error("TG Error"); }
};

// --- АВТО-ГРАБЕР (ОЧИЩЕННЯ + ПЕРЕКЛАД) ---
const RSS_SOURCES = [
    { name: "DW Німеччина", url: "https://rss.dw.com/xml/rss-ukr-all", translate: false },
    { name: "Дрезден Офіційно", url: "https://www.dresden.de/rss/de/presseservice.xml", translate: true }
];

async function autoFetchNews() {
    console.log("🔄 Початок циклу збору новин...");
    try {
        const fileData = fs.readFileSync(NEWS_FILE, "utf-8");
        let news = JSON.parse(fileData || "[]");
        let addedCount = 0;

        for (const source of RSS_SOURCES) {
            try {
                const response = await axios.get(source.url, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
                const feed = await parser.parseString(response.data);

                for (const item of feed.items) {
                    if (!news.some(n => n.title === item.title)) {
                        let titleUA = item.title;
                        let contentRaw = (item.contentSnippet || item.content || "").replace(/<[^>]*>?/gm, '');

                        if (source.translate) {
                            try {
                                const tr = await translate([titleUA, contentRaw], { to: "uk" });
                                titleUA = tr[0]; contentRaw = tr[1];
                            } catch (e) { console.log("Переклад не вдався"); }
                        }

                        news.push({
                            id: Date.now() + Math.floor(Math.random() * 1000),
                            date: new Date(item.pubDate || Date.now()).toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' }),
                            title: titleUA.trim(),
                            category: source.name,
                            img: "assets/img/auto-news.jpg",
                            content: contentRaw.substring(0, 450) + "...",
                            link: item.link
                        });
                        addedCount++;
                    }
                }
            } catch (err) { console.error(`❌ Помилка ${source.name}: ${err.message}`); }
        }

        // 🧹 ОЧИЩЕННЯ: Видаляємо старіше 10 днів та сортуємо
        const tenDaysAgo = Date.now() - (10 * 24 * 60 * 60 * 1000);
        let cleanedNews = news.filter(n => n.id > tenDaysAgo);
        cleanedNews.sort((a, b) => b.id - a.id);

        fs.writeFileSync(NEWS_FILE, JSON.stringify(cleanedNews.slice(0, 100), null, 2));
        if (addedCount > 0) console.log(`✅ Додано нових новин: ${addedCount}`);
    } catch (err) { console.error("Критична помилка грабера"); }
}

setInterval(autoFetchNews, 3 * 60 * 60 * 1000); // 3 години
setTimeout(autoFetchNews, 5000); // через 5 сек після старту

// --- МАРШРУТИ ---

// Безпечний проксі для погоди
app.get("/api/weather", async (req, res) => {
    try {
        const url = `https://api.openweathermap.org/data/2.5/weather?q=Dresden&appid=${WEATHER_KEY}&units=metric&lang=uk`;
        const response = await axios.get(url);
        res.json(response.data);
    } catch (e) { res.status(500).json({ error: "Помилка погоди" }); }
});

app.get("/api/news", (req, res) => {
    try {
        let news = JSON.parse(fs.readFileSync(NEWS_FILE, "utf-8") || "[]");
        res.json(news);
    } catch (err) { res.status(500).send("Error"); }
});

// Захист від сканерів
app.use((req, res, next) => {
    const suspiciousPaths = ['.env', '.php', 'wp-admin', 'setup', 'config', '.git', 'package-lock.json'];
    if (suspiciousPaths.some(p => req.url.toLowerCase().includes(p))) {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        sendToTg(`🔍 <b>СКАНЕР:</b> Бот з IP <code>${ip}</code> шукав <code>${req.url}</code>`, "WARN");
        return res.status(403).send("Forbidden");
    }
    next();
});

app.post('/api/admin/login', (req, res) => {
    const { pass } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    if (pass === ADMIN_PASSWORD) {
        sendToTg(`🔓 Успішний вхід в адмінку з IP: ${ip}`, "SUCCESS");
        return res.json({ success: true });
    } else {
        sendToTg(`🧨 Невдала спроба входу! IP: ${ip}\nПароль: <code>${pass}</code>`, "ALERT");
        return res.status(401).json({ error: "Невірний пароль" });
    }
});

// Статика
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname, "assets")));
app.use("/uploads", express.static(uploadDir));
app.use("/api/news", newsRoutes);
app.use("/api/taxi", taxiRoute);

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`--- ПОРТАЛ LIVE ДРЕЗДЕН ЗАПУЩЕНО ---`);
    // Keep-alive пінг
    setInterval(() => {
        https.get("https://news2-9mlo.onrender.com/", (res) => {}).on("error", () => {});
    }, 10 * 60 * 1000); 
});
