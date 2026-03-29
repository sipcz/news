// --- ОБРОБКА ФОРМИ "НАПИСАТИ НАМ" ---
app.post("/api/taxi", async (req, res) => {
    try {
        const { name, phone, address, comment } = req.body;
        
        // Формуємо текст для тебе
        const msg = `📬 <b>НОВЕ ПОВІДОМЛЕННЯ:</b>\n\n` +
                    `👤 <b>Ім'я:</b> ${name}\n` +
                    `📞 <b>Тел:</b> ${phone}\n` +
                    `📍 <b>Тема/Адреса:</b> ${address || "Не вказано"}\n` +
                    `💬 <b>Текст:</b> ${comment}`;
        
        // Відправляємо в Телеграм (обов'язково з await)
        await sendToTg(msg, "MSG");
        
        console.log(`📩 Повідомлення від ${name} надіслано в ТГ`);
        
        // ВІДПОВІДАЄМО КЛІЄНТУ (щоб вікно знало, що все добре)
        return res.json({ success: true, message: "Повідомлення отримано" });
        
    } catch (err) {
        console.error("❌ Помилка обробки форми:", err.message);
        // Якщо навіть ТГ впав, кажемо клієнту, що щось не так
        return res.status(500).json({ success: false, error: "Серверна помилка" });
    }
});
