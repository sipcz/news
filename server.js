import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import https from "https"; 
import fs from "fs";
import axios from "axios";
import Parser from "rss-parser";
import helmet from "helmet";
import multer from "multer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const parser = new Parser();

// --- КОНФІГУРАЦІЯ ---
const BOT_TOKEN = process.env.BOT_TOKEN || "8381037035:AAGhfS8LbZQCgPf_oAVyvG9tXDLtfAxGVug";
const CHAT_ID = process.env.CHAT_ID || "8257665442";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "pedro2026";
const NEWS_FILE = path.join(__dirname, "news-data.json");
const LOG_FILE = path.join(__dirname, "server.log");
const UPLOADS_DIR = path.join(__dirname, "assets/news");

// Ініціалізація папок та файлів
if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, "");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

// Налаштування завантаження фото
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// --- СИСТЕМА ЛОГУВАННЯ ---
const writeLog = async (msg, type = "INFO") => {
    const time = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' });
    const logEntry = `[${time}] [${type}] ${msg}\n`;
    fs.appendFileSync(LOG_FILE, logEntry);
    if (["ALERT", "WARN", "SUCCESS"].includes(type)) {
        try {
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                chat_id: CHAT_ID,
                text: `<b>БЕЗПЕКА ПОРТАЛУ:</b>\n${msg}`,
                parse_mode: "HTML"
            });
        } catch (e) {}
    }
};

// --- МАРШРУТИ НОВИН (ДОДАВАННЯ ТА ВИДАЛЕННЯ) ---

// 1. Отримати всі новини
app.get("/api/news", (req, res) => {
    try {
        const data = fs.readFileSync(NEWS_FILE, "utf-8");
        res.json(JSON.parse(data || "[]"));
    } catch (e) { res.json([]); }
});

// 2. Додати новину з адмінки
app.post("/api/news/add", upload.single("image"), async (req, res) => {
    const { pass, title, category, content } = req.body;
    if (pass !== ADMIN_PASSWORD) return res.status(401).json({ error: "No access" });

    try {
        let news = JSON.parse(fs.readFileSync(NEWS_FILE, "utf-8") || "[]");
        const newEntry = {
            id: Date.now(),
            date: new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' }),
            title: title.trim(),
            category: category,
            content: content,
            img: req.file ? `assets/news/${req.file.filename}` : "assets/img/auto-news.jpg"
        };
        news.unshift(newEntry);
        fs.writeFileSync(NEWS_FILE, JSON.stringify(news.slice(0, 200), null, 2));
        await writeLog(`Додано новину: ${title}`, "SUCCESS");
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Server error" }); }
});

// 3. Видалити новину
app.post("/api/news/delete", async (req, res) => {
    const { pass, id } = req.body;
    if (pass !== ADMIN_PASSWORD) return res.status(401).json({ error: "No access" });

    try {
        let news = JSON.parse(fs.readFileSync(NEWS_FILE, "utf-8") || "[]");
        news = news.filter(n => n.id != id);
        fs.writeFileSync(NEWS_FILE, JSON.stringify(news, null, 2));
        await writeLog(`Видалено новину ID: ${id}`, "WARN");
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Server error" }); }
});

// --- АДМІНКА ТА ЛОГИ ---
const blockedIPs = new Map();
app.post('/api/admin/login', async (req, res) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (req.body.pass === ADMIN_PASSWORD) {
        await writeLog(`Успішний вхід. IP: ${ip}`, "SUCCESS");
        return res.json({ success: true });
    }
    await writeLog(`Невдала спроба входу! IP: ${ip}`, "WARN");
    return res.status(401).json({ error: "Невірний пароль" });
});

app.get('/api/admin/logs', (req, res) => {
    if (req.query.pass !== ADMIN_PASSWORD) return res.status(401).send("No access");
    res.type('text/plain').send(fs.readFileSync(LOG_FILE, "utf-8"));
});

// --- ГРАБЕР НОВИН ---
async function autoFetchNews() {
    try {
        const RSS_SOURCES = [
            { name: "ТСН Україна", url: "https://tsn.ua/rss/full.rss" },
            { name: "MDR Саксонія", url: "https://www.mdr.de/nachrichten/sachsen/index-rss.xml" },
            { name: "TAG24 Дрезден", url: "https://www.tag24.de/dresden/rss" }
        ];
        let news = JSON.parse(fs.readFileSync(NEWS_FILE, "utf-8") || "[]");
        for (const source of RSS_SOURCES) {
            try {
                const response = await axios.get(source.url, { timeout: 8000 });
                const feed = await parser.parseString(response.data);
                feed.items.forEach(item => {
                    if (!news.some(n => n.title === item.title)) {
                        news.push({
                            id: Date.now() + Math.random(),
                            date: new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' }),
                            title: item.title.trim(),
                            category: source.name,
                            content: (item.contentSnippet || "").substring(0, 300) + "...",
                            link: item.link,
                            img: "assets/img/auto-news.jpg"
                        });
                    }
                });
            } catch (err) {}
        }
        news.sort((a, b) => b.id - a.id);
        fs.writeFileSync(NEWS_FILE, JSON.stringify(news.slice(0, 100), null, 2));
    } catch (err) {}
}
setInterval(autoFetchNews, 15 * 60 * 1000);
setTimeout(autoFetchNews, 5000);

// --- СТАТИКА ---
app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`СЕРВЕР ПОРТАЛУ ЗАПУЩЕНО`));
