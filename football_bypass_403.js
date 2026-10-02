// =========================================================================
// 🔓 SOFASCORE 403 BYPASS ÇÖZÜMLERI
// =========================================================================

// 1️⃣ ROTATING USER-AGENTS (En etkili yöntem)
const USER_AGENTS = [
    // Chrome Desktop
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    
    // Firefox
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:91.0) Gecko/20100101 Firefox/91.0",
    "Mozilla/5.0 (X11; Linux x86_64; rv:89.0) Gecko/20100101 Firefox/89.0",
    
    // Safari
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15",
    
    // Edge
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/91.0.864.59",
    
    // Opera
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 OPR/77.0.4054.254",
    
    // Mobile
    "Mozilla/5.0 (Linux; Android 11; SM-G991B) AppleWebKit/537.36",
    "Mozilla/5.0 (iPad; CPU OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15"
];

const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

// 2️⃣ HEADER ROTASYONu (Accept-Language ve diğer header'lar)
const HEADER_VARIANTS = [
    {
        "User-Agent": getRandomUserAgent(),
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "DNT": "1",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Cache-Control": "max-age=0"
    },
    {
        "User-Agent": getRandomUserAgent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1"
    },
    {
        "User-Agent": getRandomUserAgent(),
        "Accept": "application/json",
        "Accept-Language": "de-DE,de;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Pragma": "no-cache",
        "Cache-Control": "no-cache"
    }
];

const getRandomHeaders = () => {
    const variant = HEADER_VARIANTS[Math.floor(Math.random() * HEADER_VARIANTS.length)];
    return {
        ...variant,
        "User-Agent": getRandomUserAgent()
    };
};

// 3️⃣ PROXY SUNUCULARI (Türkiye ve Avrupa bazlı)
const PROXY_LIST = [
    // Ücretsiz proxy'ler (düşük başarı oranı ama denemeye değer)
    // NOT: Bunları kendi proxy'lerinizle değiştirin
    // "http://proxy1.example.com:8080",
    // "http://proxy2.example.com:3128"
];

// 4️⃣ DELAY STRATEJİSİ (Isınma ve yavaş yapma)
const getAdaptiveDelay = (retryCount = 0) => {
    const baseDelay = 1000 + Math.random() * 2000; // 1-3 saniye
    const exponentialBackoff = Math.pow(2, Math.min(retryCount, 5)) * 1000;
    return baseDelay + exponentialBackoff;
};

// 5️⃣ RETRY MANTIGI VE CIRCUIT BREAKER
class SofascoreBypass {
    constructor() {
        this.failureCount = 0;
        this.lastFailureTime = 0;
        this.isCircuitOpen = false;
        this.circuitTimeout = 30000; // 30 saniye
        this.maxFailures = 5;
    }

    checkCircuitBreaker() {
        if (this.isCircuitOpen) {
            const timeSinceLastFailure = Date.now() - this.lastFailureTime;
            if (timeSinceLastFailure > this.circuitTimeout) {
                console.log("🔌 Circuit breaker reset - tekrar deneniyor...");
                this.isCircuitOpen = false;
                this.failureCount = 0;
            } else {
                return false;
            }
        }
        return true;
    }

    recordFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        if (this.failureCount >= this.maxFailures) {
            this.isCircuitOpen = true;
            console.log("⛔ Circuit breaker açıldı - çok fazla hata!");
        }
    }

    recordSuccess() {
        this.failureCount = 0;
        this.isCircuitOpen = false;
    }
}

const bypasser = new SofascoreBypass();

