import express from "express";
import { promises as fs } from "fs";

const router = express.Router();
const NEWS_FILE = "./news-data.json";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "pedro2026";

// Ініціалізація файлу бази даних
async function initNews() {
    try {
        await fs.access(NEWS_FILE);
    } catch {
        await fs.writeFile(NEWS_FILE, "[]");
    }
}
initNews();

// 1. ОТРИМАТИ ВСІ НОВИНИ
router.get("/", async (req, res) => {
    try {
        const data = await fs.readFile(NEWS_FILE, "utf-8");
        res.json(JSON.parse(data).reverse());
    } catch (err) {
        res.status(500).json({ error: "Помилка читання бази даних" });
    }
});

// 2. ДОДАТИ НОВИНУ (З ПЕРЕВІРКОЮ ТА ВАЛІДАЦІЄЮ)
router.post("/add", async (req, res) => {
    const { pass, article } = req.body;

    // 🛡️ Перевірка пароля
    if (pass !== ADMIN_PASSWORD) {
        return res.status(403).json({ error: "Доступ заборонено!" });
    }

    // 🛡️ Валідація даних (захист від некоректних запитів)
    if (!article || !article.title || !article.content) {
        return res.status(400).json({ error: "Заголовок та текст новини обов'язкові!" });
    }

    try {
        const data = await fs.readFile(NEWS_FILE, "utf-8");
        const news = JSON.parse(data);

        const newArticle = {
            id: Date.now(),
            date: new Date().toLocaleString('uk-UA'),
            title: article.title.trim(),
            category: article.category || "Події",
            img: article.img || "assets/img/default-news.jpg",
            content: article.content.trim()
        };

        news.push(newArticle);
        await fs.writeFile(NEWS_FILE, JSON.stringify(news, null, 2));
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Помилка при збереженні файлу" });
    }
});

// 3. ВИДАЛИТИ НОВИНУ (З ОБРОБКОЮ ПОМИЛОК)
router.post("/delete", async (req, res) => {
    const { pass, id } = req.body;

    if (pass !== ADMIN_PASSWORD) {
        return res.status(403).json({ error: "Невірний пароль" });
    }

    try {
        const data = await fs.readFile(NEWS_FILE, "utf-8");
        let news = JSON.parse(data);
        
        // Видаляємо новину за ID
        const initialLength = news.length;
        news = news.filter(n => n.id.toString() !== id.toString());

        if (news.length === initialLength) {
            return res.status(404).json({ error: "Новину не знайдено" });
        }

        await fs.writeFile(NEWS_FILE, JSON.stringify(news, null, 2));
        res.json({ success: true, message: "Видалено успішно" });
    } catch (err) {
        res.status(500).json({ error: "Помилка при видаленні з бази" });
    }
});

export default router;