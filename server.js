import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import https from "https"; 
import fs from "fs";
import axios from "axios";
import Parser from "rss-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import newsRoutes from "./routes/news.js";
import taxiRoute from "./routes/taxi.js";

const app = express();
const parser = new Parser();

app.use(cors());
app.use(express.json());

// ⚙️ НАЛАШТУВАННЯ
const BOT_TOKEN = "8381037035:AAGhfS8LbZQCgPf_oAVyvG9tXDLtfAxGVug";
const CHAT_ID = "8257665442";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "pedro2026";

// 📁 АБСОЛЮТНІ ШЛЯХИ (для стабільності на Render)
const NEWS_FILE = path.join(__dirname, "news-data.json");
const uploadDir = path.join(__dirname, "uploads");

// Перевірка папок
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(NEWS_FILE)) fs.writeFileSync(NEWS_FILE, JSON.stringify([]));

// 🛡️ СИСТЕМА БЕЗПЕКИ
const ADMIN_ATTEMPTS = new Map();
const ADMIN_BLOCKED = new Map();
const ADMIN_BLOCK_TIME = 60 * 60 * 1000; 
const MAX_ADMIN_ATTEMPTS = 5;

const logSecurity = async (type, ip, details) => {
    const now = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' });
    const icons = { BLOCK: "🛑", ATTEMPT: "⚠️", SCANNER: "🔍" };
    const message = `${icons[type] || 'ℹ️'} | ${now} | IP: ${ip} | ${details}`;
    
    console.log(message);

    if (type === "BLOCK" || details.includes("Успішний")) {
        try {
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                chat_id: CHAT_ID,
                text: `<b>БЕЗПЕКА САЙТУ</b>\n${message}`,
                parse_mode: "HTML"
            });
        } catch (e) { console.error("Помилка відправки логу в TG"); }
    }
};

// 🆕 АВТО-ГРАБЕР НОВИН (Виправлений)
const RSS_SOURCES = [
    { name: "DW Німеччина", url: "https://rss.dw.com/xml/rss-ukr-all" },
    { name: "Дрезден Офіційно", url: "https://www.dresden.de/rss/de/presseservice.xml" }
];

async function autoFetchNews() {
    console.log("🔄 Спроба оновлення новин через грабер...");
    try {
        const fileData = fs.readFileSync(NEWS_FILE, "utf-8");
        let news = JSON.parse(fileData || "[]");
        let addedCount = 0;

        for (const source of RSS_SOURCES) {
            try {
                const feed = await parser.parseURL(source.url);
                feed.items.forEach(item => {
                    // Перевірка на дублікати
                    if (!news.some(n => n.title === item.title)) {
                        // Очищення тексту від HTML-тегів (якщо приходять посилання або скрипти в описі)
                        const rawContent = item.contentSnippet || item.content || "";
                        const cleanContent = rawContent.replace(/<[^>]*>?/gm, '').substring(0, 400);

                        news.push({
                            id: (Date.now() + Math.floor(Math.random() * 1000)).toString(),
                            date: new Date(item.pubDate || Date.now()).toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' }),
                            title: item.title.trim(),
                            category: source.name,
                            img: "assets/img/auto-news.jpg",
                            content: cleanContent + "...",
                            link: item.link
                        });
                        addedCount++;
                    }
                });
            } catch (feedErr) {
                console.error(`Помилка джерела ${source.name}:`, feedErr.message);
            }
        }

        if (addedCount > 0) {
            const finalNews = news.slice(-100); 
            fs.writeFileSync(NEWS_FILE, JSON.stringify(finalNews, null, 2));
            console.log(`✅ Грабер: додано ${addedCount} статей.`);
        } else {
            console.log("ℹ️ Нових новин не знайдено.");
        }
    } catch (err) { console.error("❌ Критична помилка грабера:", err.message); }
}

// Запуск грабера кожні 3 години + перший запуск через 15 сек
setInterval(autoFetchNews, 3 * 60 * 60 * 1000);
setTimeout(autoFetchNews, 15000);

// --- МАРШРУТИ ---

// Захист від сканерів
app.use((req, res, next) => {
    const suspicious = ['.env', '.php', 'wp-admin', 'setup'];
    if (suspicious.some(p => req.url.toLowerCase().includes(p))) {
        const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
        logSecurity("SCANNER", ip, `Сканування шляху: ${req.url}`);
    }
    next();
});

app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname, "assets")));
app.use("/uploads", express.static(uploadDir));

app.use("/api/news", newsRoutes);
app.use("/api/taxi", taxiRoute);

// Авторизація
app.post('/api/admin/login', (req, res) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
    const { pass } = req.body;
    const now = Date.now();

    if (ADMIN_BLOCKED.has(ip) && now < ADMIN_BLOCKED.get(ip)) {
        return res.status(403).json({ error: "Доступ заблоковано. Спробуйте пізніше." });
    }

    if (pass === ADMIN_PASSWORD) {
        logSecurity("ATTEMPT", ip, "Успішний вхід ✅");
        ADMIN_ATTEMPTS.delete(ip);
        return res.json({ success: true });
    } else {
        const attempts = (ADMIN_ATTEMPTS.get(ip) || 0) + 1;
        ADMIN_ATTEMPTS.set(ip, attempts);
        logSecurity("ATTEMPT", ip, `Невдалий пароль (${attempts}/${MAX_ADMIN_ATTEMPTS})`);

        if (attempts >= MAX_ADMIN_ATTEMPTS) {
            ADMIN_BLOCKED.set(ip, now + ADMIN_BLOCK_TIME);
            logSecurity("BLOCK", ip, "IP АВТОМАТИЧНО ЗАБАНЕНО 🚫");
        }
        return res.status(401).json({ error: "Невірний пароль" });
    }
});

// Сторінки
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/admin-taxi", (req, res) => res.sendFile(path.join(__dirname, "public", "admin-taxi.html")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`--- ПОРТАЛ LIVE ДРЕЗДЕН АКТИВНИЙ ---`);
    
    // Самопінг для запобігання сну Render
    setInterval(() => {
        https.get("https://news2-9mlo.onrender.com/", (res) => {
            if(res.statusCode === 200) console.log("СЕРВЕР ПРАЦЮЄ (PING OK)");
        }).on("error", () => {});
    }, 10 * 60 * 1000); 
});
