import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import https from "https"; 
import fs from "fs";
import axios from "axios";
import Parser from "rss-parser";

// Налаштування шляхів для ES-модулів
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
const NEWS_FILE = "./news-data.json";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "pedro2026";

// 📁 ПЕРЕВІРКА ПАПОК ТА ФАЙЛІВ
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
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
        } catch (e) { console.error("TG Log Error"); }
    }
};

// 🆕 АВТО-ГРАБЕР НОВИН
const RSS_SOURCES = [
    { name: "DW Німеччина", url: "https://rss.dw.com/xml/rss-ukr-all" },
    { name: "Дрезден Офіційно", url: "https://www.dresden.de/rss/de/presseservice.xml" }
];

async function autoFetchNews() {
    console.log("🔄 Запуск грабера новин...");
    try {
        const fileData = fs.readFileSync(NEWS_FILE, "utf-8");
        let news = JSON.parse(fileData || "[]");
        let addedCount = 0;

        for (const source of RSS_SOURCES) {
            const feed = await parser.parseURL(source.url);
            
            feed.items.forEach(item => {
                if (!news.some(n => n.title === item.title)) {
                    news.push({
                        id: Date.now() + Math.floor(Math.random() * 1000),
                        date: new Date(item.pubDate || Date.now()).toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' }),
                        title: item.title,
                        category: source.name,
                        img: "assets/img/auto-news.jpg",
                        content: item.contentSnippet || "Деталі читайте на сайті джерела.",
                        link: item.link
                    });
                    addedCount++;
                }
            });
        }

        if (addedCount > 0) {
            const finalNews = news.slice(-100); // Лишаємо 100 останніх
            fs.writeFileSync(NEWS_FILE, JSON.stringify(finalNews, null, 2));
            console.log(`✅ Додано ${addedCount} нових статей.`);
        }
    } catch (err) { console.error("❌ Помилка грабера:", err.message); }
}

// Інтервали для грабера
setInterval(autoFetchNews, 3 * 60 * 60 * 1000); // 3 години
setTimeout(autoFetchNews, 5000); // Через 5 сек після старту

// --- МАРШРУТИ ---

// Захист від сканерів
app.use((req, res, next) => {
    const suspicious = ['.env', '.php', 'wp-admin', 'setup'];
    if (suspicious.some(p => req.url.includes(p))) {
        const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
        logSecurity("SCANNER", ip, `Шукав: ${req.url}`);
    }
    next();
});

app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname, "assets")));
app.use("/uploads", express.static(uploadDir));

app.use("/api/news", newsRoutes);
app.use("/api/taxi", taxiRoute);

app.post('/api/admin/login', (req, res) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
    const { pass } = req.body;
    const now = Date.now();

    if (ADMIN_BLOCKED.has(ip) && now < ADMIN_BLOCKED.get(ip)) {
        return res.status(403).json({ error: "Ваш IP заблоковано!" });
    }

    if (pass === ADMIN_PASSWORD) {
        logSecurity("ATTEMPT", ip, "Успішний вхід ✅");
        ADMIN_ATTEMPTS.delete(ip);
        return res.json({ success: true });
    } else {
        const attempts = (ADMIN_ATTEMPTS.get(ip) || 0) + 1;
        ADMIN_ATTEMPTS.set(ip, attempts);
        logSecurity("ATTEMPT", ip, `Невірний пароль (${attempts}/${MAX_ADMIN_ATTEMPTS})`);

        if (attempts >= MAX_ADMIN_ATTEMPTS) {
            ADMIN_BLOCKED.set(ip, now + ADMIN_BLOCK_TIME);
            logSecurity("BLOCK", ip, "IP ЗАБАНЕНО НА ГОДИНУ 🚫");
        }
        return res.status(401).json({ error: "Невірний пароль" });
    }
});

app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/admin-taxi", (req, res) => res.sendFile(path.join(__dirname, "public", "admin-taxi.html")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`--- ПОРТАЛ LIVE ДРЕЗДЕН ЗАПУЩЕНО ---`);
    
    // Самопінг
    setInterval(() => {
        https.get("https://news2-9mlo.onrender.com/", (res) => {
            if(res.statusCode === 200) console.log("KEEP-ALIVE: OK");
        }).on("error", () => {});
    }, 10 * 60 * 1000); 
});
