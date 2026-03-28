console.log("ADMIN NEWS JS LOADED");

let CURRENT_PASS = ""; // Зберігаємо пароль для подальших запитів

// 1. ВХІД В АДМІНКУ
async function login() {
    const password = document.getElementById("adminPass").value;

    try {
        const res = await fetch("/api/admin/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pass: password }) //
        });

        if (res.ok) {
            CURRENT_PASS = password;
            document.getElementById("loginBox").style.display = "none";
            document.getElementById("adminPanel").style.display = "block";
            loadNews(); // Завантажуємо новини після входу
        } else {
            const err = await res.json();
            alert(err.error || "Невірний пароль"); //
        }
    } catch (e) {
        alert("Помилка з'єднання з сервером");
    }
}

// 2. ЗАВАНТАЖЕННЯ СПИСКУ НОВИН
async function loadNews() {
    const res = await fetch("/api/news"); //
    if (!res.ok) return;

    const news = await res.json();
    const list = document.getElementById("adminNewsList");
    list.innerHTML = "";

    news.forEach(n => {
        const div = document.createElement("div");
        div.className = "news-item";
        div.innerHTML = `
            <img src="${n.img || 'https://via.placeholder.com/150'}" style="width:100%; height:120px; object-fit:cover; border-radius:8px;">
            <div style="margin: 10px 0; font-weight: bold;">${n.title}</div>
            <div style="font-size: 12px; color: #d4af37;">${n.category}</div>
            <button onclick="deleteNews('${n.id}')" style="background:#ff4444; margin-top:10px;">Видалити</button>
        `;
        list.appendChild(div);
    });
}

// 3. ДОДАВАННЯ НОВИНИ (З ЗАХИСТОМ ВІД БОТІВ)
async function addNews() {
    // 🛡️ Перевірка "Медової пастки" (Honeypot)
    const botTrap = document.getElementById("admin_bot_trap").value;
    if (botTrap !== "") {
        console.warn("Bot detected!");
        return; 
    }

    const article = {
        title: document.getElementById("newsTitle").value,
        category: document.getElementById("newsCategory").value,
        img: document.getElementById("newsImg").value,
        content: document.getElementById("newsContent").value
    };

    if (!article.title || !article.content) {
        alert("Будь ласка, заповніть заголовок та текст!");
        return;
    }

    const res = await fetch("/api/news/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pass: CURRENT_PASS, article })
    });

    if (res.ok) {
        // Очищаємо поля
        document.getElementById("newsTitle").value = "";
        document.getElementById("newsContent").value = "";
        loadNews();
        alert("Новину опубліковано!");
    } else {
        alert("Помилка публікації");
    }
}

// 4. ВИДАЛЕННЯ НОВИНИ
async function deleteNews(id) {
    if (!confirm("Видалити цю новину?")) return;

    const res = await fetch("/api/news/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pass: CURRENT_PASS, id: id })
    });

    if (res.ok) {
        loadNews();
    } else {
        alert("Помилка при видаленні");
    }
}

function logout() {
    CURRENT_PASS = "";
    location.reload();
}