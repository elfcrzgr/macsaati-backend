const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');
const apn = require('apn');

// =========================================================================
// 🐍 PYTHON TLS BYPASS CLIENT
// =========================================================================

class PythonTLSBypassClient {
    constructor() {
        this.pythonScriptPath = path.join(__dirname, 'sofascore_bypass.py');
        this.requestCache = new Map();
        this.CACHE_EXPIRY = 5 * 60 * 1000;
    }

    async executePythonScript(url, retryCount = 0, maxRetries = 5) {
        return new Promise((resolve, reject) => {
            if (retryCount >= maxRetries) {
                console.log(`❌ [PYTHON TLS BYPASS BAŞARISIZ] ${maxRetries} denemenin ardından başarısız`);
                const cached = this.getFromCache(url);
                if (cached) {
                    console.log(`📦 Son çare olarak cache'den döndürülüyor...`);
                    resolve(cached);
                } else {
                    resolve(null);
                }
                return;
            }

            console.log(`🐍 [Python TLS Deneme ${retryCount + 1}/${maxRetries}] ${url.substring(0, 80)}...`);

            const python = spawn('python', [this.pythonScriptPath, url], {
                timeout: 15000,
                maxBuffer: 10 * 1024 * 1024
            });

            let stdout = '';
            let stderr = '';
            let timedOut = false;

            const timeout = setTimeout(() => {
                timedOut = true;
                python.kill();
                console.log(`⏱️ [TIMEOUT] Python process zaman aşımı`);
            }, 15000);

            python.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            python.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            python.on('close', async (code) => {
                clearTimeout(timeout);

                if (timedOut) {
                    console.log(`⏳ Timeout sonrası yeniden deneniyor...`);
                    await new Promise(r => setTimeout(r, 2000));
                    const retryResult = await this.executePythonScript(url, retryCount + 1, maxRetries);
                    resolve(retryResult);
                    return;
                }

                if (code === 0) {
                    try {
                        const result = JSON.parse(stdout);
                        
                        if (result.status === 'success') {
                            console.log(`✅ [PYTHON TLS BAŞARILI] Veri alındı!`);
                            this.cacheRequest(url, result.data);
                            resolve(result.data);
                        } else if (result.status === 'error_403') {
                            console.log(`⚠️ [403 FORBIDDEN] Fallback retry...`);
                            const exponentialBackoff = Math.min(1000 * Math.pow(2, retryCount), 30000);
                            const jitter = Math.random() * exponentialBackoff * 0.1;
                            const waitTime = exponentialBackoff + jitter;

                            console.log(`   ⏳ ${Math.round(waitTime / 1000)}s sonra tekrar deneniyor...`);
                            await new Promise(r => setTimeout(r, waitTime));
                            
                            const retryResult = await this.executePythonScript(url, retryCount + 1, maxRetries);
                            resolve(retryResult);
                        } else {
                            console.error(`❌ Python Hatası: ${result.error}`);
                            
                            if (retryCount < maxRetries - 1) {
                                const waitTime = 2000 * Math.pow(2, retryCount);
                                console.log(`   ⏳ ${Math.round(waitTime / 1000)}s sonra tekrar deneniyor...`);
                                await new Promise(r => setTimeout(r, waitTime));
                                const retryResult = await this.executePythonScript(url, retryCount + 1, maxRetries);
                                resolve(retryResult);
                            } else {
                                resolve(null);
                            }
                        }
                    } catch (e) {
                        console.error(`❌ JSON Parse Hatası: ${e.message}`);
                        resolve(null);
                    }
                } else {
                    console.error(`❌ Python Process Hatası (Code ${code}): ${stderr}`);
                    
                    if (retryCount < maxRetries - 1) {
                        const waitTime = 2000 * Math.pow(2, retryCount);
                        console.log(`   ⏳ ${Math.round(waitTime / 1000)}s sonra tekrar deneniyor...`);
                        await new Promise(r => setTimeout(r, waitTime));
                        
                        const retryResult = await this.executePythonScript(url, retryCount + 1, maxRetries);
                        resolve(retryResult);
                    } else {
                        resolve(null);
                    }
                }
            });

            python.on('error', (error) => {
                clearTimeout(timeout);
                console.error(`❌ Python Spawn Hatası: ${error.message}`);
                reject(error);
            });
        });
    }

    cacheRequest(url, data) {
        this.requestCache.set(url, {
            data: data,
            timestamp: Date.now()
        });
    }

    getFromCache(url) {
        const cached = this.requestCache.get(url);
        if (cached && (Date.now() - cached.timestamp) < this.CACHE_EXPIRY) {
            console.log(`📦 Cache'den alındı (${Math.round((Date.now() - cached.timestamp) / 1000)}s eski)`);
            return cached.data;
        }
        this.requestCache.delete(url);
        return null;
    }

