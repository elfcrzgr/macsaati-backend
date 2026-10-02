const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const apn = require('apn');

require('events').EventEmitter.defaultMaxListeners = 100;

// =========================================================================
// 🔥 AYARLAR VE ÇALIŞMA ORTAMI
// =========================================================================
const IS_PRODUCTION = true; 
const STATE_FILE = 'futbol_states.json';
const GITHUB_USER = "elfcrzgr";
const REPO_NAME = "macsaati-backend";
const MINUTE_MS = 60000;

const TELEGRAM_BOT_TOKEN = "8401956459:AAEFkkO8Z0mj3BV73m8FQiYTz2oLeqGrCTY";
const TELEGRAM_CHAT_ID = "1168053894";

// =========================================================================
// 🔥 FIREBASE & APNs BAŞLATMA
// =========================================================================
const serviceAccount = JSON.parse(fs.readFileSync('./serviceAccountKey.json', 'utf8'));
const firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app/"
}, 'football_app');
console.log("🔥 [FUTBOL] Firebase Admin başlatıldı.");

const apnProvider = new apn.Provider({
    token: {
        key: __dirname + "/AuthKey_9JFB2X7TY9.p8",
        keyId: "9JFB2X7TY9",
        teamId: "9MQ7UDX75J"
    },
    production: IS_PRODUCTION
});
console.log(`🍏 [FUTBOL] Apple APNs hazır. (Mod: ${IS_PRODUCTION ? "CANLI" : "GELİŞTİRİCİ"})`);

// =========================================================================
// 🧠 GLOBAL HAFIZA (CACHE) VE DURUM YÖNETİMİ
// =========================================================================
const previousMatchStates = new Map();
const pendingGoalCancel = new Map();
const globalFootballCache = new Map();
const triggeredMatches = new Set();

const sportUpdateStatus = {
    lastFullUpdate: 0, 
    lastQuickUpdate: 0, 
    nextMatchTime: null, 
    hasLiveMatch: false
};

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
            console.log(`📂 [HAFIZA-FUTBOL] ${previousMatchStates.size} maç durumu dosyadan yüklendi.`);
        } catch (e) {
            console.error("❌ Hafıza dosyası okunamadı, yeni başlatılıyor.");
        }
    }
}

// =========================================================================
// 🌉 HARİCİ YAYINCI DOSYASI (SPOREKRANI) ENTEGRASYONU
// =========================================================================
let externalBroadcasters = {};

