import express from "express";
import { promises as fs } from "fs";
import multer from "multer";
import path from "path";

const router = express.Router();
const NEWS_FILE = "./news-data.json";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "pedro2026";

// 1. НАЛАШТУВАННЯ ТА ЗАХИСТ ПРИЙОМУ ФАЙЛІВ (MULTER)
const storage = multer.diskStorage({
    destination: "uploads/",
    filename: (req, file, cb) => {
        // Рандомна назва (дата + число), щоб хакер не знав прямого шляху
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname).toLowerCase());
    }
});

// Фільтр: дозволяємо тільки справжні картинки
const fileFilter = (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
    
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        // Передаємо помилку, якщо тип файлу не підходить
        cb(new Error("Недопустимий тип файлу! Можна завантажувати лише фото (JPG, PNG, WEBP)."), false);
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // Максимум 5 МБ на одне фото
    }
});

// Ініціалізація бази даних та папки завантажень
async function initStorage() {
    try { await fs.access(NEWS_FILE); } catch { await fs.writeFile(NEWS_FILE, "[]"); }
    try { await fs.access("uploads"); } catch { await fs.mkdir("uploads"); }
}
initStorage();

// 2. ОТРИМАТИ ВСІ НОВИНИ
router.get("/", async (req, res) => {
    try {
        const data = await fs.readFile(NEWS_FILE, "utf-8");
        res.json(JSON.parse(data || "[]").reverse());
    } catch (err) {
        res.status(500).json({ error: "Помилка читання бази даних" });
    }
});

// 3. ДОДАТИ НОВИНУ (З ПЕРЕВІРКОЮ НА ПОМИЛКИ)
router.post("/add", (req, res) => {
    // Спеціальна обробка для multer, щоб зловити помилки лімітів чи фільтру
    upload.single("image")(req, res, async (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: "Файл занадто великий! Максимум 5 МБ." });
            }
            return res.status(400).json({ error: "Помилка завантаження файлу." });
        } else if (err) {
            return res.status(400).json({ error: err.message });
        }

        const { pass, title, category, content } = req.body;

        if (pass !== ADMIN_PASSWORD) {
            // Якщо пароль невірний, видаляємо завантажений файл (якщо він встиг завантажитись)
            if (req.file) await fs.unlink(req.file.path).catch(() => {});
            return res.status(403).json({ error: "Доступ заборонено!" });
        }

        if (!title || !content) {
            if (req.file) await fs.unlink(req.file.path).catch(() => {});
            return res.status(400).json({ error: "Заповніть назву та текст!" });
        }

        try {
            const data = await fs.readFile(NEWS_FILE, "utf-8");
            const news = JSON.parse(data || "[]");

            const newArticle = {
                id: Date.now().toString(),
                date: new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' }),
                title: title.trim(),
                category: category || "Події",
                img: req.file ? `/uploads/${req.file.filename}` : "assets/img/default-news.jpg",
                content: content.trim()
            };

            news.push(newArticle);
            await fs.writeFile(NEWS_FILE, JSON.stringify(news, null, 2));
            res.json({ success: true, article: newArticle });
        } catch (error) {
            res.status(500).json({ error: "Помилка при збереженні новини" });
        }
    });
});

// 4. ВИДАЛИТИ НОВИНУ
router.post("/delete", async (req, res) => {
    const { pass, id } = req.body;

    if (pass !== ADMIN_PASSWORD) return res.status(403).json({ error: "Невірний пароль" });

    try {
        const data = await fs.readFile(NEWS_FILE, "utf-8");
        let news = JSON.parse(data || "[]");
        
        const articleToDelete = news.find(n => n.id.toString() === id.toString());
        
        if (articleToDelete && articleToDelete.img.startsWith('/uploads/')) {
            const filePath = path.join(process.cwd(), articleToDelete.img);
            try { await fs.unlink(filePath); } catch (e) { console.log("Файл вже видалено з диска"); }
        }

        news = news.filter(n => n.id.toString() !== id.toString());
        await fs.writeFile(NEWS_FILE, JSON.stringify(news, null, 2));
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Помилка при видаленні" });
    }
});

export default router;
