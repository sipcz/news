console.log("ADMIN NEWS JS LOADED");

let CURRENT_PASS = ""; // Зберігаємо пароль для подальших запитів

// 1. ВХІД В АДМІНКУ (Залишається JSON, бо тут тільки текст)
async function login() {
    const password = document.getElementById("adminPass").value;

    try {
        const res = await fetch("/api/admin/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pass: password })
        });

        if (res.ok) {
            CURRENT_PASS = password;
            document.getElementById("loginBox").style.display = "none";
            document.getElementById("adminPanel").style.display = "block";
            loadNews();
        } else {
            const err = await res.json();
            alert(err.error || "Невірний пароль");
        }
    } catch (e) {
        alert("Помилка з'єднання з сервером");
    }
}

// 2. ЗАВАНТАЖЕННЯ СПИСКУ НОВИН
async function loadNews() {
    const res = await fetch("/api/news");
    if (!res.ok) return;

    const news = await res.json();
    const list = document.getElementById("adminNewsList");
    list.innerHTML = "";

    news.forEach(n => {
        const div = document.createElement("div");
        div.className = "news-item";
        div.innerHTML = `
            <img src="${n.img || 'https://via.placeholder.com/150'}" style="width:100%; height:120px; object-fit:cover; border-radius:8px;">
            <div style="margin: 10px 0; font-weight: bold; font-size: 14px;">${n.title}</div>
            <div style="font-size: 12px; color: #d4af37;">${n.category}</div>
            <button onclick="deleteNews('${n.id}')" style="background:#ff4444; color: white; border: none; padding: 5px 10px; border-radius: 5px; cursor: pointer; margin-top:10px; width: 100%;">Видалити</button>
        `;
        list.appendChild(div);
    });
}

// 3. 🔥 ДОДАВАННЯ НОВИНИ (ТЕПЕР З ПІДТРИМКОЮ ФАЙЛІВ)
async function addNews() {
    // 🛡️ Перевірка "Медової пастки"
    const botTrap = document.getElementById("admin_bot_trap").value;
    if (botTrap !== "") return;

    const title = document.getElementById("newsTitle").value;
    const category = document.getElementById("newsCategory").value;
    const content = document.getElementById("newsContent").value;
    // Отримуємо файл з інпуту
    const imageInput = document.getElementById("newsImageInput"); 
    const imageFile = imageInput.files[0];

    if (!title || !content) {
        alert("Заповніть заголовок та текст!");
        return;
    }

    // Створюємо FormData замість звичайного об'єкта
    const formData = new FormData();
    formData.append("pass", CURRENT_PASS); // Пароль для перевірки
    formData.append("title", title);
    formData.append("category", category);
    formData.append("content", content);
    
    // Якщо файл вибрано — додаємо його в "конверт"
    if (imageFile) {
        formData.append("image", imageFile);
    }

    try {
        const res = await fetch("/api/news/add", {
            method: "POST",
            // ВАЖЛИВО: для FormData заголовки Content-Type ставити НЕ МОЖНА!
            body: formData 
        });

        if (res.ok) {
            // Очищаємо поля
            document.getElementById("newsTitle").value = "";
            document.getElementById("newsContent").value = "";
            imageInput.value = ""; // Очищаємо вибір файлу
            loadNews();
            alert("Новину опубліковано!");
        } else {
            const err = await res.json();
            alert(err.error || "Помилка публікації");
        }
    } catch (e) {
        alert("Помилка при відправці файлу");
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