async function loadExternalBroadcasters() {
    try {
        const url = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/yayinci_bilgisi.json?t=${Date.now()}`;
        const response = await fetch(url);
        
        if (response.ok) {
            externalBroadcasters = await response.json();
            fs.writeFileSync('yayinci_bilgisi.json', JSON.stringify(externalBroadcasters, null, 2));
        }
    } catch (e) {
        if (fs.existsSync('yayinci_bilgisi.json')) {
            externalBroadcasters = JSON.parse(fs.readFileSync('yayinci_bilgisi.json', 'utf8'));
        } else {
            externalBroadcasters = {};
        }
    }
}

function getBroadcasterWithFallback(sportCategory, dateStr, timeStr, homeName, awayName, fallback) {
    const cleanTime = (timeStr || "").replace(/\n?CANLI/, "").replace(/\n?MS/, "").replace('.', ':').trim();
    const [cH, cM] = cleanTime.split(':').map(Number);

    const normalizeStr = (str) => {
        if (!str) return "";
        let s = str.replace(/İ/g, 'i').replace(/I/g, 'i').replace(/Ğ/g, 'g').replace(/ğ/g, 'g')
                   .replace(/Ü/g, 'u').replace(/ü/g, 'u').replace(/Ş/g, 's').replace(/ş/g, 's')
                   .replace(/Ö/g, 'o').replace(/ö/g, 'o').replace(/Ç/g, 'c').replace(/ç/g, 'c')
                   .replace(/ı/g, 'i');
        s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
    };

    const homeWords = normalizeStr(homeName).split(' ').filter(w => w.length >= 3);
    const awayWords = normalizeStr(awayName).split(' ').filter(w => w.length >= 3);

    for (const dateKey of [dateStr]) {
        const dayData = externalBroadcasters[dateKey];
        if (!dayData || !dayData.matches) continue;

        for (const m of dayData.matches) {
            if (m.spor && normalizeStr(m.spor) === normalizeStr(sportCategory)) {
                const mTime = (m.saat || "").replace('.', ':').trim();
                const [mH, mM] = mTime.split(':').map(Number);
                const mTitleClean = normalizeStr(m.mac);

                const matchHome = homeWords.length > 0 && homeWords.some(w => mTitleClean.includes(w));
                const matchAway = awayWords.length > 0 && awayWords.some(w => mTitleClean.includes(w));
                const matchScore = (matchHome ? 1 : 0) + (matchAway ? 1 : 0);

                let diff = 9999;
                if (mTime === cleanTime) {
                    diff = 0;
                } else if (!isNaN(mH) && !isNaN(cH) && !isNaN(mM) && !isNaN(cM)) {
                    diff = Math.abs((mH * 60 + mM) - (cH * 60 + cM));
                }

                if (matchScore === 2 && diff <= 300) return { kanal: m.yayin, source: "sporekrani" };
                else if (matchScore === 1 && diff <= 15) return { kanal: m.yayin, source: "sporekrani" };
            }
        }
    }
    return { kanal: fallback, source: "fallback" };
}

// =========================================================================
// 🛠️ YARDIMCI FONKSİYONLAR
// =========================================================================
async function uploadToFirebase(data) {
    try {
        const db = firebaseApp.database();
        const ref = db.ref(`matches_football`);
        await ref.set(data);
    } catch (error) {
        console.error(`❌ [FIREBASE] Hata:`, error.message);
    }
}

// 🔥 FOTMOB DOĞRUDAN FETCH MOTORU 🔥
async function fetchData(url) {
    try {
        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/json"
            }
        });

        if (!response.ok) return null;
        return await response.json();
    } catch (e) {
        return null;
    }
}

const getTRDate = (offset = 0) => {
    const now = new Date();
    const istStr = now.toLocaleString('en-US', { timeZone: 'Europe/Istanbul' });
    const ist = new Date(istStr);
    ist.setDate(ist.getDate() + offset);
    const y = ist.getFullYear();
    const m = String(ist.getMonth() + 1).padStart(2, '0');
    const d = String(ist.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

function getIstanbulNow() {
    const istStr = new Date().toLocaleString('en-US', { timeZone: 'Europe/Istanbul' });
    return new Date(istStr);
}

function findNextMatchTime(cache, now = Date.now()) {
    let nextTime = null;
    for (const match of cache.values()) {
        if (match.status === 'notstarted' || match.status === 'delayed') {
            if (match.timestamp <= now) return now;
            if (!nextTime || match.timestamp < nextTime) nextTime = match.timestamp;
        }
    }
    return nextTime;
}

// =========================================================================
// ⚽ FOTMOB LİG VE ID YAPILANDIRMASI
// =========================================================================
const FOTMOB_TARGETS = [
    47, 87, 54, 55, 53, 71, 130, 42, 73, 10216, 77, 50, 44, 146, 113, 132, 61, 40, 46, 137, 138, 139, 9806, 112
];

const footballLeagues = {
    47: "İngiltere Premier Lig", 87: "İspanya La Liga", 54: "Almanya Bundesliga",
    55: "İtalya Serie A", 53: "Fransa Ligue 1", 71: "Türkiye Süper Lig",
    130: "Trendyol 1. Lig", 146: "Türkiye Kupası",
    42: "UEFA Şampiyonlar Ligi", 73: "UEFA Avrupa Ligi", 10216: "UEFA Konferans Ligi",
    77: "FIFA Dünya Kupası", 50: "UEFA EURO", 44: "Copa America",
    132: "Hollanda Eredivisie", 61: "Portekiz Primeira Liga", 40: "Belçika Pro League",
    46: "İskoçya Premiership", 113: "FA Cup", 9806: "UEFA Uluslar Ligi", 112: "Hazırlık Maçları"
};

const getFootBroadcaster = (leagueId, hName) => {
    const isTurkey = hName.toLowerCase().includes("türkiye") || hName.toLowerCase().includes("turkey");
    const staticConfigs = {
        71: "beIN Sports", 130: "TRT Spor / beIN", 146: "A Spor", 
        47: "beIN Sports", 87: "S Sport Plus", 54: "beIN Sports", 
        55: "S Sport Plus", 53: "beIN Sports", 42: "Exxen", 73: "Exxen", 10216: "Exxen",
        132: "TV+", 61: "S Sport Plus"
    };
    if (isTurkey && (leagueId === 9806 || leagueId === 112)) return "TV8 / TRT 1";
    if (staticConfigs[leagueId]) return staticConfigs[leagueId];
    return "Resmi Yayıncı / Canlı Skor";
};

// =========================================================================
// 🔔 BİLDİRİM KONTROLÜ VE GÖNDERME
// =========================================================================
const lastNotificationTime = new Map();

async function sendPush(id, title, body, imageUrl = null, matchData = null) {
    const now = Date.now();
    const lastTime = lastNotificationTime.get(id) || 0;
    if (now - lastTime < 15000) return;

    try {
        const payload = {
            topic: `match_${id}`,
            notification: { title: title, body: body },
            data: { matchId: String(id), type: "match_update", title: String(title), body: String(body), imageUrl: imageUrl || "" },
            apns: { headers: { "apns-push-type": "alert", "apns-priority": "10" }, payload: { aps: { alert: { title: title, body: body }, "mutable-content": 1, sound: "default", category: "MATCH_UPDATE" }, matchId: String(id), type: "match_update" } }
        };

        if (matchData) {
            const hName = String(matchData.homeTeam?.name || "Ev Sahibi");
            const aName = String(matchData.awayTeam?.name || "Deplasman");

            payload.data.homeName = hName; payload.data.awayName = aName;
            payload.data.homeScore = String(matchData.homeScore || "-"); payload.data.awayScore = String(matchData.awayScore || "-");
            payload.data.homeLogo = String(matchData.homeTeam?.logo || ""); payload.data.awayLogo = String(matchData.awayTeam?.logo || "");
            payload.data.status = String(matchData.status || "inprogress"); payload.data.timeOrMinute = String(matchData.liveMinute || "");

            payload.apns.payload.homeName = hName; payload.apns.payload.awayName = aName;
            payload.apns.payload.homeLogo = String(matchData.homeTeam?.logo || ''); payload.apns.payload.awayLogo = String(matchData.awayTeam?.logo || '');
            payload.apns.payload.homeTeamId = String(matchData.homeTeam?.id || '0'); payload.apns.payload.awayTeamId = String(matchData.awayTeam?.id || '0');
        }

        await firebaseApp.messaging().send(payload);
        lastNotificationTime.set(id, now);
        console.log(`✅ [BİLDİRİM] ${title}: ${body}`);
    } catch (e) {
        console.error("❌ Bildirim Hatası:", e.message);
    }
}

async function checkAndSendNotifications(newMatches) {
    for (const match of newMatches) {
        const matchIdStr = String(match.id);
        const prev = previousMatchStates.get(matchIdStr) || { status: null, homeScore: 0, awayScore: 0, hasNotifiedStart: false, hasNotifiedFinished: false };

        let currH = parseInt(match.homeScore) || 0;
        let currA = parseInt(match.awayScore) || 0;
        const appTitle = "Maç Saati";

        if (match.status === 'inprogress' && !prev.hasNotifiedStart) {
            await sendPush(matchIdStr, appTitle, `⚽ Maç Başladı!\n${match.homeTeam.name} - ${match.awayTeam.name}`, null, match);
            prev.hasNotifiedStart = true;
        } else if (['finished', 'ended', 'closed'].includes(match.status) && !prev.hasNotifiedFinished) {
            if (prev.status === 'inprogress') {
                await sendPush(matchIdStr, appTitle, `🏁 Maç Bitti\n${match.homeTeam.name} ${match.homeScore} - ${match.awayScore} ${match.awayTeam.name}`, null, match);
            }
            prev.hasNotifiedFinished = true;
        }

        if (match.status === 'inprogress' && prev.status !== null) {
            if (prev.homeScore !== currH || prev.awayScore !== currA) {
                const homeScored = currH > prev.homeScore;
                const scorerTeam = homeScored ? match.homeTeam.name : match.awayTeam.name;
                const scoringTeamLogo = homeScored ? match.homeTeam.logo : match.awayTeam.logo;
                await sendPush(matchIdStr, appTitle, `⚽ Gol - ${scorerTeam} (${match.liveMinute})\n${match.homeTeam.name} ${match.homeScore} - ${match.awayScore} ${match.awayTeam.name}`, scoringTeamLogo, match);
            }
        }

        previousMatchStates.set(matchIdStr, {
            status: match.status, homeScore: currH, awayScore: currA, hasNotifiedStart: prev.hasNotifiedStart, hasNotifiedFinished: prev.hasNotifiedFinished,
            date: match.fixedDate
        });
    }
    saveState();
}

// =========================================================================
// ⚽ FOTMOB VERİ DÖNÜŞTÜRÜCÜ VE GÜNCELLEYİCİ
// =========================================================================
async function updateFootball(targetDates = [getTRDate(0)], isQuickScan = false) {
    console.log(`⚽ FotMob Tarama: (Mod: ${isQuickScan ? '🚀 HIZLI' : '🐢 DETAYLI'})`);

    const validDates = [getTRDate(-2), getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)];
    
    for (const [id, state] of previousMatchStates.entries()) {
        if (state.date && !validDates.includes(state.date) && state.status !== 'inprogress') previousMatchStates.delete(id);
    }
    for (const [id, match] of globalFootballCache.entries()) {
        if (!validDates.includes(match.fixedDate)) globalFootballCache.delete(id);
    }

    let dateHasMatches = false;

    // Fotmob her gün için TEK BİR istek atar, tüm ligleri aynı anda getirir!
    for (const date of targetDates) {
        const formattedDate = date.replace(/-/g, ''); // 2026-10-02 -> 20261002
        const url = `https://www.fotmob.com/api/matches?date=${formattedDate}&timezone=Europe%2FIstanbul`;
        
        const data = await fetchData(url);
        
        if (data && data.leagues) {
            data.leagues.forEach(league => {
                const leagueId = league.primaryId || league.id;
                
                // Sadece belirlediğimiz ligleri al
                if (!FOTMOB_TARGETS.includes(leagueId)) return;

                league.matches.forEach(m => {
                    const statusObj = m.status || {};
                    let parsedStatus = 'notstarted';
                    let liveMinStr = "";
                    let homeSc = "-";
                    let awaySc = "-";

                    if (statusObj.finished) {
                        parsedStatus = 'finished';
                        homeSc = String(m.home.score ?? "0");
                        awaySc = String(m.away.score ?? "0");
                    } else if (statusObj.cancelled) {
                        parsedStatus = 'canceled';
                    } else if (statusObj.started) {
                        parsedStatus = 'inprogress';
                        homeSc = String(m.home.score ?? "0");
                        awaySc = String(m.away.score ?? "0");
                        // FotMob Canlı Dakika formatı: "45", "HT", "90+2"
                        const liveTimeObj = m.status.liveTime || {};
                        liveMinStr = liveTimeObj.short || m.status.reason?.short || "Canlı";
                        if (liveMinStr === "HT") liveMinStr = "İY";
                    }

                    const timeString = m.time || "00:00";
                    const fallbackBroadcaster = getFootBroadcaster(leagueId, m.home.name);
                    const result = getBroadcasterWithFallback("futbol", date, timeString, m.home.name, m.away.name, fallbackBroadcaster);

                    const matchTimestamp = new Date(`${date}T${timeString}:00+03:00`).getTime();
                    const cleanTournamentName = footballLeagues[leagueId] || league.name;

                    globalFootballCache.set(m.id, {
                        id: m.id, isElite: true, status: parsedStatus, statusCode: 0, liveMinute: liveMinStr,
                        fixedDate: date, fixedTime: timeString, timestamp: matchTimestamp, broadcaster: result.kanal,
                        homeTeam: { name: m.home.name, logo: `https://images.fotmob.com/image_resources/logo/teamlogo/${m.home.id}.png`, id: m.home.id }, 
                        awayTeam: { name: m.away.name, logo: `https://images.fotmob.com/image_resources/logo/teamlogo/${m.away.id}.png`, id: m.away.id },
                        tournamentLogo: `https://images.fotmob.com/image_resources/logo/leaguelogo/${leagueId}.png`, 
                        homeScore: homeSc, awayScore: awaySc,
                        setScores: [], tournament: cleanTournamentName, timeObj: {}
                    });
                    dateHasMatches = true;
                });
            });
        }
    }

    const matches = Array.from(globalFootballCache.values()).sort((a, b) => a.timestamp - b.timestamp);
    await checkAndSendNotifications(matches);
    await uploadToFirebase({ success: true, lastUpdate: new Date().toLocaleTimeString('tr-TR'), matches });

    const hasLiveMatch = matches.some(m => m.status === 'inprogress');
    const nextMatchTimestamp = findNextMatchTime(globalFootballCache);

    if(!isQuickScan && matches.length > 0) {
        console.log(`✅ ${matches.length} maç başarıyla Firebase'e yazıldı!`);
    }

    return { hasLiveMatch, nextMatchTimestamp, hasAnyMatches: matches.length > 0 };
}

