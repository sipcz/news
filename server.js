import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import https from "https"; 
import fs from "fs"; // Додав для перевірки папок

import newsRoutes from "./routes/news.js";
import taxiRoute from "./routes/taxi.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// 📁 Створюємо папку для фото, якщо ти забув її створити в Termux
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Роздача файлів
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname, "assets")));
// 🔥 ВАЖЛИВО: Додав роздачу завантажених фото
app.use("/uploads", express.static(uploadDir));

// ПІДКЛЮЧЕННЯ API
app.use("/api/news", newsRoutes);
app.use("/api/taxi", taxiRoute);

// 🛡️ ЗАХИСТ АДМІНКИ (IP-БЛОКУВАННЯ)
const ADMIN_ATTEMPTS = new Map();
const ADMIN_BLOCKED = new Map();
const ADMIN_BLOCK_TIME = 60 * 60 * 1000; 
const MAX_ADMIN_ATTEMPTS = 5;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "pedro2026";

app.post('/api/admin/login', (req, res) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    const { pass } = req.body;
    const now = Date.now();

    if (ADMIN_BLOCKED.has(ip)) {
        if (now < ADMIN_BLOCKED.get(ip)) {
            return res.status(403).json({ error: "Ваш IP заблоковано на 1 годину!" });
        }
        ADMIN_BLOCKED.delete(ip);
    }

    if (pass === ADMIN_PASSWORD) {
        ADMIN_ATTEMPTS.delete(ip);
        return res.json({ success: true });
    } else {
        const attempts = (ADMIN_ATTEMPTS.get(ip) || 0) + 1;
        ADMIN_ATTEMPTS.set(ip, attempts);
        if (attempts >= MAX_ADMIN_ATTEMPTS) {
            ADMIN_BLOCKED.set(ip, now + ADMIN_BLOCK_TIME);
        }
        return res.status(401).json({ error: "Невірний пароль" });
    }
});

// МАРШРУТИ ДЛЯ СТОРІНОК
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    
    // Самопінг проти сну (виправ на свою адресу news2-9mlo.onrender.com)
    setInterval(() => {
        https.get("https://news2-9mlo.onrender.com/", (res) => {
            console.log("Ping OK:", res.statusCode);
        }).on("error", (err) => console.log("Ping error:", err.message));
    }, 10 * 60 * 1000); 
});
