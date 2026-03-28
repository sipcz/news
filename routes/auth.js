import express from "express";

const router = express.Router();

// Беремо пароль з налаштувань (env) або використовуємо твій стандартний
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "pedro2026";

router.post("/login", (req, res) => {
    const { password } = req.body;

    // Пряма перевірка без bcrypt — це швидше для мобільного процесора 
    // і дозволяє тобі міняти пароль одним кліком у налаштуваннях Render
    if (password === ADMIN_PASSWORD) {
        console.log("Admin login success");
        // Повертаємо токен для сумісності з твоєю адмінкою
        return res.json({ token: "admin-token", success: true });
    } else {
        console.log("Admin login failed");
        return res.status(401).json({ error: "Невірний пароль" });
    }
});

export default router;