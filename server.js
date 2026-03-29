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
// Налаштування парсера для читання медіа-тегів (фото) з RSS
const parser = new Parser({
    customFields: {
        item: [
            ['media:content', 'mediaContent'],
            ['enclosure', 'enclosure'],
            ['content:encoded', 'contentEncoded']
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

// Ініціалізація структури проекту
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(NEWS_FILE)) fs.writeFileSync(NEWS_FILE, "[]");
if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, "");

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

// Завантаження власних фото з адмінки
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// --- СИСТЕМА ЛОГУВАННЯ ТА TELEGRAM ---
const writeLog = async (msg, type = "INFO") => {
    const time = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' });
    const logEntry = `[${time}] [${type}] ${msg}\n`;
    fs.appendFileSync(LOG_FILE, logEntry);
    console.log(logEntry.trim());

    if (["ALERT", "WARN", "SUCCESS", "MSG"].includes(type)) {
        const icons = { INFO: "ℹ️", WARN: "⚠️", ALERT: "🚨", SUCCESS: "✅", MSG: "📩" };
        try {
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                chat_id: CHAT_ID,
                text: `${icons[type] || "🔔"} <b>ПОРТАЛ LIVE:</b>\n${msg}\n<i>${time}</i>`,
                parse_mode: "HTML"
            });
        } catch (e) { console.error("TG Error"); }
    }
};

// --- ЗАХИСТ ТА БАН (ПЕДРО-КОНТРОЛЬ) ---
const loginAttempts = new Map();
const blockedIPs = new Map();

app.post('/api/admin/login', async (req, res) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const now = Date.now();

    if (blockedIPs.has(ip)) {
        if (now < blockedIPs.get(ip)) {
            return res.status(403).json({ error: "IP ЗАБЛОКОВАНО", showPedro: true });
        }
        blockedIPs.delete(ip);
    }

    if (req.body.pass === ADMIN_PASSWORD) {
        loginAttempts.delete(ip);
        await writeLog(`Успішний вхід. IP: ${ip}`, "SUCCESS");
        return res.json({ success: true });
    } else {
        const count = (loginAttempts.get(ip) || 0) + 1;
        loginAttempts.set(ip, count);
        await writeLog(`Невдала спроба входу! IP: ${ip}, Спроба: ${count}`, "WARN");

        if (count >= 5) {
            blockedIPs.set(ip, now + 3600000); // 1 година блоку
            await writeLog(`🚨 IP ${ip} ЗАБАНЕНО за перебір паролів!`, "ALERT");
            return res.status(403).json({ error: "ЗАБЛОКОВАНО", showPedro: true });
        }
        return res.status(401).json({ error: "Невірний пароль" });
    }
});

// --- ОБРОБКА ФОРМИ ЗВОРОТНОГО ЗВ'ЯЗКУ (ТА ПІДТРИМКИ) ---
app.post("/api/taxi", async (req, res) => {
    try {
        const { name, phone, comment } = req.body;
        if (!name || !phone) return res.status(400).json({ error: "Заповніть контактні дані" });

        const msg = `📬 <b>НОВЕ ПОВІДОМЛЕННЯ:</b>\n👤 Ім'я: ${name}\n📞 Тел: ${phone}\n💬 Текст: ${comment || "-"}`;
        await writeLog(msg, "MSG");
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Помилка сервера" });
    }
});

// --- АВТОМАТИЧНА ЧИСТКА (48 ГОДИН) ---
function autoCleanOldNews() {
    try {
        const data = fs.readFileSync(NEWS_FILE, "utf-8");
        let news = JSON.parse(data || "[]");
        const now = Date.now();
        const twoDays = 172800000; // 48 годин

        // Видаляємо файли старих новин
        const toDelete = news.filter(n => (now - n.id) >= twoDays);
        toDelete.forEach(n => {
            if (n.img && n.img.startsWith('assets/news/')) {
                const filePath = path.join(__dirname, n.img);
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            }
        });

        const filtered = news.filter(n => (now - n.id) < twoDays);
        if (filtered.length !== news.length) {
            fs.writeFileSync(NEWS_FILE, JSON.stringify(filtered, null, 2));
            writeLog(`Чистка: видалено ${news.length - filtered.length} старих новин.`, "INFO");
        }
    } catch (e) {}
}

