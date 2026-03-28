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

// 🛠️ ОСЬ ТУТ МИ ПРОПИСУЄМО USER-AGENT
const parser = new Parser({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
    }
});

app.use(cors());
app.use(express.json());

const BOT_TOKEN = "8381037035:AAGhfS8LbZQCgPf_oAVyvG9tXDLtfAxGVug";
const CHAT_ID = "8257665442";
const NEWS_FILE = path.join(__dirname, "news-data.json");
const uploadDir = path.join(__dirname, "uploads");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "pedro2026";

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(NEWS_FILE)) fs.writeFileSync(NEWS_FILE, JSON.stringify([]));

// 🆕 АВТО-ГРАБЕР НОВИН
const RSS_SOURCES = [
    { name: "DW Німеччина", url: "https://rss.dw.com/xml/rss-ukr-all" },
    { name: "Дрезден Офіційно", url: "https://www.dresden.de/rss/de/presseservice.xml" }
];

async function autoFetchNews() {
    console.log("🔄 Спроба оновлення новин...");
    try {
        const fileData = fs.readFileSync(NEWS_FILE, "utf-8");
        let news = JSON.parse(fileData || "[]");
        let addedCount = 0;

        for (const source of RSS_SOURCES) {
            try {
                console.log(`📡 Запитую: ${source.name}`);
                const feed = await parser.parseURL(source.url);
                
                feed.items.forEach(item => {
                    if (!news.some(n => n.title === item.title)) {
                        const rawContent = item.contentSnippet || item.content || "";
                        const cleanContent = rawContent.replace(/<[^>]*>?/gm, '').substring(0, 400);

                        news.push({
                            // ID як число для точного сортування
                            id: Date.now() + Math.floor(Math.random() * 1000),
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
            } catch (err) {
                console.error(`❌ Помилка джерела ${source.name}: ${err.message}`);
            }
        }

        if (addedCount > 0) {
            // Сортуємо: свіжі (найбільший ID) зверху
            news.sort((a, b) => b.id - a.id);
            const finalNews = news.slice(0, 100);
            fs.writeFileSync(NEWS_FILE, JSON.stringify(finalNews, null, 2));
            console.log(`✅ Додано ${addedCount} нових статей.`);
        }
    } catch (err) { console.error("❌ Помилка грабера:", err.message); }
}

setInterval(autoFetchNews, 3 * 60 * 60 * 1000);
setTimeout(autoFetchNews, 10000);

// --- МАРШРУТИ ---

// Отримання новин із сортуванням
app.get("/api/news", (req, res) => {
    try {
        const data = fs.readFileSync(NEWS_FILE, "utf-8");
        let news = JSON.parse(data || "[]");
        // Подвійне сортування: нові зверху
        news.sort((a, b) => b.id - a.id);
        res.json(news);
    } catch (err) { res.status(500).send("Error"); }
});

app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname, "assets")));
app.use("/uploads", express.static(uploadDir));
app.use("/api/news", newsRoutes);
app.use("/api/taxi", taxiRoute);

app.post('/api/admin/login', (req, res) => {
    const { pass } = req.body;
    if (pass === ADMIN_PASSWORD) return res.json({ success: true });
    return res.status(401).json({ error: "Невірний пароль" });
});

app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/admin-taxi", (req, res) => res.sendFile(path.join(__dirname, "public", "admin-taxi.html")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`--- ПОРТАЛ LIVE ДРЕЗДЕН АКТИВНИЙ ---`);
    setInterval(() => {
        https.get("https://news2-9mlo.onrender.com/", (res) => {}).on("error", () => {});
    }, 10 * 60 * 1000); 
});
