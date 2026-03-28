import Parser from 'rss-parser';
import { promises as fs } from 'fs';
import axios from 'axios';
import translate from 'translate-google-api';

const parser = new Parser();
const NEWS_FILE = "./news-data.json";

const SOURCES = [
    { name: 'DW Україна', url: 'https://rss.dw.com/xml/rss-ukr-all', translate: false },
    { name: 'Новини Дрездена', url: 'https://www.dresden.de/rss/de/presseservice.xml', translate: true }
];

export async function autoFetchNews() {
    console.log("🔄 Запуск автономного грабера (Axios + Translate)...");
    
    try {
        let fileData = "[]";
        try {
            fileData = await fs.readFile(NEWS_FILE, "utf-8");
        } catch (e) { console.log("Створюю файл бази даних..."); }
        
        let news = JSON.parse(fileData || "[]");
        let initialCount = news.length;

        for (const source of SOURCES) {
            try {
                console.log(`📡 Запитую: ${source.name}`);
                
                // Пробиваємо "стіну" Дрездена через Axios з імітацією браузера
                const response = await axios.get(source.url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                        'Accept-Language': 'de-DE,de;q=0.9,uk-UA;q=0.8,uk;q=0.7'
                    },
                    timeout: 15000 
                });

                const feed = await parser.parseString(response.data);

                // Використовуємо for...of, щоб await працював коректно
                for (const item of feed.items) {
                    if (!news.some(n => n.title === item.title)) {
                        
                        let titleUA = item.title;
                        let contentRaw = item.contentSnippet || item.content || "";
                        // Очистка від HTML тегів перед перекладом
                        let contentUA = contentRaw.replace(/<[^>]*>?/gm, '');

                        // Якщо треба перекладати (для Дрездена)
                        if (source.translate) {
                            try {
                                console.log(`🤖 Перекладаю: ${titleUA.substring(0, 35)}...`);
                                const translated = await translate([titleUA, contentUA], {
                                    tld: "com",
                                    to: "uk",
                                });
                                titleUA = translated[0];
                                contentUA = translated[1];
                            } catch (trErr) {
                                console.error("⚠️ Переклад тимчасово недоступний, лишаю оригінал.");
                            }
                        }

                        news.push({
                            id: Date.now() + Math.floor(Math.random() * 1000),
                            date: new Date(item.pubDate || Date.now()).toLocaleString('uk-UA', { timeZone: 'Europe/Berlin' }),
                            title: titleUA.trim(),
                            category: source.name,
                            img: "assets/img/auto-news.jpg",
                            content: contentUA.substring(0, 400) + "...",
                            link: item.link
                        });
                    }
                }
            } catch (err) {
                console.error(`❌ Джерело ${source.name} заблокувало запит або недоступне:`, err.message);
            }
        }

        // Сортуємо: нові (більший ID) на початок
        news.sort((a, b) => Number(b.id) - Number(a.id));

        // Лишаємо тільки 100 найактуальніших
        const updatedNews = news.slice(0, 100);

        if (updatedNews.length > initialCount) {
            await fs.writeFile(NEWS_FILE, JSON.stringify(updatedNews, null, 2));
            console.log(`✅ Успіх! Додано та перекладено: ${updatedNews.length - initialCount} новин.`);
        } else {
            console.log("ℹ️ Нових новин у Дрездені та DW поки немає.");
        }

    } catch (err) {
        console.error("❌ Критична помилка роботи грабера:", err.message);
    }
}
