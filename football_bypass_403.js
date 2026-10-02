const fetch = global.fetch || require('node-fetch');

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

        const response = await fetch(finalUrl, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
                'Referer': 'https://www.sofascore.com/',
                'Origin': 'https://www.sofascore.com'
            }
        });

        if (response.status === 403) {
            if (retryCount < maxRetries) return fetchWithRetry(url, retryCount + 1, maxRetries);
            return null;
        }

        if (response.status === 404) return { is404: true };
        if (!response.ok) return null;

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

module.exports = { fetchDataWithBypass };    try {
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
