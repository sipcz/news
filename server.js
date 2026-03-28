import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import https from "https"; 
import fs from "fs";
import axios from "axios";
import Parser from "rss-parser";
import helmet from "helmet"; // Захист від хакерських атак на заголовки
import rateLimit from "express-rate-limit"; // Обмеження частоти запитів
import translate from "translate-google-api"; // Авто-переклад

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import newsRoutes from "./routes/news.js";
import taxiRoute from "./routes/taxi.js";

const app = express();
const parser = new Parser();

// --- БЕЗПЕКА ТА НАЛАШТУВАННЯ ---
app.use(helmet({ contentSecurityPolicy: false })); // Базовий захист
app.use(cors());
app.use(express.json());

// Обмеження запитів: захист від DDoS
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 хвилин
    max: 100, // максимум 100 запитів з одного IP
    message: "Забагато запитів, спробуйте пізніше."
});
app.use("/api/", limiter);

// Секретні дані (краще вказувати в Dashboard Render -> Environment Variables)
const BOT_TOKEN = process.env.BOT_TOKEN || "8381037035:AAGhfS8LbZQCgPf_oAVyvG9tXDLtfAxGVug";
const CHAT_ID = process.env.CHAT_ID || "8257665442";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "pedro2026";
const NEWS_FILE = path.join(__dirname, "news-data.json");
const uploadDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(NEWS_FILE)) fs.writeFileSync(NEWS_FILE, JSON.stringify([]));

// --- ТЕЛЕГРАМ-ЛОГУВАННЯ ---
const sendToTg = async (msg) => {
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: `🔔 <b>ПОРТАЛ LIVE:</b>\n${msg}`,
            parse_mode: "HTML"
        });
    } catch (e) { console.error("TG Error"); }
};

// --- АВТО-ГРАБЕР З ПЕРЕКЛАДОМ ---
const RSS_SOURCES = [
    { name: "DW Німеччина", url: "https://rss.dw.com/xml/rss-ukr-all", translate: false },
    { name: "Дрезден Офіційно", url: "https://www.dresden.de/rss/de/presseservice.xml", translate: true }
];

async function autoFetchNews() {
    console.log("🔄 Запуск збору новин...");
    try {
        const fileData = fs.readFileSync(NEWS_FILE, "utf-8");
        let news = JSON.parse(fileData || "[]");
        let addedCount = 0;

        for (const source of RSS_SOURCES) {
            try {
                // Пробиваємо "стіну" Дрездена через Axios
                const response = await axios.get(source.url, {
                    headers: { 'User-Agent': 'Mozilla/5.0 Chrome/122.0.0.0 Safari/537.36' }
                });
                const feed = await parser.parseString(response.data);

                for (const item of feed.items) {
                    if (!news.some(n => n.title === item.title)) {
                        let titleUA = item.title;
                        let contentRaw = (item.contentSnippet || item.content || "").replace(/<[^>]*>?/gm, '');
                        
                        // Якщо джерело німецьке — перекладаємо
                        if (source.translate) {
                            try {
                                const tr = await translate([titleUA, contentRaw], { to: "uk" });
                                titleUA = tr[0];
                                contentRaw = tr[1];
                            } catch (e) { console.log("Переклад не вдався, лишаю оригінал"); }
                        }

                        news.push({
                            id: Date.now() + Math.floor(Math.random() * 1000),
                            date: new Date(item.pubDate || Date.now()).toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' }),
                            title: titleUA.trim(),
                            category: source.name,
                            img: "assets/img/auto-news.jpg",
                            content: contentRaw.substring(0, 400) + "...",
                            link: item.link
                        });
                        addedCount++;
                    }
                }
            } catch (err) { console.error(`❌ Помилка ${source.name}: ${err.message}`); }
        }

        if (addedCount > 0) {
            news.sort((a, b) => b.id - a.id);
            fs.writeFileSync(NEWS_FILE, JSON.stringify(news.slice(0, 100), null, 2));
            console.log(`✅ Додано ${addedCount} новин.`);
        }
    } catch (err) { console.error("Грабер впав:", err.message); }
}

setInterval(autoFetchNews, 3 * 60 * 60 * 1000);
setTimeout(autoFetchNews, 5000);

// --- МАРШРУТИ ---

app.get("/api/news", (req, res) => {
    try {
        let news = JSON.parse(fs.readFileSync(NEWS_FILE, "utf-8") || "[]");
        news.sort((a, b) => b.id - a.id);
        res.json(news);
    } catch (err) { res.status(500).send("Error"); }
});

app.post('/api/admin/login', (req, res) => {
    const { pass } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    if (pass === ADMIN_PASSWORD) {
        sendToTg(`✅ Успішний вхід в адмінку! IP: ${ip}`);
        return res.json({ success: true });
    } else {
        sendToTg(`⚠️ Спроба зламу! Невірний пароль з IP: ${ip}`);
        return res.status(401).json({ error: "Невірний пароль" });
    }
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
    // Самопінг
    setInterval(() => {
        https.get("https://news2-9mlo.onrender.com/", (res) => {}).on("error", () => {});
    }, 10 * 60 * 1000); 
});
