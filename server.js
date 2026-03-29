import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import https from "https"; 
import fs from "fs";
import axios from "axios";
import Parser from "rss-parser";
import helmet from "helmet";

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

// Ініціалізація файлів
if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, "");

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

// --- СИСТЕМА ЛОГУВАННЯ ТА TG ---
const writeLog = async (msg, type = "INFO") => {
    const time = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' });
    const logEntry = `[${time}] [${type}] ${msg}\n`;
    
    // Запис у файл
    fs.appendFileSync(LOG_FILE, logEntry);
    console.log(logEntry.trim());

    // Якщо це тривога або важлива подія - шлемо в ТГ
    if (type === "ALERT" || type === "WARN" || type === "SUCCESS") {
        const icons = { INFO: "ℹ️", WARN: "⚠️", ALERT: "🚨", SUCCESS: "✅", MSG: "📩" };
        try {
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                chat_id: CHAT_ID,
                text: `${icons[type] || "🔔"} <b>БЕЗПЕКА ПОРТАЛУ:</b>\n${msg}\n<i>Час: ${time}</i>`,
                parse_mode: "HTML"
            });
        } catch (e) { console.error("Помилка ТГ логу"); }
    }
};

// --- ЗАХИСТ АДМІНКИ ---
const loginAttempts = new Map();
const blockedIPs = new Map();

app.post('/api/admin/login', async (req, res) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const { pass } = req.body;

    // Перевірка на блок
    if (blockedIPs.has(ip)) {
        const blockTime = blockedIPs.get(ip);
        if (Date.now() < blockTime) {
            return res.status(403).json({ error: "Ви заблоковані за перебір паролів. Спробуйте через годину." });
        } else {
            blockedIPs.delete(ip);
        }
    }

    if (pass === ADMIN_PASSWORD) {
        loginAttempts.delete(ip); // Скидаємо лічильник при успіху
        await writeLog(`Успішний вхід в адмінку. IP: ${ip}`, "SUCCESS");
        return res.json({ success: true });
    } else {
        // Логіка блокування
        const attempts = (loginAttempts.get(ip) || 0) + 1;
        loginAttempts.set(ip, attempts);
        
        await writeLog(`Невдала спроба входу! IP: ${ip}, Спроба: ${attempts}`, "WARN");

        if (attempts >= 5) {
            blockedIPs.set(ip, Date.now() + 3600000); // Блок на 1 годину
            await writeLog(`IP ${ip} ЗАБЛОКОВАНО за перебір паролів!`, "ALERT");
            return res.status(403).json({ error: "Забагато спроб. IP заблоковано." });
        }

        return res.status(401).json({ error: "Невірний пароль" });
    }
});

// --- МАРШРУТ ДЛЯ ВИВОДУ ЛОГІВ В АДМІНЦІ ---
app.get('/api/admin/logs', (req, res) => {
    // Тут можна додати перевірку токена, але для простоти поки пароль в query
    if (req.query.pass !== ADMIN_PASSWORD) return res.status(401).send("No access");
    
    try {
        const logs = fs.readFileSync(LOG_FILE, "utf-8");
        res.type('text/plain').send(logs);
    } catch (e) { res.send("Логи порожні"); }
});

// --- ГРАБЕР НОВИН ---
async function autoFetchNews() {
    try {
        if (!fs.existsSync(NEWS_FILE)) fs.writeFileSync(NEWS_FILE, "[]");
        const fileData = fs.readFileSync(NEWS_FILE, "utf-8");
        let news = JSON.parse(fileData || "[]");
        let addedCount = 0;

        const RSS_SOURCES = [
            { name: "ТСН Україна", url: "https://tsn.ua/rss/full.rss" },
            { name: "MDR Саксонія", url: "https://www.mdr.de/nachrichten/sachsen/index-rss.xml" },
            { name: "TAG24 Дрезден", url: "https://www.tag24.de/dresden/rss" }
        ];

        for (const source of RSS_SOURCES) {
            try {
                const response = await axios.get(source.url, { timeout: 10000 });
                const feed = await parser.parseString(response.data);
                for (const item of feed.items) {
                    if (!news.some(n => n.title === item.title)) {
                        const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
                        news.push({
                            id: pubDate.getTime(),
                            date: pubDate.toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' }),
                            title: item.title.trim(),
                            category: source.name,
                            content: (item.contentSnippet || "").substring(0, 300) + "...",
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

// --- СТАТИКА ТА ІНШЕ ---
app.get("/api/news", (req, res) => {
    const data = fs.readFileSync(NEWS_FILE, "utf-8");
    res.json(JSON.parse(data || "[]"));
});

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    await writeLog(`Сервер запущено на порту ${PORT}`, "INFO");
});
