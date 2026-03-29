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
const parser = new Parser({
    customFields: {
        item: [
            ['media:content', 'mediaContent', {keepArray: false}],
            ['enclosure', 'enclosure', {keepArray: false}]
        ]
    }
});

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
if (!fs.existsSync(NEWS_FILE)) fs.writeFileSync(NEWS_FILE, "[]");

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

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

// --- ГРАБЕР НОВИН (З ПОШУКОМ ФОТО) ---
async function autoFetchNews() {
    try {
        let news = JSON.parse(fs.readFileSync(NEWS_FILE, "utf-8") || "[]");
        let addedCount = 0;

        const RSS_SOURCES = [
            { name: "ТСН Україна", url: "https://tsn.ua/rss/full.rss" },
            { name: "MDR Саксонія", url: "https://www.mdr.de/nachrichten/sachsen/index-rss.xml" },
            { name: "TAG24 Дрезден", url: "https://www.tag24.de/dresden/rss" },
            { name: "DW Новини", url: "https://rss.dw.com/xml/rss-ukr-all" }
        ];

        for (const source of RSS_SOURCES) {
            try {
                const response = await axios.get(source.url, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
                const feed = await parser.parseString(response.data);
                
                for (const item of feed.items) {
                    if (!news.some(n => n.title === item.title)) {
                        const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
                        
                        // Пошук картинки
                        let imageUrl = "assets/img/auto-news.jpg";
                        if (item.enclosure && item.enclosure.url) {
                            imageUrl = item.enclosure.url;
                        } else if (item.mediaContent && item.mediaContent.$ && item.mediaContent.$.url) {
                            imageUrl = item.mediaContent.$.url;
                        } else if (item.content && item.content.includes('<img')) {
                            const imgMatch = item.content.match(/src="([^"]+)"/);
                            if (imgMatch) imageUrl = imgMatch[1];
                        }

                        news.push({
                            id: pubDate.getTime() + Math.floor(Math.random() * 100),
                            date: pubDate.toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' }),
                            title: item.title.trim(),
                            category: source.name,
                            img: imageUrl,
                            content: (item.contentSnippet || item.content || "").replace(/<[^>]*>?/gm, '').trim().substring(0, 400) + "...",
                            link: item.link
                        });
                        addedCount++;
                    }
                }
            } catch (err) { console.log(`Помилка джерела ${source.name}`); }
        }

        if (addedCount > 0) {
            news.sort((a, b) => b.id - a.id);
            fs.writeFileSync(NEWS_FILE, JSON.stringify(news.slice(0, 100), null, 2));
            console.log(`Додано ${addedCount} новин.`);
        }
    } catch (err) { console.error("Грабер error:", err); }
}

setInterval(autoFetchNews, 15 * 60 * 1000);
setTimeout(autoFetchNews, 5000);

// --- API ---
app.get("/api/news", (req, res) => {
    try {
        const data = fs.readFileSync(NEWS_FILE, "utf-8");
        res.json(JSON.parse(data || "[]"));
    } catch (e) { res.json([]); }
});

app.post("/api/news/add", upload.single("image"), async (req, res) => {
    const { pass, title, category, content } = req.body;
    if (pass !== ADMIN_PASSWORD) return res.status(401).json({ error: "No access" });
    try {
        let news = JSON.parse(fs.readFileSync(NEWS_FILE, "utf-8") || "[]");
        news.unshift({
            id: Date.now(),
            date: new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' }),
            title: title,
            category: category,
            content: content,
            img: req.file ? `assets/news/${req.file.filename}` : "assets/img/auto-news.jpg"
        });
        fs.writeFileSync(NEWS_FILE, JSON.stringify(news.slice(0, 200), null, 2));
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Server error" }); }
});

app.post("/api/news/delete", async (req, res) => {
    const { pass, id } = req.body;
    if (pass !== ADMIN_PASSWORD) return res.status(401).json({ error: "No access" });
    try {
        let news = JSON.parse(fs.readFileSync(NEWS_FILE, "utf-8") || "[]");
        news = news.filter(n => n.id != id);
        fs.writeFileSync(NEWS_FILE, JSON.stringify(news, null, 2));
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Server error" }); }
});

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

// --- СТАТИКА ---
app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`СЕРВЕР ПОРТАЛУ ЗАПУЩЕНО`);
    // Анти-сон для Render
    setInterval(() => {
        https.get(`https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost'}/`, () => {});
    }, 10 * 60 * 1000);
});