    async fetch(url, maxRetries = 5) {
        const cached = this.getFromCache(url);
        if (cached) {
            return cached;
        }

        const result = await this.executePythonScript(url, 0, maxRetries);
        
        if (!result && url.includes('sofascore.com')) {
            console.log(`⚠️ Son çare: Cache'den eski veri döndürülüyor...`);
            for (const [cachedUrl, cachedData] of this.requestCache.entries()) {
                if (cachedUrl.includes(url.split('?')[0])) {
                    console.log(`📦 Yedek cache kullanılıyor (Eski veri uyarısı!)`);
                    return cachedData.data;
                }
            }
        }

        return result;
    }
}

// =========================================================================
// 🔥 TLS CLIENT'İ BAŞLAT
// =========================================================================

const tlsClient = new PythonTLSBypassClient();

// Eski fetchData yerine kullan
async function fetchData(url) {
    console.log(`\n🚀 [TLS BYPASS FETCH] ${url.substring(0, 100)}...`);
    return await tlsClient.fetch(url);
}

// =========================================================================
// 🔥 AYARLAR
// =========================================================================
const IS_PRODUCTION = false;
const serviceAccount = JSON.parse(fs.readFileSync('./serviceAccountKey.json', 'utf8'));

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app/"
});

console.log("🔥 Firebase Admin başlatıldı.");

const apnProvider = new apn.Provider({
    token: {
        key: __dirname + "/AuthKey_9JFB2X7TY9.p8",
        keyId: "9JFB2X7TY9",
        teamId: "9MQ7UDX75J"
    },
    production: IS_PRODUCTION
});

console.log(`🍏 Apple APNs hazır.`);

// =========================================================================
// 🧠 GLOBAL VARIABLES
// =========================================================================

const previousMatchStates = new Map();
const pendingGoalCancel = new Map();
const globalFootballCache = new Map();
const triggeredMatches = new Set();

const sportUpdateStatus = {
    football: {
        lastFullUpdate: 0,
        lastQuickUpdate: 0,
        nextMatchTime: null,
        hasLiveMatch: false,
        isInQuickMode: false
    }
};

const STATE_FILE = 'match_states.json';

// =========================================================================
// 🛠️ HELPER FUNCTIONS
// =========================================================================

function saveState() {
    const obj = Object.fromEntries(previousMatchStates);
    fs.writeFileSync(STATE_FILE, JSON.stringify(obj));
}

function loadState() {
    if (fs.existsSync(STATE_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            for (const [key, val] of Object.entries(data)) {
                previousMatchStates.set(key, val);
            }
            console.log(`📂 [HAFIZA] ${previousMatchStates.size} maç durumu yüklendi.`);
        } catch (e) {
            console.error("❌ Hafıza dosyası okunamadı.");
        }
    }
}

async function uploadToFirebase(sportName, data) {
    try {
        const db = admin.database();
        const ref = db.ref(`matches_${sportName}`);
        await ref.set(data);
        console.log(`✅ [FIREBASE] ${sportName.toUpperCase()} güncellendi!`);
    } catch (error) {
        console.error(`❌ [FIREBASE] Hata:`, error.message);
    }
}

const getTRDate = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
};

// =========================================================================
// ⚽ FUTBOL YAPISI
// =========================================================================

const ELITE_FOOT_IDS = [17, 8, 35, 23, 34, 52, 37, 38, 238, 36, 19, 96, 97, 98, 7, 679, 17015, 16, 1, 133, 270, 53, 335, 13363, 26796];
const REGULAR_FOOT_IDS = [299, 155, 325, 955, 18, 6516, 242, 11415, 11416, 11417, 15938, 851, 88783];
const ALL_FOOT_TARGETS = [...ELITE_FOOT_IDS, ...REGULAR_FOOT_IDS];

const footballLeagues = {
    17: "İngiltere Premier Lig",
    8: "İspanya La Liga",
    35: "Almanya Bundesliga",
    23: "İtalya Serie A",
    34: "Fransa Ligue 1",
    52: "Türkiye Süper Lig"
};

function calculateLiveMinute(eventData) {
    if (!eventData) return "";
    const status = eventData.status;
    const time = eventData.time;
    const code = status?.code;

    if (code === 31) return "İY";
    if (code === 50 || code === 60) return "PEN";
    if (code === 34) return "90+";

    if (time?.currentMinute !== undefined && time.currentMinute !== null) {
        return String(time.currentMinute) + "'";
    }

    return "Canlı";
}

// =========================================================================
// 🔔 NOTIFICATIONS
// =========================================================================

const lastNotificationTime = new Map();

async function sendPush(id, title, body, imageUrl = null, matchData = null) {
    const now = Date.now();
    const lastTime = lastNotificationTime.get(id) || 0;
    if (now - lastTime < 15000) return;

    try {
        const payload = {
            topic: `match_${id}`,
            notification: {
                title: title,
                body: body
            },
            data: {
                matchId: String(id),
                type: "match_update"
            }
        };

        await admin.messaging().send(payload);
        lastNotificationTime.set(id, now);
        console.log(`✅ [BİLDİRİM] ${title}: ${body}`);
    } catch (e) {
        console.error("❌ Bildirim Hatası:", e.message);
    }
}

