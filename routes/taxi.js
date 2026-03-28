import express from "express";
import axios from "axios";
import { promises as fs } from "fs"; 
import path from "path";

const router = express.Router();

const BOT_TOKEN = "8381037035:AAGhfS8LbZQCgPf_oAVyvG9tXDLtfAxGVug";
const CHAT_ID = "8257665442";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "pedro2026";
const LOG_FILE = "./taxi-log.json";

// Ініціалізація файлу (безпечний запуск)
async function initLogs() {
    try { 
        await fs.access(LOG_FILE); 
    } catch { 
        await fs.writeFile(LOG_FILE, JSON.stringify([])); 
    }
}
initLogs();

// 1. ПРИЙОМ ЗАМОВЛЕННЯ / ПОВІДОМЛЕННЯ
router.post("/", async (req, res) => {
    // 🛡️ Пастка для ботів
    if (req.body.hp_name) {
        console.warn("Спроба спаму заблокована");
        return res.status(200).send("OK");
    }

    const { name, phone, address, comment } = req.body;

    if (!name || !phone) {
        return res.status(400).send("Ім'я та телефон обов'язкові!");
    }

    try {
        const now = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' });
        const newOrder = { 
            id: Date.now().toString(), 
            time: now, 
            name: name.trim(), 
            phone: phone.trim(), 
            address: address ? address.trim() : "Не вказано", 
            comment: comment ? comment.trim() : "-" 
        };

        // Читаємо та оновлюємо лог
        const fileData = await fs.readFile(LOG_FILE, "utf-8");
        const logs = JSON.parse(fileData || "[]");
        logs.push(newOrder);
        await fs.writeFile(LOG_FILE, JSON.stringify(logs, null, 2));

        // 📲 Стильний Telegram (використовуємо HTML замість Markdown для надійності)
        const text = `
<b>🚕 НОВЕ ЗАМОВЛЕННЯ / ПИТАННЯ</b>
──────────────────
👤 <b>Ім'я:</b> ${newOrder.name}
📞 <b>Тел:</b> <code>${newOrder.phone}</code>
📍 <b>Куди:</b> ${newOrder.address}
💬 <b>Коментар:</b> <i>${newOrder.comment}</i>
──────────────────
🕒 <i>Час: ${newOrder.time}</i>`;

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: text,
            parse_mode: "HTML"
        });

        res.status(200).send("Дякуємо! Ваша заявка прийнята. 🚕");
    } catch (err) {
        console.error("Помилка таксі:", err.message);
        res.status(500).send("Помилка відправки");
    }
});

// 2. ОТРИМАННЯ ЛОГІВ ДЛЯ АДМІНКИ
router.post("/admin", async (req, res) => {
    const { pass } = req.body;
    if (pass !== ADMIN_PASSWORD) return res.status(403).json({ error: "Доступ обмежено" });
    
    try {
        const fileData = await fs.readFile(LOG_FILE, "utf-8");
        const logs = JSON.parse(fileData || "[]");
        // Повертаємо останні замовлення зверху
        res.json(logs.reverse());
    } catch (error) {
        res.status(500).json({ error: "Не вдалося завантажити заявки" });
    }
});

// 3. ВИДАЛЕННЯ ЗАЯВКИ
router.post("/delete", async (req, res) => {
    const { pass, id } = req.body;
    if (pass !== ADMIN_PASSWORD) return res.status(403).send("Заборонено");

    try {
        const data = await fs.readFile(LOG_FILE, "utf-8");
        let logs = JSON.parse(data || "[]");
        
        const newLogs = logs.filter(item => item.id !== id);
        await fs.writeFile(LOG_FILE, JSON.stringify(newLogs, null, 2));
        
        res.status(200).send("Видалено");
    } catch (err) {
        res.status(500).send("Помилка видалення");
    }
});

export default router;
