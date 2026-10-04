const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

require('events').EventEmitter.defaultMaxListeners = 100;

// =========================================================================
// 🔥 AYARLAR VE ÇALIŞMA ORTAMI
// =========================================================================
const STATE_FILE = 'basketball_states.json'; // ⚠️️ BAĞIMSIZ HAFIZA
const GITHUB_USER = "elfcrzgr";
const REPO_NAME = "macsaati-backend";
const MINUTE_MS = 60000;
const TEN_MIN_MS = 10 * 60000;

const emptyLeaguesCache = new Map();

// =========================================================================
// 🔥 FIREBASE BAŞLATMA
// =========================================================================
const serviceAccount = JSON.parse(fs.readFileSync('./serviceAccountKey.json', 'utf8'));
const firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app/"
}, 'basketball_app');
console.log("🔥 [BASKETBOL] Firebase Admin başlatıldı.");

// =========================================================================
// 🧠 GLOBAL HAFIZA (CACHE) VE DURUM YÖNETİMİ
// =========================================================================
const previousMatchStates = new Map();
const globalBasketballCache = new Map();

const sportUpdateStatus = {
    lastFullUpdate: 0, 
    lastQuickUpdate: 0, 
    nextMatchTime: null, 
    hasLiveMatch: false
};

function logMatchesBySport(matchGroups) {
    for (const sportType of Object.keys(matchGroups)) {
        const sporekraniMatches = matchGroups[sportType].filter(matchInfo => matchInfo.source === "sporekrani");
        if (sporekraniMatches.length === 0) continue;
        console.log(`\n--------- 🏀 BASKETBOL SPOREKRANI ---------`);
        for (const matchInfo of sporekraniMatches) {
            const { home, away, kanal } = matchInfo;
            console.log(`🏀 ${home} vs ${away} | Kanal: ${kanal} [SPOREKRANI]`);
            console.log('---------------------------------------------');
        }
    }
}

function saveState() {
    const obj = Object.fromEntries(previousMatchStates);
    fs.writeFileSync(STATE_FILE, JSON.stringify(obj));
}

function loadState() {
    if (fs.existsSync(STATE_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            for (const [key, val] of Object.entries(data)) previousMatchStates.set(key, val);
            console.log(`📂 [HAFIZA-BASKETBOL] ${previousMatchStates.size} maç durumu yüklendi.`);
        } catch (e) { console.error("❌ Hafıza dosyası okunamadı, yeni başlatılıyor."); }
    }
}

// =========================================================================
// 🌉 HARİCİ YAYINCI DOSYASI (SPOREKRANI) ENTEGRASYONU
// =========================================================================
let externalBroadcasters = {};

// ⏱️ Zaman aşımı yardımcıları (Futbol scriptindeki gibi)
function timeoutSignal(ms) {
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) return AbortSignal.timeout(ms);
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    if (t.unref) t.unref();
    return c.signal;
}

function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} ${Math.round(ms / 1000)} sn içinde yanıt vermedi`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function loadExternalBroadcasters() {
    try {
        const url = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/yayinci_bilgisi.json?t=${Date.now()}`;
        const response = await fetch(url, { signal: timeoutSignal(10000) });
        if (response.ok) {
            externalBroadcasters = await response.json();
            fs.writeFileSync('yayinci_bilgisi.json', JSON.stringify(externalBroadcasters, null, 2));
        } else {
            throw new Error(`HTTP ${response.status}`);
        }
    } catch (e) {
        if (fs.existsSync('yayinci_bilgisi.json')) {
            try {
                externalBroadcasters = JSON.parse(fs.readFileSync('yayinci_bilgisi.json', 'utf8'));
            } catch (err) {
                externalBroadcasters = {};
            }
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

    const getSafeDates = (baseStr) => {
        const [y, m, d] = baseStr.split('-').map(Number);
        return [0, 1].map(offset => {
            const dateObj = new Date(y, m - 1, d + offset);
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            return `${dateObj.getFullYear()}-${month}-${day}`;
        });
    };

    for (const dateKey of getSafeDates(dateStr)) {
        const dayData = externalBroadcasters[dateKey];
        const matchesArray = Array.isArray(dayData) ? dayData : dayData?.matches;

        if (!matchesArray || !Array.isArray(matchesArray)) continue;

        for (const m of matchesArray) {
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
                    if (diff > 1000) diff = Math.abs(diff - 1440);
                }

                if (matchScore === 2 && diff <= 120) {
                    return { kanal: m.yayin, source: "sporekrani" };
                } else if (matchScore === 1 && diff <= 15 && dateKey === dateStr) {
                    return { kanal: m.yayin, source: "sporekrani" };
                }
            }
        }
    }
    return { kanal: fallback, source: "fallback" };
}

