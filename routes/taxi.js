import express from "express";
import axios from "axios";
import { promises as fs } from "fs"; 

const router = express.Router();

const BOT_TOKEN = "8381037035:AAGhfS8LbZQCgPf_oAVyvG9tXDLtfAxGVug";
const CHAT_ID = "8257665442";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "pedro2026";
const LOG_FILE = "./taxi-log.json";

// Ініціалізація файлу
async function initLogs() {
    try { await fs.access(LOG_FILE); } 
    catch { await fs.writeFile(LOG_FILE, "[]"); }
}
initLogs();

// 1. КЛІЄНТ ЗАМОВЛЯЄ ТАКСІ (З ЗАХИСТОМ ВІД БОТІВ)
router.post("/", async (req, res) => {
    // 🛡️ HONEYPOT CHECK (Пастка для ботів)
    // Якщо бот заповнив приховане поле hp_name - ігноруємо
    if (req.body.hp_name) {
        console.warn("Spam bot blocked by Honeypot");
        return res.status(200).send("OK"); // Удаємо вигляд, що все добре
    }

    const { name, phone, address, comment } = req.body;

    if (!name || !phone) {
        return res.status(400).send("Заповніть обов'язкові поля!");
    }

    try {
        const now = new Date().toLocaleString('uk-UA');
        const newOrder = { id: Date.now(), time: now, name, phone, address, comment };

        // Збереження в файл
        const fileData = await fs.readFile(LOG_FILE, "utf-8");
        const logs = JSON.parse(fileData);
        logs.push(newOrder);
        await fs.writeFile(LOG_FILE, JSON.stringify(logs, null, 2));

        // Відправка в Telegram
        const text = `🚕 *Нове замовлення!*\n\n👤 Ім'я: ${name}\n📞 Тел: ${phone}\n📍 Адреса: ${address}\n💬 Комент: ${comment || '-'}`;
        
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text,
            parse_mode: "Markdown"
        });

        res.send("Замовлення прийнято! 🚕");
    } catch (err) {
        res.status(500).send("Помилка сервера");
    }
});

// 2. АДМІН ОТРИМУЄ СПИСОК (POST для безпеки)
router.post("/admin", async (req, res) => {
    const { pass } = req.body;
    if (pass !== ADMIN_PASSWORD) return res.status(403).json({ error: "Невірний пароль" });
    
    try {
        const fileData = await fs.readFile(LOG_FILE, "utf-8");
        res.json(JSON.parse(fileData).reverse());
    } catch (error) {
        res.status(500).json({ error: "Помилка читання логів" });
    }
});

// 3. АДМІН ВИДАЛЯЄ ЗАЯВКУ
router.post("/delete", async (req, res) => {
    const { pass, id } = req.body;
    if (pass !== ADMIN_PASSWORD) return res.status(403).send("Доступ заборонено");

    try {
        const data = await fs.readFile(LOG_FILE, "utf-8");
        let logs = JSON.parse(data);
        logs = logs.filter(item => item.id.toString() !== id.toString());
        await fs.writeFile(LOG_FILE, JSON.stringify(logs, null, 2));
        res.send("Видалено");
    } catch (err) {
        res.status(500).send("Помилка видалення");
    }
});

export default router;