async function checkAndSendNotifications(newMatches) {
    for (const match of newMatches) {
        const matchIdStr = String(match.id);
        const prev = previousMatchStates.get(matchIdStr) || {
            status: null,
            homeScore: 0,
            awayScore: 0,
            hasNotifiedStart: false,
            hasNotifiedFinished: false
        };

        let currH = parseInt(match.homeScore) || 0;
        let currA = parseInt(match.awayScore) || 0;

        if (match.status === 'inprogress' && !prev.hasNotifiedStart) {
            await sendPush(matchIdStr, "Maç Saati", `⚽ ${match.homeTeam.name} - ${match.awayTeam.name}`, null, match);
            prev.hasNotifiedStart = true;
        }

        if (['finished', 'ended', 'closed'].includes(match.status) && !prev.hasNotifiedFinished) {
            if (prev.status === 'inprogress') {
                await sendPush(matchIdStr, "Maç Saati", `🏁 ${match.homeTeam.name} ${match.homeScore} - ${match.awayScore} ${match.awayTeam.name}`, null, match);
            }
            prev.hasNotifiedFinished = true;
        }

        previousMatchStates.set(matchIdStr, {
            status: match.status,
            homeScore: currH,
            awayScore: currA,
            hasNotifiedStart: prev.hasNotifiedStart,
            hasNotifiedFinished: prev.hasNotifiedFinished,
            date: match.fixedDate || getTRDate(0)
        });
    }

    saveState();
}

// =========================================================================
// ⚽ FUTBOL GÜNCELLEME
// =========================================================================

async function updateFootball(targetDates = [getTRDate(0)]) {
    console.log(`\n⚽ Futbol güncelleniyor... (${targetDates.length} gün)`);

    let allEvents = [];

    for (const date of targetDates) {
        const data = await fetchData(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`);
        if (data?.events) {
            allEvents.push(...data.events.filter(e => ALL_FOOT_TARGETS.includes(e.tournament?.uniqueTournament?.id)));
        }
    }

    if (allEvents.length === 0) {
        console.log("⚠️ Maç bulunamadı.");
        return {
            hasLiveMatch: sportUpdateStatus.football.hasLiveMatch,
            nextMatchTimestamp: sportUpdateStatus.football.nextMatchTime,
            hasAnyMatches: false
        };
    }

    let matches = [];

    allEvents.forEach(e => {
        const status = e.status?.type || "";
        if (status === 'canceled' || status === 'postponed') return;

        const dateTR = new Date(e.startTimestamp * 1000);
        const dayTR = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });

        const leagueId = e.tournament?.uniqueTournament?.id;
        const isLive = status === 'inprogress';

        let finalHomeScore = isLive ? String(e.homeScore?.display ?? "0") : "-";
        let finalAwayScore = isLive ? String(e.awayScore?.display ?? "0") : "-";

        const match = {
            id: e.id,
            status: status,
            statusCode: e.status?.code,
            liveMinute: isLive ? calculateLiveMinute(e) : "",
            fixedDate: dayTR,
            timestamp: e.startTimestamp * 1000,
            homeTeam: { 
                name: e.homeTeam.name,
                id: e.homeTeam.id 
            },
            awayTeam: { 
                name: e.awayTeam.name,
                id: e.awayTeam.id 
            },
            homeScore: finalHomeScore,
            awayScore: finalAwayScore,
            tournament: footballLeagues[leagueId] || "Futbol"
        };

        globalFootballCache.set(e.id, match);
        matches.push(match);
    });

    await checkAndSendNotifications(matches);
    await uploadToFirebase("football", { 
        success: true, 
        lastUpdate: new Date().toLocaleTimeString('tr-TR'), 
        matches 
    });

    const hasLiveMatch = matches.some(m => m.status === 'inprogress');
    
    console.log(`  ✅ Toplam ${matches.length} futbol maçı ${hasLiveMatch ? '(🟢 CANLI)' : '(⚪ Yok)'}`);

    return { 
        hasLiveMatch, 
        nextMatchTimestamp: null,
        hasAnyMatches: matches.length > 0 
    };
}

// =========================================================================
// 🔄 ANA DÖNGÜ
// =========================================================================

async function main() {
    loadState();
    console.log("\n============================================================");
    console.log("🟢 SOFASCORE TLS BYPASS SUNUCU BAŞLADI");
    console.log("============================================================\n");

    let iteration = 1;

    while (true) {
        try {
            const now = Date.now();
            console.log(`[İterasyon ${iteration}] ${new Date().toLocaleTimeString('tr-TR')}`);

            const days = [getTRDate(-1), getTRDate(0), getTRDate(1)];
            const result = await updateFootball(days);

            sportUpdateStatus.football.hasLiveMatch = result.hasLiveMatch;

            const sleepTime = result.hasLiveMatch ? 60000 : 600000;
            console.log(`${result.hasLiveMatch ? '⚡' : '💤'} ${sleepTime / 1000}s uyku...\n`);

            await new Promise(r => setTimeout(r, sleepTime));
            iteration++;

        } catch (e) {
            console.error("🚨 Hata:", e.message);
            await new Promise(r => setTimeout(r, 60000));
        }
    }
}

main();
