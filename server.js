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
const NEWS_FILE = path.join(__dirname, "news-data.json");
const uploadDir = path.join(__dirname, "uploads");

// --- БАЗОВІ НАЛАШТУВАННЯ ---
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json()); // Цей рядок обов'язковий для читання даних з форми!

// --- СИСТЕМА СПОВІЩЕНЬ ---
const sendToTg = async (msg, type = "INFO") => {
    const icons = { INFO: "ℹ️", WARN: "⚠️", ALERT: "🚨", SUCCESS: "✅", MSG: "📩" };
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: `${icons[type] || "🔔"} <b>ПОРТАЛ LIVE:</b>\n${msg}`,
            parse_mode: "HTML"
        });
        console.log(`✅ Повідомлення ${type} пішло в ТГ`);
    } catch (e) {
        console.error("❌ Помилка ТГ:", e.message);
    }
};

// --- ОБРОБКА ФОРМИ (ЗАЛІЗОБЕТОННА) ---
app.post("/api/taxi", async (req, res) => {
    console.log("📥 Отримано запит на /api/taxi:", req.body);
    
    try {
        const { name, phone, address, comment } = req.body;
        
        if (!name || !phone) {
            return res.status(400).json({ error: "Ім'я та телефон обов'язкові" });
        }

        const msg = `📬 <b>НОВЕ ПОВІДОМЛЕННЯ:</b>\n\n` +
                    `👤 <b>Ім'я:</b> ${name}\n` +
                    `📞 <b>Тел:</b> ${phone}\n` +
                    `📍 <b>Тема:</b> ${address || "Контактна форма"}\n` +
                    `💬 <b>Текст:</b> ${comment || "-"}`;
        
        // ЧЕКАЄМО ВІДПРАВКИ
        await sendToTg(msg, "MSG");
        
        // ВІДПОВІДАЄМО САЙТУ
        return res.json({ success: true });
        
    } catch (err) {
        console.error("🔥 Помилка обробки форми:", err);
        return res.status(500).json({ error: "Помилка сервера" });
    }
});

// --- АНТИ-СОН ---
const keepAlive = () => {
    setInterval(() => {
        https.get("https://news2-9mlo.onrender.com/", (res) => {
            console.log("☕️ Будильник працює");
        }).on("error", () => {});
    }, 13 * 60 * 1000); 
};

// --- ГРАБЕР НОВИН (10 хв) ---
const RSS_SOURCES = [
    { name: "ТСН Україна", url: "https://tsn.ua/rss/full.rss" },
    { name: "MDR Саксонія", url: "https://www.mdr.de/nachrichten/sachsen/index-rss.xml" },
    { name: "Дрезден Офіційно", url: "https://www.dresden.de/rss/de/presseservice.xml" },
    { name: "TAG24 Дрезден", url: "https://www.tag24.de/dresden/rss" },
    { name: "DW Німеччина", url: "https://rss.dw.com/xml/rss-ukr-all" }
];

async function autoFetchNews() {
    try {
        if (!fs.existsSync(NEWS_FILE)) fs.writeFileSync(NEWS_FILE, "[]");
        const fileData = fs.readFileSync(NEWS_FILE, "utf-8");
        let news = JSON.parse(fileData || "[]");
        let addedCount = 0;

        for (const source of RSS_SOURCES) {
            try {
                const response = await axios.get(source.url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
                const feed = await parser.parseString(response.data);
                for (const item of feed.items) {
                    if (!news.some(n => n.title === item.title)) {
                        const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
                        news.push({
                            id: pubDate.getTime() + Math.floor(Math.random() * 1000),
                            date: pubDate.toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' }),
                            title: item.title.trim(),
                            category: source.name,
                            img: "assets/img/auto-news.jpg",
                            content: (item.contentSnippet || item.content || "").replace(/<[^>]*>?/gm, '').trim().substring(0, 450) + "...",
                            link: item.link
                        });
                        addedCount++;
                    }
                }
            } catch (err) {}
        }
        if (addedCount > 0) {
            news.sort((a, b) => b.id - a.id);
            fs.writeFileSync(NEWS_FILE, JSON.stringify(news.slice(0, 100), null, 2));
        }
    } catch (err) {}
}

setInterval(autoFetchNews, 10 * 60 * 1000);
setTimeout(autoFetchNews, 5000);

// --- ІНШІ МАРШРУТИ ---
app.get("/api/news", (req, res) => {
    try {
        const data = fs.readFileSync(NEWS_FILE, "utf-8");
        res.json(JSON.parse(data || "[]"));
    } catch (e) { res.json([]); }
});

app.post('/api/admin/login', async (req, res) => {
    if (req.body.pass === ADMIN_PASSWORD) return res.json({ success: true });
    return res.status(401).json({ error: "Error" });
});

// ПІДКЛЮЧЕННЯ ПАПОК ТА РОУТІВ
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname, "assets")));
app.use("/api/news", newsRoutes);
app.use("/api/taxi", taxiRoute);

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`--- СЕРВЕР ЗАПУЩЕНО ---`);
    await sendToTg("🚀 Сервер успішно запущений!", "INFO");
    keepAlive();
});