// =========================================================================
// 🛠️ YARDIMCI FONKSİYONLAR VE FETCH
// =========================================================================
async function uploadToFirebase(data) {
    try {
        await withTimeout(firebaseApp.database().ref(`matches_basketball`).set(data), 15000, 'Firebase yazma');
    } catch (error) { console.error(`❌ [FIREBASE-BASKETBOL] Hata:`, error.message); }
}

// 🔥 Eski curl/child_process yerine Native Fetch
async function fetchData(url) {
    try {
        const delay = Math.floor(Math.random() * 2000) + 1000;
        await new Promise(r => setTimeout(r, delay));

        const mobileUrl = url.replace('www.sofascore.com', 'api.sofascore.com');
        
        const response = await fetch(mobileUrl, {
            signal: timeoutSignal(15000),
            headers: {
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "tr-TR,tr;q=0.9",
                "Referer": "https://www.sofascore.com/",
                "Origin": "https://www.sofascore.com",
                "Connection": "keep-alive"
            }
        });

        if (!response.ok) {
            if (response.status === 404 || response.status === 204) return { events: [] }; 
            console.log(`⚠️ API Reddi (HTTP ${response.status}) -> URL: ${mobileUrl}`);
            return null;
        }

        return await response.json();
    } catch (e) {
        console.error(`❌ SİSTEM HATASI -> ${e.message}`);
        return null;
    }
}