// --- ГРАБЕР НОВИН (ZAXID.NET + ФОТО) ---
async function autoFetchNews() {
    try {
        let news = JSON.parse(fs.readFileSync(NEWS_FILE, "utf-8") || "[]");
        const RSS_SOURCES = [
            { name: "ZAXID.NET", url: "https://zaxid.net/rss/all.xml" },
            { name: "ТСН Україна", url: "https://tsn.ua/rss/full.rss" },
            { name: "MDR Саксонія", url: "https://www.mdr.de/nachrichten/sachsen/index-rss.xml" },
            { name: "TAG24 Дрезден", url: "https://www.tag24.de/dresden/rss" },
            { name: "DW Новини", url: "https://rss.dw.com/xml/rss-ukr-all" }
        ];

        for (const source of RSS_SOURCES) {
            try {
                const response = await axios.get(source.url, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
                const feed = await parser.parseString(response.data);
                
                feed.items.forEach(item => {
                    if (!news.some(n => n.title === item.title)) {
                        const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
                        
                        // Розумний пошук картинки
                        let img = "assets/img/auto-news.jpg";
                        if (item.enclosure?.url) img = item.enclosure.url;
                        else if (item.mediaContent?.$.url) img = item.mediaContent.$.url;
                        else {
                            const desc = (item.content || "") + (item.contentEncoded || "");
                            const match = desc.match(/<img[^>]+src="([^">]+)"/);
                            if (match) img = match[1];
                        }

                        news.push({
                            id: pubDate.getTime(),
                            date: pubDate.toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' }),
                            title: item.title.trim(),
                            category: source.name,
                            img: img,
                            content: (item.contentSnippet || "").substring(0, 450).replace(/<[^>]*>?/gm, '') + "...",
                            link: item.link
                        });
                    }
                });
            } catch (err) {}
        }
        news.sort((a, b) => b.id - a.id);
        fs.writeFileSync(NEWS_FILE, JSON.stringify(news.slice(0, 150), null, 2));
        autoCleanOldNews();
    } catch (err) {}
}

setInterval(autoFetchNews, 20 * 60 * 1000);
setTimeout(autoFetchNews, 5000);

// --- API МАРШРУТИ ---
app.get("/api/news", (req, res) => {
    try {
        res.json(JSON.parse(fs.readFileSync(NEWS_FILE, "utf-8") || "[]"));
    } catch (e) { res.json([]); }
});

app.post("/api/news/add", upload.single("image"), async (req, res) => {
    if (req.body.pass !== ADMIN_PASSWORD) return res.status(401).send("No access");
    try {
        let news = JSON.parse(fs.readFileSync(NEWS_FILE, "utf-8") || "[]");
        news.unshift({
            id: Date.now(),
            date: new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' }),
            title: req.body.title,
            category: req.body.category,
            content: req.body.content,
            img: req.file ? `assets/news/${req.file.filename}` : "assets/img/auto-news.jpg"
        });
        fs.writeFileSync(NEWS_FILE, JSON.stringify(news.slice(0, 200), null, 2));
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "error" }); }
});

app.post("/api/news/delete", (req, res) => {
    if (req.body.pass !== ADMIN_PASSWORD) return res.status(401).send("No access");
    let news = JSON.parse(fs.readFileSync(NEWS_FILE, "utf-8") || "[]");
    news = news.filter(n => n.id != req.body.id);
    fs.writeFileSync(NEWS_FILE, JSON.stringify(news, null, 2));
    res.json({ success: true });
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
    writeLog("СЕРВЕР ПЕРЕЗАПУЩЕНО. ПОВНИЙ ФУНКЦІОНАЛ АКТИВНИЙ.", "SUCCESS");
    // Пінгування для Render
    setInterval(() => {
        https.get(`https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost'}/`, () => {});
    }, 13 * 60 * 1000);
});
