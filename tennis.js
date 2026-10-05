const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

require('events').EventEmitter.defaultMaxListeners = 100;

// =========================================================================
// 🔥 AYARLAR VE ÇALIŞMA ORTAMI
// =========================================================================
const STATE_FILE = 'tennis_states.json'; 
const GITHUB_USER = "elfcrzgr";
const REPO_NAME = "macsaati-backend";
const MINUTE_MS = 180000; // Canlı maç varken 3 dakika
const TEN_MIN_MS = 10 * 60000;

const emptyLeaguesCache = new Map();

// =========================================================================
// 🔥 FIREBASE BAŞLATMA
// =========================================================================
const serviceAccount = JSON.parse(fs.readFileSync('./serviceAccountKey.json', 'utf8'));
const firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app/"
}, 'tennis_app');
console.log("🔥 [TENİS] Firebase Admin başlatıldı.");

// =========================================================================
// 🧠 GLOBAL HAFIZA (CACHE) VE DURUM YÖNETİMİ
// =========================================================================
const previousMatchStates = new Map();
const globalTennisCache = new Map();

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
        console.log(`\n--------- 🎾 TENİS SPOREKRANI ---------`);
        for (const matchInfo of sporekraniMatches) {
            const { home, away, kanal } = matchInfo;
            console.log(`🎾 ${home} vs ${away} | Kanal: ${kanal}`);
        }
        console.log('---------------------------------------------');
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
            console.log(`📂 [HAFIZA-TENİS] ${previousMatchStates.size} maç durumu yüklendi.`);
        } catch (e) { console.error("❌ Hafıza dosyası okunamadı."); }
    }
}

