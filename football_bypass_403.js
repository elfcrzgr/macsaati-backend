// =========================================================================
// 🔓 SOFASCORE 403 BYPASS - AGRESIF ÇÖZÜM
// =========================================================================

const fetch = global.fetch || require('node-fetch');


// 1️⃣ ROTATING USER-AGENTS
const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
];

const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

// 2️⃣ RANDOM DELAY
const getRandomDelay = (min = 500, max = 3000) => {
    return new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
};

// 3️⃣ REQUEST COUNTER (spam kontrolü)
let requestCount = 0;
let lastResetTime = Date.now();

const resetCounter = () => {
    if (Date.now() - lastResetTime > 60000) {
        requestCount = 0;
        lastResetTime = Date.now();
    }
};

// 4️⃣ HEADERS ROTASYONU
const getHeaders = () => {
    const ua = getRandomUserAgent();
    return {
        'User-Agent': ua,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8,en-US;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Referer': 'https://www.sofascore.com/',
        'Origin': 'https://www.sofascore.com'
    };
};

// 5️⃣ URL ALTERNATİFLERİ (www vs api vs m)
const getUrlVariants = (url) => {
    return [
        url.replace('www.sofascore.com', 'www.sofascore.com'),
        url.replace('www.sofascore.com', 'api.sofascore.com'),
        url.replace('www.sofascore.com', 'm.sofascore.com'),
    ];
};

// 6️⃣ RETRY WITH BACKOFF
async function fetchWithRetry(url, retryCount = 0, maxRetries = 5) {
    resetCounter();
    
    if (retryCount > 0) {
        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 30000);
        console.log(`⏳ ${delay}ms bekleniyor... (Deneme ${retryCount}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
    }

    try {
        // URL variant seç
        const variants = getUrlVariants(url);
        const finalUrl = variants[retryCount % variants.length];
        
        // Random delay ekle
        await getRandomDelay(300, 1500);

        console.log(`📡 [${retryCount}] Çekiliyor: ${finalUrl.substring(0, 70)}...`);

        const response = await fetch(finalUrl, {
            method: 'GET',
            headers: getHeaders(),
            timeout: 20000,
        });

        // 403 hatası
        if (response.status === 403) {
            console.log(`⚠️ 403 Hatası (deneme ${retryCount + 1}/${maxRetries})`);
            
            if (retryCount < maxRetries) {
                return fetchWithRetry(url, retryCount + 1, maxRetries);
            }
            return null;
        }

        // 404 hatası
        if (response.status === 404) {
            console.log(`ℹ️ 404 - Veri yok`);
            return { is404: true };
        }

        // Rate limit
        if (response.status === 429) {
            console.log(`⏱️ Rate limit! 120 saniye bekleniyor...`);
            await new Promise(r => setTimeout(r, 120000));
            return fetchWithRetry(url, 0, maxRetries);
        }

        // Başarı
        if (response.ok) {
            console.log(`✅ Başarılı!`);
            requestCount++;
            return await response.json();
        }

        // Diğer hatalar
        console.log(`⚠️ HTTP ${response.status}`);
        if (retryCount < maxRetries) {
            return fetchWithRetry(url, retryCount + 1, maxRetries);
        }
        return null;

    } catch (error) {
        console.error(`❌ Hata: ${error.message}`);
        
        if (retryCount < maxRetries) {
            return fetchWithRetry(url, retryCount + 1, maxRetries);
        }
        return null;
    }
}

// 7️⃣ MAIN EXPORT
async function fetchDataWithBypass(url) {
    return await fetchWithRetry(url, 0, 5);
}

module.exports = {
    fetchDataWithBypass
};
