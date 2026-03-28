// Перемикач теми (залишаємо, це корисно)
function toggleTheme() {
    document.body.classList.toggle("light-theme");
}

// ГОЛОВНА ФУНКЦІЯ: Завантаження новин
async function renderNews() {
    try {
        // Змінюємо шлях на /api/news
        const res = await fetch("/api/news");
        if (!res.ok) throw new Error("Помилка завантаження");
        
        const news = await res.json();
        const container = document.getElementById("newsGrid"); // ID з нашого нового index.html
        
        if (!container) return;

        // Використовуємо .map().join('') — це набагато швидше, ніж += в циклі
        container.innerHTML = news.map(article => `
            <div class="news-card" onclick="openNews('${encodeURIComponent(JSON.stringify(article))}')">
                <img src="${article.img || 'assets/img/news-placeholder.jpg'}" alt="news">
                <div class="news-info">
                    <span class="news-tag">${article.category}</span>
                    <h3 class="news-title">${article.title}</h3>
                    <div class="news-date">${article.date}</div>
                </div>
            </div>
        `).join('');

    } catch (err) {
        console.error("Помилка:", err);
        const container = document.getElementById("newsGrid");
        if (container) container.innerHTML = "<p>Не вдалося завантажити новини...</p>";
    }
}

// Функція для відкриття модального вікна (яку ми додали в index.html)
function openNews(data) {
    const n = JSON.parse(decodeURIComponent(data));
    
    const modal = document.getElementById('newsModal');
    if (!modal) return;

    document.getElementById('mImg').src = n.img;
    document.getElementById('mTitle').innerText = n.title;
    document.getElementById('mDate').innerText = n.date;
    document.getElementById('mText').innerText = n.content;

    modal.style.display = 'block';
    document.body.style.overflow = 'hidden'; // Заборона скролу фону
}

// Закриття модалки
function closeNews() {
    const modal = document.getElementById('newsModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = 'auto';
}

// Запускаємо рендер при завантаженні
document.addEventListener("DOMContentLoaded", renderNews);