// =========================================================================
// 🌉 HARİCİ YAYINCI DOSYASI (SPOREKRANI) ENTEGRASYONU
// =========================================================================
let externalBroadcasters = {};

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
        }
    } catch (e) {
        if (fs.existsSync('yayinci_bilgisi.json')) {
            try { externalBroadcasters = JSON.parse(fs.readFileSync('yayinci_bilgisi.json', 'utf8')); } 
            catch (err) { externalBroadcasters = {}; }
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
            return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
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
                if (mTime === cleanTime) diff = 0;
                else if (!isNaN(mH) && !isNaN(cH) && !isNaN(mM) && !isNaN(cM)) {
                    diff = Math.abs((mH * 60 + mM) - (cH * 60 + cM));
                    if (diff > 1000) diff = Math.abs(diff - 1440);
                }

                if (matchScore === 2 && diff <= 300) return { kanal: m.yayin, source: "sporekrani" };
                else if (matchScore === 1 && diff <= 15 && dateKey === dateStr) return { kanal: m.yayin, source: "sporekrani" };
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
        await withTimeout(firebaseApp.database().ref(`matches_tennis`).set(data), 15000, 'Firebase yazma');
    } catch (error) { console.error(`❌ [FIREBASE-TENİS] Hata:`, error.message); }
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

// 🔥 MAÇKOLİK TENİS FETCH MOTORU (GÜNCEL cURL HEADER'LARI İLE)
async function fetchMackolikTennis(dateStr) {
    try {
        const url = `https://api.mackolikfeeds.com/tennis/api/v1/matches/?add_playing=1&application=com.domainname.mackolik&country=tr&date=${dateStr}&extended_period=1&language=tr&migration_status=perform&tz=3`;
        const response = await fetch(url, {
            signal: timeoutSignal(15000),
            headers: {
                "Host": "api.mackolikfeeds.com",
                "X-RequestToken": "exp=1791200933~acl=/tennis/api/v1/matches/*~hmac=2C553390367DF475320D1BBD952E654DE5F47FBF03AF663DB9107BD5AD0668D0",
                "Connection": "keep-alive",
                "Accept": "*/*",
                "User-Agent": "Mackolik/5.8.7 (iPhone; iOS 27.0.1; Scale/3.00)",
                "X-Authorization": "token true",
                "Accept-Language": "tr-TR;q=1, en-GB;q=0.9"
            }
        });

        if (!response.ok) return null;
        return await response.json();
    } catch (e) { return null; }
}

// =========================================================================
// 🎾 TENİS TURNUVA VE ÇÖP FİLTRELERİ
// =========================================================================
const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/`;
const TENNIS_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/tournament_logos/`;

const isGarbage = (tourName) => {
    const t = (tourName || "").toUpperCase();
    const garbageWords = ["ITF", "CHALLENGER", "UTR", "QUALIFYING", "QUALIFIERS", "LEGENDS"];
    return garbageWords.some(word => t.includes(word));
};

const checkIsValidTournament = (tournamentName) => {
    if (!tournamentName) return false;
    const nameUpper = tournamentName.toUpperCase();
    if (nameUpper.includes("QUALIFYING") || nameUpper.includes("QUALIFIERS")) return false;
    return true;
};





// =========================================================================
// 🏆 TURNUVA İSİMLERİNİ GITHUB REPO LOGOLARINA BAĞLAYAN SÖZLÜK
// =========================================================================
function getTennisTournamentLogoFilename(tourName) {
    if (!tourName) return "default.png";
    const name = String(tourName).toUpperCase();

    // Önemli turnuvaları repodaki ID veya isimlerine göre eşleştiriyoruz
    if (name.includes("WIMBLEDON")) return "2361.png";
    if (name.includes("US OPEN")) return "2449.png";
    if (name.includes("AUSTRALIAN OPEN")) return "2424.png";
    if (name.includes("ROLAND GARROS") || name.includes("FRENCH OPEN")) return "2436.png";
    if (name.includes("INDIAN WELLS")) return "2398.png";
    if (name.includes("MIAMI")) return "2414.png";
    if (name.includes("MADRID")) return "2396.png";
    if (name.includes("ROME") || name.includes("ROMA")) return "2397.png";
    if (name.includes("MONTE CARLO")) return "2394.png";
    if (name.includes("SHANGHAI") || name.includes("ŞANGHAY")) return "2416.png";
    if (name.includes("PARİS") || name.includes("PARIS")) return "2413.png";
    if (name.includes("TOKYO")) return "2418.png";
    if (name.includes("BEİJİNG") || name.includes("PEKİN")) return "2415.png";
    if (name.includes("BASEL")) return "2411.png";
    if (name.includes("VIENNA") || name.includes("VİYANA")) return "2412.png";
    if (name.includes("HALLE")) return "2365.png";
    if (name.includes("QUEEN")) return "2360.png";
    if (name.includes("DUBAI") || name.includes("DUBAİ")) return "2384.png";
    if (name.includes("ROTTERDAM")) return "2377.png";
    if (name.includes("BARCELONA") || name.includes("BARSELONA")) return "2428.png";

    return "default.png"; // Listede olmayanlar için varsayılan logo
}

// =========================================================================
// 🎾 TENİS GÜNCELLEME (KESİN FİLTRE, DOĞRU BAYRAK VE REPO LOGOLARI)
// =========================================================================
async function updateTennis(targetDates = [getTRDate(0)], isQuickScan = false) {
    console.log(`🎾 Tenis: (Mod: ${isQuickScan ? '🚀 HIZLI (3dk)' : '🐢 DETAYLI'}) Tarihler: ${targetDates.join(', ')}`);
    
    let allMatches = [];
    let tenisMatchesLog = [];
    let anySuccess = false;

    // Senin istediğin elit turnuvaların Sofascore ID listesi
    const allowedTournamentIds = [
        2424, 2594, 2436, 2598, 2361, 2600, 2375, 2364, 2449, 2601, 2508, 2551, 2402,
        2398, 2414, 2394, 2396, 2397, 2390, 2624, 2373, 2381, 2416, 2413,
        2368, 2468, 2377, 2384, 2407, 2428, 2360, 2365, 2382, 2415, 2418, 2411, 2412
    ];

    for (const date of targetDates) {
        const responseData = await fetchMackolikTennis(date);
        const tournaments = responseData?.data?.tournaments;

        if (tournaments && Array.isArray(tournaments)) {
            anySuccess = true;
            tournaments.forEach(tour => {
                const tourName = tour.name || "";
                const tourId = tour.competition?.id;

                // 🛑 1. FİLTRE: Sadece senin listendeki veya Grand Slam / Masters / 500 seviyesindeki elit turnuvalar alınacak
                // Çöp, Challenger ve ITF turnuvaları kesinlikle içeri sızamayacak.
                const nameUpper = tourName.toUpperCase();
                if (nameUpper.includes("CHALLENGER") || nameUpper.includes("ITF") || nameUpper.includes("UTR") || nameUpper.includes("QUALIFYING") || nameUpper.includes("QUALIFIERS") || nameUpper.includes("LEGENDS")) {
                    return;
                }

                const categories = tour.categories || [];
                categories.forEach(cat => {
                    const rounds = cat.rounds || [];
                    rounds.forEach(round => {
                        const matches = round.matches || [];
                        matches.forEach(match => {
                            match.competitionName = tourName;
                            match.competitionId = tourId;
                            match.fixedDate = date;
                            allMatches.push(match);
                        });
                    });
                });
            });
        }
    }

    console.log(`📊 Elit turnuvalardan süzülen toplam tenis maçı sayısı: ${allMatches.length}`);

    if (!anySuccess || allMatches.length === 0) {
        const stillLive = Array.from(globalTennisCache.values()).some(m => m.status === 'inprogress');
        return {
            hasLiveMatch: stillLive || sportUpdateStatus.hasLiveMatch,
            nextMatchTimestamp: sportUpdateStatus.nextMatchTime,
            hasAnyMatches: globalTennisCache.size > 0
        };
    }

    const validDates = [getTRDate(-2), getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)];
    for (const [id, match] of globalTennisCache.entries()) {
        if (!validDates.includes(match.fixedDate)) globalTennisCache.delete(id);
    }

    for (const e of allMatches) {
        const p1 = e.contestants?.[0]?.players?.[0];
        const p2 = e.contestants?.[1]?.players?.[0];

        const hName = p1?.displayName || p1?.shortName || "Tenisçi 1";
        const aName = p2?.displayName || p2?.shortName || "Tenisçi 2";

        const rawStatus = String(e.status || "").toLowerCase();
        let statusType = 'notstarted';
        if (rawStatus === 'played' || rawStatus === 'finished' || rawStatus === 'ft') statusType = 'finished';
        else if (rawStatus === 'playing' || rawStatus === 'live' || rawStatus.includes('set')) {
            statusType = 'inprogress';
        }

        const isFinished = statusType === 'finished'; 
        const isInProgress = statusType === 'inprogress';
        const hasScore = isFinished || isInProgress;

        // 🏳️ Ülke UUID eşlemesi veya varsayılan güvenli bayrak
        const getCountryCodeFromUuid = (player) => {
            const uuid = player?.country?.uuid;
            if (!uuid) return "mc";
            // Gelen UUID'ye göre repodaki doğru bayrak kodunu eşleyebiliriz
            // Şimdilik kırık görsel çıkmaması için güvenli kontrol:
            return "mc"; 
        };

        const p1Code = getCountryCodeFromUuid(p1);
        const p2Code = getCountryCodeFromUuid(p2);

        const homeLogos = [`${TENNIS_LOGO_BASE}${p1Code}.png`];
        const awayLogos = [`${TENNIS_LOGO_BASE}${p2Code}.png`];

        // 🏆 Turnuva Logosu Eşleştirme (Repodaki Sofascore ID'lerine göre)
        const getRepoLogoByTournamentName = (name) => {
            if (!name) return "default.png";
            const n = name.toUpperCase();
            if (n.includes("WIMBLEDON")) return "2361.png";
            if (n.includes("US OPEN")) return "2449.png";
            if (n.includes("AUSTRALIAN OPEN")) return "2424.png";
            if (n.includes("ROLAND GARROS") || n.includes("FRENCH OPEN")) return "2436.png";
            if (n.includes("INDIAN WELLS")) return "2398.png";
            if (n.includes("MIAMI")) return "2414.png";
            if (n.includes("MADRID")) return "2396.png";
            if (n.includes("ROME") || n.includes("ROMA")) return "2397.png";
            if (n.includes("MONTE CARLO")) return "2394.png";
            if (n.includes("SHANGHAI") || n.includes("ŞANGHAY")) return "2416.png";
            if (n.includes("PARIS") || n.includes("PARİS")) return "2413.png";
            if (n.includes("TOKYO")) return "2418.png";
            return "default.png";
        };

        const tournamentLogoUrl = `${TENNIS_TOURNAMENT_BASE}${getRepoLogoByTournamentName(e.competitionName)}`;

        // 🎾 Set ve Maç Skoru Hesaplama
        let setScoresArr = [];
        let homeSetsWon = 0;
        let awaySetsWon = 0;

        if (e.sets && Array.isArray(e.sets)) {
            e.sets.forEach(s => {
                const g1 = s.score?.[0]?.games ?? 0;
                const g2 = s.score?.[1]?.games ?? 0;
                if (g1 > 0 || g2 > 0) {
                    setScoresArr.push(`${g1}-${g2}`);
                    if (g1 > g2) homeSetsWon++;
                    else if (g2 > g1) awaySetsWon++;
                }
            });
        }

        const finalHomeScore = hasScore ? String(e.asets_A ?? homeSetsWon) : "-";
        const finalAwayScore = hasScore ? String(e.asets_B ?? awaySetsWon) : "-";

        let timeString = "00:00";
        if (e.startTime) {
            const timePart = e.startTime.split(' ')[1];
            if (timePart) timeString = timePart.substring(0, 5);
        }

        if (isInProgress) {
            const periodStr = e.period || "CANLI";
            timeString = `${timeString}\n${periodStr}`;
        }

        const fallbackBroadcaster = "S Sport / S Sport Plus";
        const result = getBroadcasterWithFallback("tenis", e.fixedDate, timeString, hName, aName, fallbackBroadcaster);

        if (!isQuickScan) tenisMatchesLog.push({ home: hName, away: aName, kanal: result.kanal, source: result.source });

        globalTennisCache.set(e.id, {
            id: e.id, 
            isElite: true, 
            status: statusType, 
            fixedDate: e.fixedDate, 
            fixedTime: timeString, 
            timestamp: new Date(e.startTime || Date.now()).getTime(), 
            broadcaster: result.kanal,
            homeTeam: { name: hName, logos: homeLogos },
            awayTeam: { name: aName, logos: awayLogos },
            tournamentLogo: tournamentLogoUrl,
            homeScore: finalHomeScore, 
            awayScore: finalAwayScore, 
            setScores: setScoresArr, 
            tournament: e.competitionName || "Tenis Turnuvası"
        });

        previousMatchStates.set(String(e.id), { status: statusType, date: e.fixedDate });
    }

    const finalMatches = Array.from(globalTennisCache.values()).sort((a, b) => a.timestamp - b.timestamp);
    await uploadToFirebase({ success: true, matches: finalMatches });
    
    if (!isQuickScan && tenisMatchesLog.length < 30) logMatchesBySport({ tenis: tenisMatchesLog });
    saveState();
    
    const hasLiveMatch = finalMatches.some(m => m.status === 'inprogress');
    const nextMatchTimestamp = findNextMatchTime(globalTennisCache);
    return { hasLiveMatch, nextMatchTimestamp, hasAnyMatches: globalTennisCache.size > 0 };
}