const getTRDate = (offset = 0) => {
    const d = new Date(); d.setDate(d.getDate() + offset); 
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
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
// 🏀 BASKETBOL YAPILANDIRMASI (Sabit Korundu)
// =========================================================================
const ELITE_LEAGUE_IDS = [132, 138, 141, 9357, 519, 264, 285, 10415, 10437, 1500]; 
const leagueConfigs = {
    132: "S Sport / NBA TV", 138: "S Sport / S Sport Plus", 141: "TRT Spor / S Sport", 9357: "Tivibu Spor",
    285: "S Sport / TRT Spor", 519: "beIN Sports", 1179: "TRT Spor / beIN Sports", 19844: "TBF TV (YouTube)",
    264: "S Sport Plus", 304: "S Sport Plus", 227: "S Sport Plus", 156: "beIN Sports",
    1524: "S Sport Plus", 235: "S Sport Plus", 1438: "TRT Spor / beIN Sports",
    10415: "NBA TV / S Sport Plus",
    10437: "S Sport / TRT Spor", 
    486: "NBA TV",
    1500: "TRT Spor / beIN Sports" 
};
const basketballLeagues = {
    132: "NBA", 138: "EuroLeague", 141: "EuroCup", 9357: "Basketbol Şampiyonlar Ligi (BCL)",
    519: "Basketbol Süper Ligi (BSL)", 1179: "Türkiye Erkekler Basketbol Kupası", 19844: "Türkiye Basketbol 2. Ligi (TB2L)",
    264: "İspanya Liga ACB", 304: "Yunanistan Basketbol Ligi", 227: "Almanya BBL", 156: "Fransa LNB Pro A",
    1524: "Avustralya NBL", 235: "Adriyatik Ligi (ABA)", 1438: "VTB Birleşik Ligi", 285: "FIBA EuroBasket",
    10415: "NBA Yaz Ligi",
    10437: "FIBA Dünya Kupası Elemeleri", 
    486: "WNBA",
    1500: "Basketbol Süper Kupası"
};
const targetBaskIds = Object.keys(leagueConfigs).map(Number);

// =========================================================================
// 🏀 BASKETBOL GÜNCELLEME (GERÇEK AKILLI TARAMA)
// =========================================================================
async function updateBasketball(targetDates = [getTRDate(0)], isQuickScan = false) {
    console.log(`🏀 Basketbol: (Mod: ${isQuickScan ? '🚀 HIZLI' : '🐢 DETAYLI'})`);
    const validDates = [getTRDate(-2), getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2), getTRDate(3)];

    for (const dateKey of emptyLeaguesCache.keys()) {
        if (!validDates.includes(dateKey)) emptyLeaguesCache.delete(dateKey);
    }

    for (const [id, state] of previousMatchStates.entries()) {
        if (state.date && !validDates.includes(state.date) && state.status !== 'inprogress') previousMatchStates.delete(id);
    }
    saveState();

    let allEvents = [];
    let successfulDates = [];
    let anySuccess = false;

    // Orijinal Lig Lig Tarama Döngüsü
    for (const date of targetDates) {
        let dateHasMatches = false;
        
        if (!emptyLeaguesCache.has(date)) emptyLeaguesCache.set(date, new Set());
        const knownEmptyLeagues = emptyLeaguesCache.get(date);
        
        let leaguesToFetch = [];

        if (isQuickScan) {
            const activeLeagues = new Set();
            for (const match of globalBasketballCache.values()) {
                if (['inprogress', 'notstarted', 'delayed', 'suspended', 'interrupted'].includes(match.status)) {
                    const lId = match.tournamentLogo.split('/').pop().replace('.png', '');
                    activeLeagues.add(Number(lId));
                }
            }
            leaguesToFetch = Array.from(activeLeagues);
        } else {
            leaguesToFetch = targetBaskIds.filter(id => !knownEmptyLeagues.has(id));
        }

        if (leaguesToFetch.length > 0 && !isQuickScan) {
            console.log(`🔍 [${date}] için sorgulanacak basketbol ligi sayısı: ${leaguesToFetch.length}`);
        }

        for (const leagueId of leaguesToFetch) {
            const url = `https://www.sofascore.com/api/v1/unique-tournament/${leagueId}/scheduled-events/${date}`;
            const data = await fetchData(url);
            
            if (data !== null) anySuccess = true;

            if (data?.events && data.events.length > 0) {
                allEvents.push(...data.events);
                dateHasMatches = true;
            } else if (data?.events && data.events.length === 0) {
                knownEmptyLeagues.add(leagueId);
            }
        }
        if (dateHasMatches) successfulDates.push(date);
    }

    if (!anySuccess) {
        const stillLive = Array.from(globalBasketballCache.values())
            .some(m => m.status === 'inprogress');
        return {
            hasLiveMatch: stillLive || sportUpdateStatus.hasLiveMatch,
            nextMatchTimestamp: sportUpdateStatus.nextMatchTime,
            hasAnyMatches: globalBasketballCache.size > 0
        };
    }

    for (const [id, match] of globalBasketballCache.entries()) {
        if (!validDates.includes(match.fixedDate)) globalBasketballCache.delete(id);
    }

    const seenKeys = new Set();
    let basketbolMatchesLog = [];

    for (const e of allEvents) {
        const utId = e.tournament?.uniqueTournament?.id;
        const utName = e.tournament?.uniqueTournament?.name || "";
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        if (!targetDates.includes(dayStr)) continue;

        const isNBA = (utId === 3547 || utName.toUpperCase() === "NBA");
        const matchKey = `${dayStr}_${e.homeTeam.name}_${e.awayTeam.name}_${utId}`;
        if (seenKeys.has(matchKey)) continue;
        seenKeys.add(matchKey);

        const statusType = e.status?.type; 
        const isFinished = statusType === 'finished'; 
        const isInProgress = statusType === 'inprogress';
        
        let timeString = `${String(dateTR.getHours()).padStart(2, '0')}:${String(dateTR.getMinutes()).padStart(2, '0')}`;
        if (isInProgress) timeString = `${timeString}\nCANLI`;
        
        const hasScore = isFinished || isInProgress;
        const cleanTournamentName = basketballLeagues[utId] || (isNBA ? "NBA" : utName);
        const fallbackBroadcaster = leagueConfigs[utId] || "Resmi Yayıncı";
        const result = getBroadcasterWithFallback("basketbol", dayStr, timeString, e.homeTeam.name, e.awayTeam.name, fallbackBroadcaster);
        const finalBroadcaster = result.kanal;

        if(!isQuickScan) basketbolMatchesLog.push({ home: e.homeTeam.name, away: e.awayTeam.name, kanal: finalBroadcaster, source: result.source });

        globalBasketballCache.set(e.id, {
            id: e.id, 
            isElite: ELITE_LEAGUE_IDS.includes(utId), 
            status: statusType, 
            fixedDate: dayStr, 
            fixedTime: timeString, 
            timestamp: dateTR.getTime(), 
            broadcaster: finalBroadcaster,
            homeTeam: { name: e.homeTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/logos/${isNBA ? "NBA/" : ""}${e.homeTeam.id}.png` },
            awayTeam: { name: e.awayTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/logos/${isNBA ? "NBA/" : ""}${e.awayTeam.id}.png` },
            tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/tournament_logos/${isNBA ? "3547" : utId}.png`,
            homeScore: hasScore ? String(e.homeScore?.display ?? "0") : "-", 
            awayScore: hasScore ? String(e.awayScore?.display ?? "0") : "-", 
            tournament: cleanTournamentName
        });

        previousMatchStates.set(String(e.id), { status: statusType, date: dayStr });
    }

    const finalMatches = Array.from(globalBasketballCache.values()).sort((a, b) => a.timestamp - b.timestamp);
    await uploadToFirebase({ success: true, matches: finalMatches });
    if(!isQuickScan && basketbolMatchesLog.length < 30) logMatchesBySport({ basketbol: basketbolMatchesLog });
    
    const hasLiveMatch = finalMatches.some(m => m.status === 'inprogress');
    const nextMatchTimestamp = findNextMatchTime(globalBasketballCache);
    return { hasLiveMatch, nextMatchTimestamp, hasAnyMatches: finalMatches.length > 0 };
}

// =========================================================================
// 🆕 ANA DÖNGÜ (SADECE BASKETBOL)
// =========================================================================
async function main() {
    loadState();
    console.log("============================================================");
    console.log("🟢 [BASKETBOL] BAĞIMSIZ SERVİS BAŞLADI");
    console.log("============================================================");

    let lastPeriodicUpdate = 0;
    let lastBroadcastersString = "";
    let expectedWake = 0;

    const applyResult = (result) => {
        sportUpdateStatus.hasLiveMatch = result.hasLiveMatch;
        sportUpdateStatus.nextMatchTime = result.nextMatchTimestamp;
    };

    while (true) {
        try {
            const now = Date.now();

            if (expectedWake && now - expectedWake > 30000) {
                console.log(`⚠️ Döngü ${Math.round((now - expectedWake) / 1000)} sn geç uyandı: cihaz uykuya geçmiş olabilir.`);
            }
            
            await loadExternalBroadcasters();
            
            const currentBroadcastersString = JSON.stringify(externalBroadcasters);
            let forceUpdateDueToBroadcasters = false;
            
            if (lastBroadcastersString !== "" && currentBroadcastersString !== lastBroadcastersString) {
                console.log("📺 [YAYINCI] Yeni yayıncı bilgileri tespit edildi! Firebase güncelleniyor...");
                forceUpdateDueToBroadcasters = true;
            }
            lastBroadcastersString = currentBroadcastersString;

            const ist = getIstanbulNow();
            const msSinceMidnight = (ist.getHours() * 3600000) + (ist.getMinutes() * 60000) + (ist.getSeconds() * 1000);
            const startOfDay = now - msSinceMidnight;
            
            const TARGET_TIMES = [ 
                10 * 60 * 1000,              
                (1 * 60 + 15) * 60 * 1000,   
                (6 * 60 + 15) * 60 * 1000,    
                (9 * 60 + 15) * 60 * 1000,   
                (12 * 60 + 15) * 60 * 1000,  
                (15 * 60 + 15) * 60 * 1000   
            ];
            
            let activeTarget = startOfDay - (5 * 60 + 50) * 60 * 1000;
            for (let i = TARGET_TIMES.length - 1; i >= 0; i--) {
                if (msSinceMidnight >= TARGET_TIMES[i]) { activeTarget = startOfDay + TARGET_TIMES[i]; break; }
            }

            if (lastPeriodicUpdate < activeTarget || forceUpdateDueToBroadcasters) {
                console.log("\n🔄 [PERİYODİK / ZORUNLU] Detaylı Tarama Başlıyor...");
                const days4 = [getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)];
                const result = await withTimeout(updateBasketball(days4, false), 120000, 'Detaylı tarama');
                applyResult(result);
                
                if (!forceUpdateDueToBroadcasters) {
                    lastPeriodicUpdate = now;
                }
            }

            const currentHour = getIstanbulNow().getHours();
            let quickScanDates = [getTRDate(0)];

            if (currentHour >= 0 && currentHour <= 4) {
                quickScanDates = [getTRDate(-1), getTRDate(0)];
            }

            const isUpcoming = () => sportUpdateStatus.nextMatchTime && now >= (sportUpdateStatus.nextMatchTime - MINUTE_MS * 1.1);

            if (sportUpdateStatus.hasLiveMatch) {
                if (now - sportUpdateStatus.lastQuickUpdate >= MINUTE_MS) {
                    console.log("\n🏀 [HIZLI DÖNGÜ] Canlı basketbol maçı var!");
                    const result = await withTimeout(updateBasketball(quickScanDates, true), 60000, 'Hızlı tarama');  
                    sportUpdateStatus.lastQuickUpdate = Date.now();
                    applyResult(result);
                }
            }
            else if (isUpcoming()) {
                if (now - sportUpdateStatus.lastQuickUpdate >= MINUTE_MS) {
                    console.log("\n⏰ [BASKETBOL YAKLAŞAN] Yaklaşan maç vakti!");
                    const result = await withTimeout(updateBasketball(quickScanDates, true), 60000, 'Hızlı tarama'); 
                    sportUpdateStatus.lastQuickUpdate = Date.now();
                    applyResult(result);
                }
            }

            let sleepTime;
            if (sportUpdateStatus.hasLiveMatch || isUpcoming()) {
                sleepTime = Math.max(10000, MINUTE_MS - (Date.now() - sportUpdateStatus.lastQuickUpdate));
                console.log(`\n⚡ [BASKETBOL] Aktif/Yaklaşan maç var. ${Math.round(sleepTime / 1000)} sn sonra tekrar bakılacak.`);
            } else if (sportUpdateStatus.nextMatchTime && Date.now() >= sportUpdateStatus.nextMatchTime - MINUTE_MS * 12) {
                sleepTime = Math.min(30000, Math.max(10000, sportUpdateStatus.nextMatchTime - MINUTE_MS * 1.1 - Date.now()));
                console.log(`\n⏳ [BASKETBOL] Maça az kaldı, ${Math.round(sleepTime / 1000)} sn sonra tekrar bakılacak.`);
            } else {
                sleepTime = TEN_MIN_MS;
                console.log("\n💤 [BASKETBOL] Şu an hareket yok. 10 dakika derin uyku...");
            }

            expectedWake = Date.now() + sleepTime;
            await new Promise(r => setTimeout(r, sleepTime));

        } catch (e) { 
            console.error("🚨 Hata:", e.message); 
            expectedWake = Date.now() + MINUTE_MS;
            await new Promise(r => setTimeout(r, MINUTE_MS)); 
        }
    }
}
main();
