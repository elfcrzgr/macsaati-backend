const fetch = global.fetch || require('node-fetch');

const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
];

const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const getRandomDelay = (min = 500, max = 3000) => {
    return new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
};

const getHeaders = () => ({
    'User-Agent': getRandomUserAgent(),
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
    'Referer': 'https://www.sofascore.com/',
    'Origin': 'https://www.sofascore.com'
});

async function fetchWithRetry(url, retryCount = 0, maxRetries = 5) {
    try {
        if (retryCount > 0) {
            const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 30000);
            console.log(`⏳ ${delay}ms bekleniyor... (Deneme ${retryCount}/${maxRetries})`);
            await new Promise(r => setTimeout(r, delay));
        }

        const finalUrl = url
            .replace('www.sofascore.com', 'api.sofascore.com')
            .replace('m.sofascore.com', 'api.sofascore.com');

        await getRandomDelay(300, 1500);

        console.log(`📡 [${retryCount}] Çekiliyor: ${finalUrl.substring(0, 70)}...`);

        const response = await fetch(finalUrl, {
            method: 'GET',
            headers: getHeaders()
        });

        if (response.status === 403) {
            console.log(`⚠️ 403 Hatası (deneme ${retryCount + 1}/${maxRetries})`);
            if (retryCount < maxRetries) return fetchWithRetry(url, retryCount + 1, maxRetries);
            return null;
        }

        if (response.status === 404) return { is404: true };
        if (response.status === 429) {
            console.log(`⏱️ Rate limit! 120 saniye bekleniyor...`);
            await new Promise(r => setTimeout(r, 120000));
            return fetchWithRetry(url, 0, maxRetries);
        }

        if (!response.ok) return null;

        console.log(`✅ Başarılı!`);
        return await response.json();
    } catch (error) {
        console.error(`❌ Hata: ${error.message}`);
        if (retryCount < maxRetries) return fetchWithRetry(url, retryCount + 1, maxRetries);
        return null;
    }
}

async function fetchDataWithBypass(url) {
    return await fetchWithRetry(url, 0, 5);
}

module.exports = { fetchDataWithBypass };