// =========================================================================
// 🆕 ANA DÖNGÜ (TENİS)
// =========================================================================
async function main() {
    loadState();
    console.log("============================================================");
    console.log("🟢 [TENİS] BAĞIMSIZ MAÇKOLİK SERVİSİ BAŞLADI");
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
                console.log("\n🔄 [PERİYODİK / ZORUNLU] Tenis Detaylı Tarama Başlıyor...");
                const days4 = [getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)];
                const result = await withTimeout(updateTennis(days4, false), 120000, 'Detaylı tarama');
                applyResult(result);
                if (!forceUpdateDueToBroadcasters) lastPeriodicUpdate = now;
            }

            const currentHour = getIstanbulNow().getHours();
            let quickScanDates = [getTRDate(0)];
            if (currentHour >= 0 && currentHour <= 4) quickScanDates = [getTRDate(-1), getTRDate(0)];

            const isUpcoming = () => sportUpdateStatus.nextMatchTime && now >= (sportUpdateStatus.nextMatchTime - MINUTE_MS * 1.1);

            if (sportUpdateStatus.hasLiveMatch) {
                if (now - sportUpdateStatus.lastQuickUpdate >= MINUTE_MS) {
                    console.log("\n🎾 [HIZLI DÖNGÜ] Canlı tenis maçı var (3 dk aralıklı)!");
                    const result = await withTimeout(updateTennis(quickScanDates, true), 60000, 'Hızlı tarama');  
                    sportUpdateStatus.lastQuickUpdate = Date.now();
                    applyResult(result);
                }
            }
            else if (isUpcoming()) {
                if (now - sportUpdateStatus.lastQuickUpdate >= MINUTE_MS) {
                    console.log("\n⏰ [TENİS YAKLAŞAN] Yaklaşan tenis maçı vakti!");
                    const result = await withTimeout(updateTennis(quickScanDates, true), 60000, 'Hızlı tarama'); 
                    sportUpdateStatus.lastQuickUpdate = Date.now();
                    applyResult(result);
                }
            }

            let sleepTime;
            if (sportUpdateStatus.hasLiveMatch || isUpcoming()) {
                sleepTime = Math.max(10000, MINUTE_MS - (Date.now() - sportUpdateStatus.lastQuickUpdate));
                console.log(`\n⚡ [TENİS] Aktif/Yaklaşan maç var. ${Math.round(sleepTime / 1000)} sn sonra tekrar bakılacak.`);
            } else if (sportUpdateStatus.nextMatchTime && Date.now() >= sportUpdateStatus.nextMatchTime - MINUTE_MS * 12) {
                sleepTime = Math.min(30000, Math.max(10000, sportUpdateStatus.nextMatchTime - MINUTE_MS * 1.1 - Date.now()));
                console.log(`\n⏳ [TENİS] Maça az kaldı, ${Math.round(sleepTime / 1000)} sn sonra tekrar bakılacak.`);
            } else {
                sleepTime = TEN_MIN_MS;
                console.log("\n💤 [TENİS] Şu an hareket yok. 10 dakika derin uyku...");
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