// =========================================================================
// 🆕 ANA DÖNGÜ 
// =========================================================================
async function main() {
    loadState();
    console.log("============================================================");
    console.log("🟢 [FOTMOB] YENİ NESİL VERİ MOTORU BAŞLADI");
    console.log("============================================================");

    let lastPeriodicUpdate = 0;

    while (true) {
        try {
            const now = Date.now();
            await loadExternalBroadcasters();
            
            const ist = getIstanbulNow();
            const msSinceMidnight = (ist.getHours() * 3600000) + (ist.getMinutes() * 60000) + (ist.getSeconds() * 1000);
            const startOfDay = now - msSinceMidnight;

            // Günde 2 kez büyük tarama (10:00 ve 15:00)
            const TARGET_TIMES = [ 10 * 60 * 60 * 1000, 15 * 60 * 60 * 1000 ];
            let activeTarget = startOfDay - 24 * 60 * 60 * 1000;
            for (let i = TARGET_TIMES.length - 1; i >= 0; i--) {
                if (msSinceMidnight >= TARGET_TIMES[i]) { activeTarget = startOfDay + TARGET_TIMES[i]; break; }
            }

            if (lastPeriodicUpdate < activeTarget) {
                console.log("\n🔄 [PERİYODİK] Detaylı Tarama Başlıyor...");
                const days4 = [getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)];
                const result = await updateFootball(days4, false);
                sportUpdateStatus.nextMatchTime = result.nextMatchTimestamp; 
                sportUpdateStatus.hasLiveMatch = result.hasLiveMatch;
                lastPeriodicUpdate = now;
            }

            let quickScanDates = [getTRDate(0)];
            if (ist.getHours() >= 0 && ist.getHours() <= 4) quickScanDates = [getTRDate(-1), getTRDate(0)];

            if (sportUpdateStatus.hasLiveMatch || (sportUpdateStatus.nextMatchTime && now >= (sportUpdateStatus.nextMatchTime - MINUTE_MS * 1.1))) {
                if (now - sportUpdateStatus.lastQuickUpdate >= MINUTE_MS) {
                    console.log(`\n⚽ [HIZLI DÖNGÜ] Maç vakti (Canlı veya Yaklaşan)!`);
                    const result = await updateFootball(quickScanDates, true);  
                    sportUpdateStatus.lastQuickUpdate = now; sportUpdateStatus.hasLiveMatch = result.hasLiveMatch; sportUpdateStatus.nextMatchTime = result.nextMatchTimestamp;
                }
            }

            const processDuration = Date.now() - now; 
            let sleepTime = 10 * MINUTE_MS;
            const isActive = sportUpdateStatus.hasLiveMatch || (sportUpdateStatus.nextMatchTime && now >= (sportUpdateStatus.nextMatchTime - MINUTE_MS * 12));
            
            if (isActive) {
                sleepTime = Math.max(15000, 60000 - processDuration);
                console.log(`⚡ Bekleniyor... (${Math.round(sleepTime/1000)} sn)`);
            } else {
                console.log("💤 Hareket yok, 10 dk uyku...");
            }

            await new Promise(r => setTimeout(r, sleepTime));
            
        } catch (e) { 
            console.error("🚨 Hata:", e.message); 
            await new Promise(r => setTimeout(r, MINUTE_MS)); 
        }
    }
}
main();
