import https from 'https';

// Вкажи тут адресу свого сайту
const URL = 'https://sip-lo83.onrender.com/'; 
// Інтервал: 14 хвилин (щоб Render не встиг заснути через 15 хв)
const INTERVAL = 14 * 60 * 1000; 

console.log(`Запущено пінгатор для ${URL}`);

setInterval(() => {
    https.get(URL, (res) => {
        console.log(`[${new Date().toLocaleTimeString()}] Статус: ${res.statusCode}`);
    }).on('error', (err) => {
        console.error(`[${new Date().toLocaleTimeString()}] Помилка: ${err.message}`);
    });
}, INTERVAL);

// Перший пінг відразу при запуску
https.get(URL);
