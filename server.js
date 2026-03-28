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

// --- СИСТЕМА СПОВІЩЕНЬ ---
const sendToTg = async (msg, type = "INFO") => {
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: `<b>[${type}]</b>\n${msg}`,
            parse_mode: "HTML"
        });
    } catch (e) {}
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

// --- ГРАБЕР (ПОКРАЩЕНИЙ) ---
async function autoFetchNews() {
    console.log("🔄 Початок оновлення бази новин...");
    try {
        const fileData = fs.readFileSync(NEWS_FILE, "utf-8");
        let news = JSON.parse(fileData || "[]");
        let addedCount = 0;

        for (const source of RSS_SOURCES) {
            try {
                console.log(`📡 Запитую: ${source.name}`);
                const response = await axios.get(source.url, { 
                    timeout: 20000, 
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' } 
                });
                const feed = await parser.parseString(response.data);

                for (const item of feed.items) {
                    if (!news.some(n => n.title === item.title)) {
                        
                        let titleUA = item.title.trim();
                        let contentRaw = (item.contentSnippet || item.content || "").replace(/<[^>]*>?/gm, '').trim();

                        // Виправляємо дату: беремо час публікації
                        const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
                        const newsId = pubDate.getTime() + Math.floor(Math.random() * 1000);

                        // Переклад
                        if (source.translate && titleUA) {
                            try {
                                const tr = await translate([titleUA, contentRaw], { 
                                    from: 'de', 
                                    to: 'uk'
                                });
                                if (tr && tr.length >= 2) {
                                    titleUA = tr[0]; 
                                    contentRaw = tr[1];
                                }
                            } catch (e) { 
                                console.error(`⚠️ Помилка перекладу для ${source.name}. Лишаю оригінал.`); 
                            }
                        }

                        news.push({
                            id: newsId,
                            date: pubDate.toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' }),
                            title: titleUA,
                            category: source.name,
                            img: "assets/img/auto-news.jpg",
                            content: contentRaw.substring(0, 500) + "...",
                            link: item.link
                        });
                        addedCount++;
                        
                        // Затримка для Google Translate
                        await new Promise(r => setTimeout(r, 800));
                    }
                }
            } catch (err) { console.error(`❌ Помилка джерела ${source.name}: ${err.message}`); }
        }

        if (addedCount > 0) {
            // Математичне сортування: нові зверху
            news.sort((a, b) => Number(b.id) - Number(a.id));
            
            // Очищення старих (старше 10 днів)
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