// 6️⃣ GELİŞTİRİLMİŞ FETCH FONKSIYONU
async function fetchDataBypass(url, retryCount = 0) {
    // Circuit breaker kontrolü
    if (!bypasser.checkCircuitBreaker()) {
        console.log("🔌 Circuit breaker açık - istek reddediliyor");
        return null;
    }

    try {
        const delay = getAdaptiveDelay(retryCount);
        await new Promise(r => setTimeout(r, delay));

        // URL seçimi (api vs www)
        let finalUrl = url;
        if (retryCount % 2 === 0) {
            finalUrl = url.replace('www.sofascore.com', 'api.sofascore.com');
        } else {
            // Alternatif: bazı isteklerde www tutun
            finalUrl = url;
        }

        const headers = getRandomHeaders();
        
        // CSRF-like davranış: referrer ve origin değişkeni
        if (retryCount > 0) {
            headers["Referer"] = "https://www.sofascore.com/";
        }

        console.log(`📡 [${retryCount}. deneme] Fetch: ${finalUrl.substring(0, 80)}...`);

        const response = await fetch(finalUrl, {
            headers: headers,
            timeout: 15000, // Node.js fetch için
            signal: AbortSignal.timeout(15000) // Browser-style timeout
        });

        if (response.status === 403) {
            console.log(`⚠️ 403 Hatası (deneme ${retryCount + 1})`);
            bypasser.recordFailure();
            
            // Retry mantığı
            if (retryCount < 3) {
                const nextDelay = getAdaptiveDelay(retryCount + 1);
                console.log(`🔄 ${nextDelay}ms sonra yeniden denenecek...`);
                await new Promise(r => setTimeout(r, nextDelay));
                return fetchDataBypass(url, retryCount + 1);
            }
            return null;
        }

        if (response.status === 404) {
            return { is404: true };
        }

        if (!response.ok) {
            console.log(`⚠️ API Hatası (HTTP ${response.status})`);
            if (response.status === 429) {
                console.log("⏰ Rate limit - daha uzun bekleme...");
                await new Promise(r => setTimeout(r, 60000)); // 1 dakika bekle
            }
            return null;
        }

        const data = await response.json();
        bypasser.recordSuccess();
        return data;

    } catch (e) {
        console.error(`❌ Fetch hatası: ${e.message}`);
        bypasser.recordFailure();
        
        if (retryCount < 3 && e.message !== 'signal' && e.name !== 'AbortError') {
            return fetchDataBypass(url, retryCount + 1);
        }
        return null;
    }
}

// 7️⃣ API ENDPOINT ALTERNATİFLERİ
const getAlternativeApiUrl = (leagueId, date, attemptNum = 0) => {
    const variants = [
        `https://api.sofascore.com/api/v1/unique-tournament/${leagueId}/scheduled-events/${date}`,
        `https://www.sofascore.com/api/v1/unique-tournament/${leagueId}/scheduled-events/${date}`,
        // Bazen mobile endpoint farklı çalışır
        `https://m.sofascore.com/api/v1/unique-tournament/${leagueId}/scheduled-events/${date}`,
    ];
    return variants[attemptNum % variants.length];
};

// 8️⃣ BATCH REQUEST LIMITER (Rate limiting'i aşmamak için)
class RateLimiter {
    constructor(requestsPerSecond = 2) {
        this.requestsPerSecond = requestsPerSecond;
        this.requestTimes = [];
    }

    async wait() {
        const now = Date.now();
        this.requestTimes = this.requestTimes.filter(t => now - t < 1000);
        
        if (this.requestTimes.length >= this.requestsPerSecond) {
            const oldestTime = this.requestTimes[0];
            const waitTime = 1000 - (now - oldestTime) + 100;
            console.log(`⏸️ Rate limit - ${waitTime}ms bekliyor...`);
            await new Promise(r => setTimeout(r, waitTime));
        }
        
        this.requestTimes.push(Date.now());
    }
}

const rateLimiter = new RateLimiter(2); // Saniyede 2 istek

// 9️⃣ ENTEGRE ÇÖZÜM
async function fetchDataWithBypass(url) {
    await rateLimiter.wait();
    return fetchDataBypass(url, 0);
}

// =========================================================================
// 📋 KULLANIM ÖRNEĞI
// =========================================================================

// Önceki `fetchData` fonksiyonunu değiştirin:
// const data = await fetchData(url);
// 
// Bununla:
// const data = await fetchDataWithBypass(url);

module.exports = {
    fetchDataWithBypass,
    fetchDataBypass,
    getRandomUserAgent,
    getRandomHeaders,
    RateLimiter,
    SofascoreBypass
};
