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
// Налаштовуємо парсер на максимальний пошук полів
const parser = new Parser({
    customFields: {
        item: [
            ['media:content', 'mediaContent'],
            ['enclosure', 'enclosure'],
            ['content:encoded', 'contentEncoded'],
            ['image', 'image']
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

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(NEWS_FILE)) fs.writeFileSync(NEWS_FILE, "[]");
if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, "");
if (!fs.existsSync(BLOCKS_FILE)) fs.writeFileSync(BLOCKS_FILE, JSON.stringify({ attempts: {}, blocked: {} }));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

const getSecData = () => JSON.parse(fs.readFileSync(BLOCKS_FILE, "utf-8"));
const saveSecData = (d) => fs.writeFileSync(BLOCKS_FILE, JSON.stringify(d, null, 2));

const writeLog = async (msg, type = "INFO") => {
    const time = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' });
    fs.appendFileSync(LOG_FILE, `[${time}] [${type}] ${msg}\n`);
    if (["ALERT", "WARN", "SUCCESS", "MSG"].includes(type)) {
        try {
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                chat_id: CHAT_ID, text: `<b>ПОРТАЛ LIVE:</b>\n${msg}`, parse_mode: "HTML"
            });
        } catch (e) {}
    }
};

// --- ЛОГІН (3 СПРОБИ + ПЕДРО) ---
app.post('/api/admin/login', async (req, res) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const now = Date.now();
    let sec = getSecData();

    if (sec.blocked[ip] && now < sec.blocked[ip]) {
        return res.status(403).json({ error: "БЛОК", showPedro: true });
    }

    if (req.body.pass === ADMIN_PASSWORD) {
        delete sec.attempts[ip];
        saveSecData(sec);
        await writeLog(`Успішний вхід. IP: ${ip}`, "SUCCESS");
        return res.json({ success: true });
    } else {
        sec.attempts[ip] = (sec.attempts[ip] || 0) + 1;
        if (sec.attempts[ip] >= 3) {
            sec.blocked[ip] = now + 3600000;
            await writeLog(`🚨 БАН IP ${ip} (3 спроби)`, "ALERT");
        }
        saveSecData(sec);
        if (sec.blocked[ip]) return res.status(403).json({ error: "БЛОК", showPedro: true });
        return res.status(401).json({ error: `Спроба ${sec.attempts[ip]} з 3` });
    }
});

// --- ГРАБЕР (ПОКРАЩЕНИЙ ПОШУК ФОТО) ---
async function autoFetchNews() {
    try {
        let news = JSON.parse(fs.readFileSync(NEWS_FILE, "utf-8") || "[]");
        const sources = [
            { n: "ZAXID.NET", u: "https://zaxid.net/rss/all.xml" },
            { n: "ТСН Україна", u: "https://tsn.ua/rss/full.rss" },
            { n: "MDR Саксонія", u: "https://www.mdr.de/nachrichten/sachsen/index-rss.xml" },
            { n: "TAG24 Дрезден", u: "https://www.tag24.de/dresden/rss" },
            { n: "DW Новини", u: "https://rss.dw.com/xml/rss-ukr-all" }
        ];

        for (const s of sources) {
            try {
                const res = await axios.get(s.u, { 
                    timeout: 12000, 
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } 
                });
                const feed = await parser.parseString(res.data);
                
                feed.items.forEach(item => {
                    if (!news.some(n => n.title === item.title)) {
                        // --- УЛЬТРА ПОШУК ФОТО ---
                        let img = "assets/img/auto-news.jpg"; 
                        
                        // 1. Пряме вкладення (enclosure)
                        if (item.enclosure && item.enclosure.url) {
                            img = item.enclosure.url;
                        } 
                        // 2. Медіа-тег (mediaContent)
                        else if (item.mediaContent && item.mediaContent.$ && item.mediaContent.$.url) {
                            img = item.mediaContent.$.url;
                        }
                        // 3. Специфічне для деяких фідів поле image
                        else if (item.image && item.image.url) {
                            img = item.image.url;
                        }
                        // 4. Пошук <img> в контенті
                        else {
                            const body = (item.content || "") + (item.contentEncoded || "") + (item.contentSnippet || "");
                            const m = body.match(/<img[^>]+src="([^">?]+)"/);
                            if (m) img = m[1];
                        }

                        news.push({
                            id: new Date(item.pubDate || Date.now()).getTime(),
                            date: new Date(item.pubDate || Date.now()).toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' }),
                            title: item.title.trim(),
                            category: s.n,
                            img: img,
                            content: (item.contentSnippet || "").substring(0, 450).replace(/<[^>]*>?/gm, '') + "...",
                            link: item.link
                        });
                    }
                });
            } catch (e) { console.log(`Error source ${s.n}`); }
        }
        
        const now = Date.now();
        // Фільтр 48 годин + сортування
        news = news.filter(n => (now - n.id) < 172800000);
        fs.writeFileSync(NEWS_FILE, JSON.stringify(news.sort((a,b)=>b.id-a.id).slice(0, 150), null, 2));
    } catch (e) {}
}

setInterval(autoFetchNews, 20 * 60 * 1000);
setTimeout(autoFetchNews, 3000);

// --- API ---
app.get("/api/news", (req, res) => res.json(JSON.parse(fs.readFileSync(NEWS_FILE, "utf-8") || "[]")));
app.post("/api/taxi", async (req, res) => {
    await writeLog(`📩 ПОВІДОМЛЕННЯ:\n👤 ${req.body.name}\n📞 ${req.body.phone}\n💬 ${req.body.comment}`, "MSG");
    res.json({ success: true });
});

app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("LIVE SERVER READY");
    setInterval(() => {
        https.get(`https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost'}/`, () => {});
    }, 12 * 60 * 1000);
});
