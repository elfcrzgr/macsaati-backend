const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

// =========================================================================
// 🔥 AYARLAR VE ÇALIŞMA ORTAMI
// =========================================================================
const STATE_FILE = 'basketball_states.json'; // ⚠️ BAĞIMSIZ HAFIZA
const GITHUB_USER = "elfcrzgr";
const REPO_NAME = "macsaati-backend";
const MINUTE_MS = 60000;
const TEN_MIN_MS = 10 * 60000;

// O gün maçı KESİN OLMAYAN basketbol ligleri (Akıllı Tarama Kara Listesi)
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
        } catch (e) { console.error("❌ Hafıza dosyası okunamadı."); }
    }
}

// =========================================================================
// 🌉 HARİCİ YAYINCI DOSYASI (SPOREKRANI) ENTEGRASYONU
// =========================================================================
let externalBroadcasters = {};
function loadExternalBroadcasters() {
    try {
        if (fs.existsSync('yayinci_bilgisi.json')) externalBroadcasters = JSON.parse(fs.readFileSync('yayinci_bilgisi.json', 'utf8'));
        else externalBroadcasters = {};
    } catch (e) { externalBroadcasters = {}; }
}

function getBroadcasterWithFallback(sportCategory, dateStr, timeStr, homeName, awayName, fallback) {
    const cleanTime = (timeStr || "").replace(/\n?CANLI/, "").replace(/\n?MS/, "").replace('.', ':').trim();
    const [cH, cM] = cleanTime.split(':').map(Number);
    const toTR = (str) => str.replace(/İ/g, 'i').replace(/I/g, 'i').replace(/ı/g, 'i').toLowerCase().trim();
    const hName = toTR(homeName || ""); const aName = toTR(awayName || "");
    const getSafeDates = (baseStr) => {
        const [y, m, d] = baseStr.split('-').map(Number);
        return [0, 1].map(offset => {
            const dateObj = new Date(y, m - 1, d + offset);
            const month = String(dateObj.getMonth() + 1).padStart(2, '0'); const day = String(dateObj.getDate()).padStart(2, '0');
            return `${dateObj.getFullYear()}-${month}-${day}`;
        });
    };
    const safeDates = getSafeDates(dateStr);
    for (const dateKey of safeDates) {
        const dayData = externalBroadcasters[dateKey];
        if (!dayData || !dayData.matches) continue;
        for (const m of dayData.matches) {
            if (m.spor && toTR(m.spor) === toTR(sportCategory)) {
                const mTime = (m.saat || "").replace('.', ':').trim(); const [mH, mM] = mTime.split(':').map(Number); const mTitle = toTR(m.mac || "");
                const getCleanWords = (str) => { return str.replace(/İ/g, 'i').replace(/I/g, 'i').replace(/Ğ/g, 'g').replace(/ğ/g, 'g').replace(/Ü/g, 'u').replace(/ü/g, 'u').replace(/Ş/g, 's').replace(/ş/g, 's').replace(/Ö/g, 'o').replace(/ö/g, 'o').replace(/Ç/g, 'c').replace(/ç/g, 'c').replace(/ı/g, 'i').toLowerCase().replace(/[^a-z0-9]/g, ' ').split(' ').map(w => w.trim()).filter(w => w.length >= 3); };
                const hWords = getCleanWords(hName); const aWords = getCleanWords(aName);
                const matchHome = hWords.length === 0 || hWords.some(w => mTitle.includes(w)); const matchAway = aWords.length === 0 || aWords.some(w => mTitle.includes(w));
                const matchScore = (matchHome ? 1 : 0) + (matchAway ? 1 : 0);
                let diff = 9999;
                if (mTime === cleanTime) { diff = 0; } else if (!isNaN(mH) && !isNaN(cH) && !isNaN(mM) && !isNaN(cM)) { diff = Math.abs((mH * 60 + mM) - (cH * 60 + cM)); if (diff > 1000) diff = Math.abs(diff - 1440); }
                if (matchScore === 2 && diff <= 120) { return { kanal: m.yayin, source: "sporekrani" }; } else if (matchScore === 1 && diff <= 15 && dateKey === dateStr) { return { kanal: m.yayin, source: "sporekrani" }; }
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
        const ref = db.ref(`matches_basketball`);
        await ref.set(data);
    } catch (error) { console.error(`❌ [FIREBASE-BASKETBOL] Hata:`, error.message); }
}

async function fetchData(url) {
    try {
        const delay = Math.floor(Math.random() * 600) + 200;
        await new Promise(r => setTimeout(r, delay));
        const headers = { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)", "Accept": "*/*", "Accept-Language": "tr-TR,tr;q=0.9", "Connection": "keep-alive" };
        if (url.includes('sofascore.com')) { headers["Referer"] = "https://www.sofascore.com/"; headers["Origin"] = "https://www.sofascore.com"; headers["X-Requested-With"] = "93a9a4"; headers["Cache-Control"] = "max-age=0"; }
        const response = await fetch(url, { headers });
        
        if (!response.ok) { 
            // 🚀 GELİŞMİŞ 404 KONTROLÜ
            if (response.status === 404) return { is404: true }; // Maç KESİN yok!
            
            console.log(`⚠️ API Reddi veya Ağ Hatası (HTTP ${response.status}) -> URL: ${url}`); 
            return null; // Ağ hatasıysa null dön ki kara listeye girmesin!
        }
        return await response.json();
    } catch (e) { return null; }
}

const getTRDate = (offset = 0) => {
    const d = new Date(); d.setDate(d.getDate() + offset); return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
};

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
// 🏀 BASKETBOL YAPILANDIRMASI (NBA YAZ LİGİ VE FIBA ELEMELERİ EKLENDİ)
// =========================================================================
const ELITE_LEAGUE_IDS = [132, 138, 141, 9357, 519, 264, 285, 10415, 10437]; // 10437 eklendi
const leagueConfigs = {
    132: "S Sport / NBA TV", 138: "S Sport / S Sport Plus", 141: "TRT Spor / S Sport", 9357: "Tivibu Spor",
    285: "S Sport / TRT Spor", 519: "beIN Sports", 1179: "TRT Spor / beIN Sports", 19844: "TBF TV (YouTube)",
    264: "S Sport Plus", 304: "S Sport Plus", 227: "S Sport Plus", 156: "beIN Sports",
    1524: "S Sport Plus", 235: "S Sport Plus", 1438: "TRT Spor / beIN Sports",
    10415: "NBA TV / S Sport Plus",
    10437: "S Sport / TRT Spor", // 🏀 FIBA DÜNYA KUPASI ELEMELERİ EKLENDİ
    486: "NBA TV"
};
const basketballLeagues = {
    132: "NBA", 138: "EuroLeague", 141: "EuroCup", 9357: "Basketbol Şampiyonlar Ligi (BCL)",
    519: "Basketbol Süper Ligi (BSL)", 1179: "Türkiye Erkekler Basketbol Kupası", 19844: "Türkiye Basketbol 2. Ligi (TB2L)",
    264: "İspanya Liga ACB", 304: "Yunanistan Basketbol Ligi", 227: "Almanya BBL", 156: "Fransa LNB Pro A",
    1524: "Avustralya NBL", 235: "Adriyatik Ligi (ABA)", 1438: "VTB Birleşik Ligi", 285: "FIBA EuroBasket",
    10415: "NBA Yaz Ligi",
    10437: "FIBA Dünya Kupası Elemeleri", // 🏀 FIBA EKLENDİ
    486: "WNBA"
};
const targetBaskIds = Object.keys(leagueConfigs).map(Number);




// =========================================================================
// 🏀 BASKETBOL GÜNCELLEME (GERÇEK AKILLI TARAMA)
// =========================================================================
async function updateBasketball(targetDates = [getTRDate(0)], isQuickScan = false) {
    console.log(`🏀 Basketbol: (Mod: ${isQuickScan ? '🚀 HIZLI' : '🐢 DETAYLI'})`);
    const validDates = [getTRDate(-2), getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2), getTRDate(3)];

    for (const [id, state] of previousMatchStates.entries()) {
        if (state.date && !validDates.includes(state.date) && state.status !== 'inprogress') previousMatchStates.delete(id);
    }
    saveState();

    // 🧹 HAFIZA TEMİZLİĞİ (RAM Şişmesini Önler)
    for (const dateKey of emptyLeaguesCache.keys()) {
        if (!validDates.includes(dateKey)) emptyLeaguesCache.delete(dateKey);
    }

    let allEvents = [];
    let successfulDates = [];

    for (const date of targetDates) {
        let dateHasMatches = false;
        
        if (!emptyLeaguesCache.has(date)) emptyLeaguesCache.set(date, new Set());
        const knownEmptyLeagues = emptyLeaguesCache.get(date);

        let leaguesToFetch = [];

        if (isQuickScan) {
            const activeLeagues = new Set();
            for (const match of globalBasketballCache.values()) {
                if (match.fixedDate === date) {
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
            
            if (data?.events && data.events.length > 0) {
                allEvents.push(...data.events);
                dateHasMatches = true;
            } else if (data?.is404) {
                // SADECE 404 yanıtı (is404: true) aldıysak o ligi o gün için kara listeye alıyoruz!
                knownEmptyLeagues.add(leagueId); 
            }
        }
        if (dateHasMatches) successfulDates.push(date);
    }

    if (successfulDates.length === 0) {
        console.log("⚠️ [BASKETBOL] Yeni maç bulunamadı (Sezon dışı veya maç yok). İşlem bitti.");
        return { nextMatchTimestamp: sportUpdateStatus.nextMatchTime, hasAnyMatches: globalBasketballCache.size > 0 };
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

        const statusType = e.status?.type; const isFinished = statusType === 'finished'; const isInProgress = statusType === 'inprogress';
        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        if (isInProgress) timeString = `${timeString}\nCANLI`;
        const hasScore = isFinished || isInProgress;
        const cleanTournamentName = basketballLeagues[utId] || (isNBA ? "NBA" : utName);
        const fallbackBroadcaster = leagueConfigs[utId] || "Resmi Yayıncı";
        const result = getBroadcasterWithFallback("basketbol", dayStr, timeString, e.homeTeam.name, e.awayTeam.name, fallbackBroadcaster);
        const finalBroadcaster = result.kanal;

        if(!isQuickScan) basketbolMatchesLog.push({ home: e.homeTeam.name, away: e.awayTeam.name, kanal: finalBroadcaster, source: result.source });

        globalBasketballCache.set(e.id, {
            id: e.id, isElite: ELITE_LEAGUE_IDS.includes(utId), status: statusType, fixedDate: dayStr, fixedTime: timeString, timestamp: dateTR.getTime(), broadcaster: finalBroadcaster,
            homeTeam: { name: e.homeTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/logos/${isNBA ? "NBA/" : ""}${e.homeTeam.id}.png` },
            awayTeam: { name: e.awayTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/logos/${isNBA ? "NBA/" : ""}${e.awayTeam.id}.png` },
            tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/tournament_logos/${isNBA ? "3547" : utId}.png`,
            homeScore: hasScore ? String(e.homeScore?.display ?? "0") : "-", awayScore: hasScore ? String(e.awayScore?.display ?? "0") : "-", tournament: cleanTournamentName
        });
        
        previousMatchStates.set(String(e.id), { status: statusType, date: dayStr });
    }

    const finalMatches = Array.from(globalBasketballCache.values()).sort((a, b) => a.timestamp - b.timestamp);
    await uploadToFirebase({ success: true, matches: finalMatches });
    if(!isQuickScan) logMatchesBySport({ basketbol: basketbolMatchesLog });
    
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
    let lastBroadcastersString = ""; // 🚀 YENİ: Yayıncı verisinin son halini tutacak

    while (true) {
        try {
            const now = Date.now();
            
            // 1. Dosyayı oku
            loadExternalBroadcasters();
            
            // 2. 🚀 YENİ: Yayıncı bilgisi değişti mi kontrol et
            const currentBroadcastersString = JSON.stringify(externalBroadcasters);
            let forceUpdateDueToBroadcasters = false;
            
            if (lastBroadcastersString !== "" && currentBroadcastersString !== lastBroadcastersString) {
                console.log("📺 [YAYINCI] Yeni yayıncı bilgileri tespit edildi! Firebase anında güncelleniyor...");
                forceUpdateDueToBroadcasters = true;
            }
            lastBroadcastersString = currentBroadcastersString; // Hafızayı güncelle

            // 3. Zaman hesaplamaları
            const d = new Date(now);
            const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
            const msSinceMidnight = now - startOfDay;
            
            // 🚀 Eşitlenmiş Periyodik Saatler (Futbol ile aynı)
            const TARGET_TIMES = [ 
                10 * 60 * 1000,              // 00:10 (Yeni günün fikstürü için ilk can suyu)
                (1 * 60 + 15) * 60 * 1000,   // 01:15
                (6 * 60 + 15) * 60 * 1000,   // 06:15 
                (9 * 60 + 15) * 60 * 1000,   // 09:15
                (12 * 60 + 15) * 60 * 1000,  // 12:15
                (15 * 60 + 15) * 60 * 1000   // 15:15
            ];
            
            let activeTarget = startOfDay - (5 * 60 + 50) * 60 * 1000;
            for (let i = TARGET_TIMES.length - 1; i >= 0; i--) {
                if (msSinceMidnight >= TARGET_TIMES[i]) { activeTarget = startOfDay + TARGET_TIMES[i]; break; }
            }

            // 4. 🚀 YENİ: Periyodik saat geldiyse VEYA yayıncı dosyası değiştiyse zorla
            if (lastPeriodicUpdate < activeTarget || forceUpdateDueToBroadcasters) {
                console.log("\n🔄 [PERİYODİK / ZORUNLU] Detaylı Tarama Başlıyor...");
                const days4 = [getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)];
                const result = await updateBasketball(days4, false);
                sportUpdateStatus.nextMatchTime = result.nextMatchTimestamp; 
                sportUpdateStatus.hasLiveMatch = result.hasLiveMatch;
                
                if (!forceUpdateDueToBroadcasters) {
                    lastPeriodicUpdate = now;
                }
            }

            const quickScanDates = [getTRDate(-1), getTRDate(0), getTRDate(1)]; 
            const hasUpcoming = sportUpdateStatus.nextMatchTime && now >= (sportUpdateStatus.nextMatchTime - MINUTE_MS * 11);

            if ((sportUpdateStatus.hasLiveMatch || hasUpcoming) && now - sportUpdateStatus.lastQuickUpdate >= TEN_MIN_MS) {
                const result = await updateBasketball(quickScanDates, true);
                sportUpdateStatus.lastQuickUpdate = now; 
                sportUpdateStatus.nextMatchTime = result.nextMatchTimestamp; 
                sportUpdateStatus.hasLiveMatch = result.hasLiveMatch;
            }

            let sleepTime = TEN_MIN_MS;
            if (sportUpdateStatus.hasLiveMatch || hasUpcoming) {
                sleepTime = TEN_MIN_MS - (now - sportUpdateStatus.lastQuickUpdate);
                if (sleepTime < MINUTE_MS) sleepTime = MINUTE_MS;
                console.log(`\n⚡ [BASKETBOL] Aktif/Yaklaşan maç var. Terminal ${Math.ceil(sleepTime / 60000)} dakika uykuya yatıyor...`);
            } else {
                console.log("\n💤 [BASKETBOL] Şu an hareket yok. Terminal 10 dakika derin uyku modunda...");
            }

            await new Promise(r => setTimeout(r, sleepTime));
        } catch (e) { 
            console.error("🚨 Hata:", e.message); 
            await new Promise(r => setTimeout(r, MINUTE_MS)); 
        }
    }
}
main();


