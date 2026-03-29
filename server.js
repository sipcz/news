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
const BLOCKS_FILE = path.join(__dirname, "blocks.json");
const UPLOADS_DIR = path.join(__dirname, "assets/news");

// Ініціалізація файлів
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(NEWS_FILE)) fs.writeFileSync(NEWS_FILE, "[]");
if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, "");
if (!fs.existsSync(BLOCKS_FILE)) fs.writeFileSync(BLOCKS_FILE, JSON.stringify({ attempts: {}, blocked: {} }));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// --- ДОПОМІЖНІ ФУНКЦІЇ БЕЗПЕКИ ---
const getSecurityData = () => JSON.parse(fs.readFileSync(BLOCKS_FILE, "utf-8"));
const saveSecurityData = (data) => fs.writeFileSync(BLOCKS_FILE, JSON.stringify(data, null, 2));

const writeLog = async (msg, type = "INFO") => {
    const time = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' });
    const logEntry = `[${time}] [${type}] ${msg}\n`;
    fs.appendFileSync(LOG_FILE, logEntry);
    if (["ALERT", "WARN", "SUCCESS", "MSG"].includes(type)) {
        try {
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                chat_id: CHAT_ID,
                text: `<b>ПОРТАЛ LIVE:</b>\n${msg}`,
                parse_mode: "HTML"
            });
        } catch (e) {}
    }
};

// --- ЛОГІН З ЖОРСТКИМ БАНОМ (3 СПРОБИ) ---
app.post('/api/admin/login', async (req, res) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const now = Date.now();
    let secData = getSecurityData();

    // Перевірка на бан
    if (secData.blocked[ip]) {
        if (now < secData.blocked[ip]) {
            return res.status(403).json({ error: "IP ЗАБЛОКОВАНО", showPedro: true });
        } else {
            delete secData.blocked[ip];
            saveSecurityData(secData);
        }
    }

    if (req.body.pass === ADMIN_PASSWORD) {
        delete secData.attempts[ip];
        saveSecurityData(secData);
        await writeLog(`Успішний вхід. IP: ${ip}`, "SUCCESS");
        return res.json({ success: true });
    } else {
        secData.attempts[ip] = (secData.attempts[ip] || 0) + 1;
        await writeLog(`Невдала спроба! IP: ${ip}, Спроба: ${secData.attempts[ip]}`, "WARN");

        if (secData.attempts[ip] >= 3) {
            secData.blocked[ip] = now + 3600000; // Блок на 1 годину
            await writeLog(`🚨 IP ${ip} ЗАБАНЕНО (3 невдалі спроби)!`, "ALERT");
        }
        
        saveSecurityData(secData);
        if (secData.blocked[ip]) return res.status(403).json({ error: "БЛОК", showPedro: true });
        
        return res.status(401).json({ error: `Невірний пароль! Залишилося спроб: ${3 - secData.attempts[ip]}` });
    }
});

// --- ГРАБЕР ТА ЧИСТКА ---
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
                const response = await axios.get(source.url, { timeout: 10000 });
                const feed = await parser.parseString(response.data);
                feed.items.forEach(item => {
                    if (!news.some(n => n.title === item.title)) {
                        const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
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
        const now = Date.now();
        const twoDays = 172800000;
        
        // Видалення старих фото
        news.filter(n => (now - n.id) >= twoDays).forEach(n => {
            if (n.img?.startsWith('assets/news/')) {
                const fp = path.join(__dirname, n.img);
                if (fs.existsSync(fp)) fs.unlinkSync(fp);
            }
        });

        const filtered = news.filter(n => (now - n.id) < twoDays);
        fs.writeFileSync(NEWS_FILE, JSON.stringify(filtered.slice(0, 150), null, 2));
    } catch (err) {}
}

setInterval(autoFetchNews, 20 * 60 * 1000);
setTimeout(autoFetchNews, 5000);

// --- API ---
app.post("/api/taxi", async (req, res) => {
    const { name, phone, comment } = req.body;
    await writeLog(`📬 ПОВІДОМЛЕННЯ:\n👤 ${name}\n📞 ${phone}\n💬 ${comment}`, "MSG");
    res.json({ success: true });
});

app.get("/api/news", (req, res) => res.json(JSON.parse(fs.readFileSync(NEWS_FILE, "utf-8") || "[]")));

app.post("/api/news/add", upload.single("image"), (req, res) => {
    if (req.body.pass !== ADMIN_PASSWORD) return res.status(401).send("No");
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
});

app.post("/api/news/delete", (req, res) => {
    if (req.body.pass !== ADMIN_PASSWORD) return res.status(401).send("No");
    let news = JSON.parse(fs.readFileSync(NEWS_FILE, "utf-8") || "[]");
    news = news.filter(n => n.id != req.body.id);
    fs.writeFileSync(NEWS_FILE, JSON.stringify(news, null, 2));
    res.json({ success: true });
});

app.get('/api/admin/logs', (req, res) => {
    if (req.query.pass !== ADMIN_PASSWORD) return res.status(401).send("No");
    res.type('text/plain').send(fs.readFileSync(LOG_FILE, "utf-8"));
});

app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`СЕРВЕР ПРАЦЮЄ. ЗАХИСТ: 3 СПРОБИ.`));
