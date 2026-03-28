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

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200, 
    message: "Захист активний. Спробуйте пізніше."
});
app.use("/api/", apiLimiter);

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(NEWS_FILE)) fs.writeFileSync(NEWS_FILE, JSON.stringify([]));

// --- ТЕЛЕГРАМ-ЛОГУВАННЯ ---
const sendToTg = async (msg, type = "INFO") => {
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: `<b>[${type}]</b>\n${msg}`,
            parse_mode: "HTML"
        });
    } catch (e) {}
};

// --- ДЖЕРЕЛА ---
const RSS_SOURCES = [
    { name: "DW Німеччина", url: "https://rss.dw.com/xml/rss-ukr-all", translate: false },
    { name: "Дрезден Офіційно", url: "https://www.dresden.de/rss/de/presseservice.xml", translate: true },
    { name: "MDR Саксонія", url: "https://www.mdr.de/nachrichten/sachsen/index-rss.xml", translate: true },
    { name: "TAG24 Дрезден", url: "https://www.tag24.de/dresden/rss", translate: true },
    { name: "Радіо Свобода", url: "https://www.radiosvoboda.org/api/z-rq-v-iy-t", translate: false }
];

// --- ГРАБЕР (FIXED) ---
async function autoFetchNews() {
    console.log("🔄 Початок оновлення бази новин...");
    try {
        const fileData = fs.readFileSync(NEWS_FILE, "utf-8");
        let news = JSON.parse(fileData || "[]");
        let addedCount = 0;

        for (const source of RSS_SOURCES) {
            try {
                // Використовуємо потужні заголовки для обходу блокувань
                const response = await axios.get(source.url, { 
                    timeout: 15000, 
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0' } 
                });
                const feed = await parser.parseString(response.data);

                for (const item of feed.items) {
                    if (!news.some(n => n.title === item.title)) {
                        
                        let titleUA = item.title;
                        let contentRaw = (item.contentSnippet || item.content || "").replace(/<[^>]*>?/gm, '');

                        // 🛠️ FIX 1: Реальна дата публікації замість часу завантаження
                        const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
                        const newsId = pubDate.getTime() + Math.floor(Math.random() * 1000);

                        // 🛠️ FIX 2: Примусовий переклад з німецької ('de')
                        if (source.translate) {
                            try {
                                console.log(`🤖 Перекладаю для: ${source.name}`);
                                const tr = await translate([titleUA, contentRaw], { 
                                    from: 'de', 
                                    to: 'uk',
                                    tld: 'de' // Використовуємо німецький домен Google для стабільності
                                });
                                titleUA = tr[0]; 
                                contentRaw = tr[1];
                            } catch (e) { 
                                console.error(`Помилка перекладу ${source.name}:`, e.message); 
                            }
                        }

                        news.push({
                            id: newsId, // Тепер ID — це реальний час публікації
                            date: pubDate.toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' }),
                            title: titleUA.trim(),
                            category: source.name,
                            img: "assets/img/auto-news.jpg",
                            content: contentRaw.substring(0, 450) + "...",
                            link: item.link
                        });
                        addedCount++;
                        
                        // Пауза 0.5с між новинами, щоб Google не забанив
                        await new Promise(r => setTimeout(r, 500));
                    }
                }
            } catch (err) { console.error(`❌ Помилка ${source.name}`); }
        }

        // 🧹 ОЧИЩЕННЯ: Видаляємо старе і сортуємо по-справжньому
        const tenDaysAgo = Date.now() - (10 * 24 * 60 * 60 * 1000);
        let finalNews = news.filter(n => n.id > tenDaysAgo);
        
        // Сортуємо математично: найбільший timestamp (найновіша новина) йде першим
        finalNews.sort((a, b) => Number(b.id) - Number(a.id));

        fs.writeFileSync(NEWS_FILE, JSON.stringify(finalNews.slice(0, 100), null, 2));
        if (addedCount > 0) console.log(`✅ Додано ${addedCount} новин.`);
        
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
        // Подвійне сортування на видачі для надійності
        news.sort((a, b) => Number(b.id) - Number(a.id));
        res.json(news);
    } catch (err) { res.status(500).send("Error"); }
});

// Захист від сканерів
app.use((req, res, next) => {
    const bad = ['.env', '.php', 'wp-admin', 'config'];
    if (bad.some(p => req.url.toLowerCase().includes(p))) {
        return res.status(403).send("Forbidden");
    }
    next();
});

app.post('/api/admin/login', (req, res) => {
    const { pass } = req.body;
    if (pass === ADMIN_PASSWORD) return res.json({ success: true });
    return res.status(401).json({ error: "Error" });
});

app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname, "assets")));
app.use("/uploads", express.static(uploadDir));
app.use("/api/news", newsRoutes);
app.use("/api/taxi", taxiRoute);

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`--- ПОРТАЛ LIVE ДРЕЗДЕН АКТИВНИЙ ---`);
    setInterval(() => {
        https.get("https://news2-9mlo.onrender.com/", (res) => {}).on("error", () => {});
    }, 10 * 60 * 1000); 
});
