import Parser from 'rss-parser';
import { promises as fs } from 'fs';

const parser = new Parser();
const NEWS_FILE = "./news-data.json";

// Список джерел (можна додавати свої)
const SOURCES = [
    { name: 'DW Україна', url: 'https://rss.dw.com/xml/rss-ukr-all' }, // Німецькі новини українською
    { name: 'Новини Дрездена', url: 'https://www.dresden.de/rss/de/presseservice.xml' } // Місцеві (німецькою)
];

export async function autoFetchNews() {
    console.log("🔄 Початок авто-збору новин...");
    
    try {
        const fileData = await fs.readFile(NEWS_FILE, "utf-8");
        let news = JSON.parse(fileData || "[]");

        for (const source of SOURCES) {
            const feed = await parser.parseURL(source.url);

            feed.items.forEach(item => {
                // Перевіряємо, чи немає вже такої новини (за заголовком)
                const exists = news.some(n => n.title === item.title);
                
                if (!exists) {
                    news.push({
                        id: Date.now() + Math.random(),
                        date: new Date(item.pubDate).toLocaleString('uk-UA'),
                        title: item.title,
                        category: source.name,
                        img: "assets/img/auto-news.jpg", // Можна ставити лого джерела
                        content: item.contentSnippet || item.content || "Читати детальніше на сайті джерела...",
                        link: item.link // Додаємо посилання на оригінал
                    });
                }
            });
        }

        // Залишаємо тільки останні 50 новин, щоб файл не роздувався
        const updatedNews = news.slice(-50);
        await fs.writeFile(NEWS_FILE, JSON.stringify(updatedNews, null, 2));
        console.log("✅ Авто-збір завершено!");

    } catch (err) {
        console.error("❌ Помилка авто-збору:", err.message);
    }
}