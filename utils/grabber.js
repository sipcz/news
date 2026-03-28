import Parser from 'rss-parser';
import { promises as fs } from 'fs';

// 1. ІНІЦІАЛІЗАЦІЯ З ПАСПОРТОМ БРАУЗЕРА
const parser = new Parser({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
        'Accept-Language': 'uk-UA,uk;q=0.9,de-DE;q=0.8,de;q=0.7,en-US;q=0.6,en;q=0.5'
    }
});

const NEWS_FILE = "./news-data.json";

const SOURCES = [
    { name: 'DW Україна', url: 'https://rss.dw.com/xml/rss-ukr-all' },
    { name: 'Новини Дрездена', url: 'https://www.dresden.de/rss/de/presseservice.xml' }
];

export async function autoFetchNews() {
    console.log("🔄 Початок авто-збору нових повідомлень...");
    
    try {
        let fileData = "[]";
        try {
            fileData = await fs.readFile(NEWS_FILE, "utf-8");
        } catch (e) { console.log("Створюю новий файл бази даних..."); }
        
        let news = JSON.parse(fileData || "[]");
        let initialCount = news.length;

        for (const source of SOURCES) {
            try {
                console.log(`📡 Запитую джерело: ${source.name}`);
                const feed = await parser.parseURL(source.url);

                feed.items.forEach(item => {
                    const exists = news.some(n => n.title === item.title);
                    
                    if (!exists) {
                        // Очищення тексту від HTML-тегів
                        const rawContent = item.contentSnippet || item.content || "";
                        const cleanContent = rawContent.replace(/<[^>]*>?/gm, '').substring(0, 400);

                        news.push({
                            // Використовуємо число для ID (мілісекунди) для точного сортування
                            id: Date.now() + Math.floor(Math.random() * 1000),
                            date: new Date(item.pubDate || Date.now()).toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' }),
                            title: item.title.trim(),
                            category: source.name,
                            img: "assets/img/auto-news.jpg",
                            content: cleanContent + "...",
                            link: item.link
                        });
                    }
                });
            } catch (err) {
                console.error(`❌ Помилка зчитування ${source.name}:`, err.message);
            }
        }

        // 2. СОРТУВАННЯ ТА ОБРІЗКА (Свіжі зверху)
        // Сортуємо за числовим ID: від найбільшого (найновішого) до найменшого
        news.sort((a, b) => Number(b.id) - Number(a.id));

        // Беремо перші 50 (найсвіжіші після сортування)
        const updatedNews = news.slice(0, 50);

        if (updatedNews.length > initialCount) {
            await fs.writeFile(NEWS_FILE, JSON.stringify(updatedNews, null, 2));
            console.log(`✅ Авто-збір завершено! Додано нових новин: ${updatedNews.length - initialCount}`);
        } else {
            console.log("ℹ️ Нових новин не знайдено.");
        }

    } catch (err) {
        console.error("❌ Критична помилка грабера:", err.message);
    }
}
