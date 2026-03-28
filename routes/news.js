import express from "express";
import { promises as fs } from "fs";
import multer from "multer";
import path from "path";

const router = express.Router();
const NEWS_FILE = "./news-data.json";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "pedro2026";

// 1. НАЛАШТУВАННЯ ПРИЙОМУ ФАЙЛІВ (MULTER)
const storage = multer.diskStorage({
    destination: "uploads/", // Куди зберігати
    filename: (req, file, cb) => {
        // Ім'я файлу = дата + розширення (наприклад: 1711658400000.jpg)
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// Ініціалізація бази даних та папки завантажень
async function initStorage() {
    try { await fs.access(NEWS_FILE); } catch { await fs.writeFile(NEWS_FILE, "[]"); }
    try { await fs.access("uploads"); } catch { await fs.mkdir("uploads"); }
}
initStorage();

// 2. ОТРИМАТИ ВСІ НОВИНИ (БЕЗ ЗМІН)
router.get("/", async (req, res) => {
    try {
        const data = await fs.readFile(NEWS_FILE, "utf-8");
        res.json(JSON.parse(data).reverse());
    } catch (err) {
        res.status(500).json({ error: "Помилка читання бази даних" });
    }
});

// 3. ДОДАТИ НОВИНУ (ТЕПЕР З ФОТО)
// upload.single("image") означає, що ми чекаємо один файл з поля "image"
router.post("/add", upload.single("image"), async (req, res) => {
    // Коли ми використовуємо FormData, дані приходять у req.body напряму
    const { pass, title, category, content } = req.body;

    // 🛡️ Перевірка пароля
    if (pass !== ADMIN_PASSWORD) {
        return res.status(403).json({ error: "Доступ заборонено!" });
    }

    // 🛡️ Валідація тексту
    if (!title || !content) {
        return res.status(400).json({ error: "Заголовок та текст обов'язкові!" });
    }

    try {
        const data = await fs.readFile(NEWS_FILE, "utf-8");
        const news = JSON.parse(data);

        const newArticle = {
            id: Date.now(),
            date: new Date().toLocaleString('uk-UA'),
            title: title.trim(),
            category: category || "Події",
            // 🔥 Якщо файл завантажено - ставимо шлях до нього, якщо ні - заглушку
            img: req.file ? `/uploads/${req.file.filename}` : "assets/img/default-news.jpg",
            content: content.trim()
        };

        news.push(newArticle);
        await fs.writeFile(NEWS_FILE, JSON.stringify(news, null, 2));
        res.json({ success: true, article: newArticle });
    } catch (err) {
        res.status(500).json({ error: "Помилка при збереженні новини" });
    }
});

// 4. ВИДАЛИТИ НОВИНУ
router.post("/delete", async (req, res) => {
    const { pass, id } = req.body;

    if (pass !== ADMIN_PASSWORD) {
        return res.status(403).json({ error: "Невірний пароль" });
    }

    try {
        const data = await fs.readFile(NEWS_FILE, "utf-8");
        let news = JSON.parse(data);
        
        // Знаходимо новину, щоб видалити її фото з папки (опціонально, але корисно)
        const articleToDelete = news.find(n => n.id.toString() === id.toString());
        if (articleToDelete && articleToDelete.img.startsWith('/uploads/')) {
            const filePath = path.join(process.cwd(), articleToDelete.img);
            try { await fs.unlink(filePath); } catch (e) { console.log("Файл вже видалено"); }
        }

        news = news.filter(n => n.id.toString() !== id.toString());
        await fs.writeFile(NEWS_FILE, JSON.stringify(news, null, 2));
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Помилка при видаленні" });
    }
});

export default router;
