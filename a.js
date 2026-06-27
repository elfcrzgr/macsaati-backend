const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const apn = require('apn');
const axios = require('axios');

const triggeredMatches = new Set();

// =========================================================================
// 🔥 AYARLAR VE ÇALIŞMA ORTAMI
// =========================================================================
const IS_PRODUCTION = false; 
const API_SPORTS_KEY = '870e5a7510c80ee4e84491d6c891bfe7'; // Ortak API Anahtarımız
const GITHUB_USER = "elfcrzgr";
const REPO_NAME = "macsaati-backend";
const MINUTE_MS = 60000;
const TEN_MIN_MS = 10 * 60000;

// =========================================================================
// 🔥 FIREBASE & APNs BAŞLATMA
// =========================================================================
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
console.log(`🍏 Apple APNs hazır. (Mod: ${IS_PRODUCTION ? "CANLI / TESTFLIGHT" : "GELİŞTİRİCİ"})`);

// =========================================================================
// 🧠 GLOBAL HAFIZA (CACHE) VE DURUM YÖNETİMİ
// =========================================================================
const previousMatchStates = new Map();
const pendingGoalCancel = new Map();

const globalFootballCache = new Map();
const globalBasketballCache = new Map();
const globalTennisCache = new Map();

const sportUpdateStatus = {
    football: { lastQuickUpdate: 0, nextMatchTime: null, hasLiveMatch: false },
    basketball: { lastQuickUpdate: 0, nextMatchTime: null, hasLiveMatch: false },
    tennis: { lastQuickUpdate: 0, nextMatchTime: null, hasLiveMatch: false },
    f1: { lastFullUpdate: 0 }
};

const STATE_FILE = 'match_states.json';

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
            console.log(`📂 [HAFIZA] ${previousMatchStates.size} maç durumu dosyadan yüklendi.`);
        } catch (e) {
            console.error("❌ Hafıza dosyası okunamadı, yeni başlatılıyor.");
        }
    }
}

const getTRDate = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
};

// =========================================================================
// 🌉 HARİCİ YAYINCI DOSYASI (SPOREKRANI) ENTEGRASYONU
// =========================================================================
let externalBroadcasters = {};
function loadExternalBroadcasters() {
    try {
        if (fs.existsSync('yayinci_bilgisi.json')) {
            externalBroadcasters = JSON.parse(fs.readFileSync('yayinci_bilgisi.json', 'utf8'));
        } else {
            externalBroadcasters = {};
        }
    } catch (e) { externalBroadcasters = {}; }
}

function getBroadcasterWithFallback(sportCategory, dateStr, timeStr, homeName, awayName, fallback) {
    const cleanTime = (timeStr || "").replace(/\n?CANLI/, "").replace(/\n?MS/, "").replace('.', ':').trim();
    const [cH, cM] = cleanTime.split(':').map(Number);
    const toTR = (str) => str.replace(/İ/g, 'i').replace(/I/g, 'i').replace(/ı/g, 'i').toLowerCase().trim();

    const hName = toTR(homeName || "");
    const aName = toTR(awayName || "");

    const safeDates = [0, 1].map(offset => {
        const [y, m, d] = dateStr.split('-').map(Number);
        const dateObj = new Date(y, m - 1, d + offset);
        return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
    });

    for (const dateKey of safeDates) {
        const dayData = externalBroadcasters[dateKey];
        if (!dayData || !dayData.matches) continue;

        for (const m of dayData.matches) {
            if (m.spor && toTR(m.spor) === toTR(sportCategory)) {
                const mTime = (m.saat || "").replace('.', ':').trim();
                const [mH, mM] = mTime.split(':').map(Number);
                const mTitle = toTR(m.mac || "");

                const getCleanWords = (str) => str.replace(/İ/g, 'i').replace(/I/g, 'i').replace(/Ğ/g, 'g').replace(/ğ/g, 'g').replace(/Ü/g, 'u').replace(/ü/g, 'u').replace(/Ş/g, 's').replace(/ş/g, 's').replace(/Ö/g, 'o').replace(/ö/g, 'o').replace(/Ç/g, 'c').replace(/ç/g, 'c').replace(/ı/g, 'i').toLowerCase().replace(/[^a-z0-9]/g, ' ').split(' ').map(w => w.trim()).filter(w => w.length >= 3);

                const hWords = getCleanWords(hName);
                const aWords = getCleanWords(aName);

                const matchHome = hWords.length === 0 || hWords.some(w => mTitle.includes(w));
                const matchAway = aWords.length === 0 || aWords.some(w => mTitle.includes(w));
                const matchScore = (matchHome ? 1 : 0) + (matchAway ? 1 : 0);

                let diff = 9999;
                if (mTime === cleanTime) diff = 0;
                else if (!isNaN(mH) && !isNaN(cH)) {
                    diff = Math.abs((mH * 60 + mM) - (cH * 60 + cM));
                    if (diff > 1000) diff = Math.abs(diff - 1440);
                }

                if (matchScore === 2 && diff <= 120) return { kanal: m.yayin, source: "sporekrani" };
                else if (matchScore === 1 && diff <= 15 && dateKey === dateStr) return { kanal: m.yayin, source: "sporekrani" };
            }
        }
    }
    return { kanal: fallback, source: "fallback" };
}

function logMatchesBySport(matchGroups) {
    for (const sportType of Object.keys(matchGroups)) {
        const sporekraniMatches = matchGroups[sportType].filter(m => m.source === "sporekrani");
        if (sporekraniMatches.length === 0) continue;
        let icon = sportType.includes("foot") || sportType.includes("futbol") ? "⚽" : sportType.includes("bask") ? "🏀" : "🎾";
        console.log(`\n--------- ${icon} ${sportType.toUpperCase()} SPOREKRANI ---------`);
        for (const m of sporekraniMatches) console.log(`${icon} ${m.home} vs ${m.away} | Kanal: ${m.kanal}`);
    }
}

// =========================================================================
// 🛠️ YARDIMCI FONKSİYONLAR (FETCH & FIREBASE)
// =========================================================================
async function uploadToFirebase(sportName, data) {
    try {
        await admin.database().ref(`matches_${sportName}`).set(data);
        console.log(`✅ [FIREBASE] ${sportName.toUpperCase()} güncellendi!`);
    } catch (error) { console.error(`❌ [FIREBASE] ${sportName} Hata:`, error.message); }
}

async function fetchApiSports(url) {
    try {
        const response = await axios.get(url, {
            headers: { 'x-apisports-key': API_SPORTS_KEY },
            timeout: 10000 
        });
        return response.data.response || [];
    } catch (e) {
        console.error(`❌ API-Sports Hatası (${url}): ${e.message}`);
        return null;
    }
}

async function fetchSofascore(url) {
    try {
        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
                "Accept-Language": "tr-TR,tr;q=0.9"
            }
        });
        if (!response.ok) return null;
        return await response.json();
    } catch (e) { return null; }
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
// ⚽ FUTBOL GÜNCELLEME (API-FOOTBALL)
// =========================================================================
const teamIdMapper = {
    777: 4700, // Türkiye örneği (API: 777 -> Senin Dosya: 4700.png)
    2380: 4789 // Paraguay örneği
    // Eksik ID'leri terminalden görüp buraya eklersin
};

async function updateFootball(targetDates) {
    console.log(`⚽ Futbol verisi çekiliyor... (Gün sayısı: ${targetDates.length})`);
    let allFixtures = [];
    let apiSuccessCount = 0;

    for (const date of targetDates) {
        const url = `https://v3.football.api-sports.io/fixtures?date=${date}`;
        const fixtures = await fetchApiSports(url);
        if (fixtures !== null && fixtures.length > 0) {
            allFixtures.push(...fixtures);
            apiSuccessCount++;
        }
        await new Promise(r => setTimeout(r, 2000));
    }

    if (apiSuccessCount === 0) {
        console.log("⚠️ Futbol API'den veri alınamadı! Mevcut liste korunuyor...");
        return { hasLiveMatch: sportUpdateStatus.football.hasLiveMatch, nextMatchTimestamp: sportUpdateStatus.football.nextMatchTime }; 
    }

    const validDates = [getTRDate(-2), getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2), getTRDate(3)];
    for (const [id, state] of previousMatchStates.entries()) {
        if (state.date && !validDates.includes(state.date) && state.status !== 'inprogress') previousMatchStates.delete(id);
    }
    saveState();
    
    for (const [id, match] of globalFootballCache.entries()) {
        if (!validDates.includes(match.fixedDate)) globalFootballCache.delete(id);
    }

    // 🔥 LOG: ID Eşleştirmek İçin (Sonradan silebilirsin)
    allFixtures.forEach(e => {
        if (targetDates.includes(getTRDate(0))) {
            console.log(`⚽ LİG: ${e.league.name} (ID: ${e.league.id}) | MAÇ: ${e.teams.home.name} vs ${e.teams.away.name} | API HOME ID: ${e.teams.home.id}`);
        }
    });

    let futbolMatchesLog = [];

    allFixtures.forEach(e => {
        const shortStatus = e.fixture.status.short;
        if (['PST', 'CANC', 'ABD', 'AWD', 'WO'].includes(shortStatus)) return;

        let status = 'notstarted';
        let liveMinute = "";
        let timeObj = {};

        if (['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE'].includes(shortStatus)) {
            status = 'inprogress';
            if (shortStatus === 'HT') liveMinute = "İY";
            else if (shortStatus === 'BT') liveMinute = "UZ İY";
            else if (shortStatus === 'P') liveMinute = "PEN";
            else liveMinute = e.fixture.status.elapsed ? `${e.fixture.status.elapsed}'` : "Canlı";
            timeObj = { currentMinute: e.fixture.status.elapsed || 0 };
        } 
        else if (['FT', 'AET', 'PEN'].includes(shortStatus)) status = 'finished';

        const leagueId = e.league.id;
        const hName = e.teams.home.name;
        const aName = e.teams.away.name;

        const dateTR = new Date(e.fixture.timestamp * 1000);
        const dayTR = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        const timeString = dateTR.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

        const result = getBroadcasterWithFallback("futbol", dayTR, timeString, hName, aName, "Resmi Yayıncı");
        futbolMatchesLog.push({ home: hName, away: aName, kanal: result.kanal, source: result.source });

        const homeId = teamIdMapper[e.teams.home.id] || e.teams.home.id;
        const awayId = teamIdMapper[e.teams.away.id] || e.teams.away.id;
        
        globalFootballCache.set(e.fixture.id, {
            id: e.fixture.id,
            status: status,
            liveMinute: liveMinute,
            fixedDate: dayTR,
            fixedTime: timeString,
            timestamp: e.fixture.timestamp * 1000,
            broadcaster: result.kanal,
            homeTeam: { name: hName, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${homeId}.png`, id: e.teams.home.id },
            awayTeam: { name: aName, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${awayId}.png`, id: e.teams.away.id },
            tournamentLogo: e.league.logo, // Artık API-Sports'un kendi logosu
            homeScore: (status === 'inprogress' || status === 'finished') ? String(e.goals.home ?? "0") : "-",
            awayScore: (status === 'inprogress' || status === 'finished') ? String(e.goals.away ?? "0") : "-",
            tournament: e.league.name,
            timeObj: timeObj
        });
    });

    const matches = Array.from(globalFootballCache.values()).sort((a, b) => a.timestamp - b.timestamp);
    await uploadToFirebase("football", { success: true, lastUpdate: new Date().toLocaleTimeString('tr-TR'), matches });
    
    logMatchesBySport({ futbol: futbolMatchesLog });
    
    const hasLiveMatch = matches.some(m => m.status === 'inprogress');
    return { hasLiveMatch, nextMatchTimestamp: findNextMatchTime(globalFootballCache), hasAnyMatches: matches.length > 0 };
}


// =========================================================================
// 🏀 BASKETBOL GÜNCELLEME (API-BASKETBALL)
// =========================================================================
const TARGET_BASKET_LEAGUES = [12, 120]; // İstediğin Basketbol API-Sports Lig ID'lerini buraya ekle (12: NBA, 120: Euroleague)
const baskTeamIdMapper = {};

async function updateBasketball(targetDates) {
    console.log(`🏀 Basketbol API-Sports'tan çekiliyor...`);
    const validDates = [getTRDate(-2), getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2), getTRDate(3)];

    let allGames = [];
    let successfulDates = [];

    for (const date of targetDates) {
        const url = `https://v1.basketball.api-sports.io/games?date=${date}`;
        const games = await fetchApiSports(url);
        if (games && games.length > 0) {
            allGames.push(...games);
            successfulDates.push(date);
        }
        await new Promise(r => setTimeout(r, 2000));
    }

    if (successfulDates.length === 0) {
        console.log("⚠️ Basketbol API veri döndürmedi.");
        return { nextMatchTimestamp: sportUpdateStatus.basketball.nextMatchTime, hasAnyMatches: globalBasketballCache.size > 0 };
    }

    for (const [id, match] of globalBasketballCache.entries()) {
        if (!validDates.includes(match.fixedDate)) globalBasketballCache.delete(id);
    }

    let basketbolMatchesLog = [];
    
    // 🔥 LOG: Lig ve Takım ID'leri (Gerektiğinde TARGET_BASKET_LEAGUES'i güncellemek için)
    allGames.forEach(g => {
        if (targetDates.includes(getTRDate(0))) {
            console.log(`🏀 LİG: ${g.league.name} (ID: ${g.league.id}) | MAÇ: ${g.teams.home.name} vs ${g.teams.away.name} | API ID: ${g.teams.home.id}`);
        }
    });

    for (const g of allGames) {
        // Şimdilik filtre kapalı, logda gördüğün ligleri TARGET_BASKET_LEAGUES dizisine ekle sonra burayı açarsın:
        // if (!TARGET_BASKET_LEAGUES.includes(g.league.id)) continue;

        const dateTR = new Date(g.timestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        if (!targetDates.includes(dayStr)) continue;

        const statusShort = g.status.short;
        const isFinished = ["FT", "AOT"].includes(statusShort);
        const isInProgress = ["Q1", "Q2", "HT", "Q3", "Q4", "OT"].includes(statusShort);
        
        let statusType = isFinished ? "finished" : (isInProgress ? "inprogress" : "notstarted");
        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        if (isInProgress) timeString = `${timeString}\n${statusShort}`;

        const result = getBroadcasterWithFallback("basketbol", dayStr, timeString, g.teams.home.name, g.teams.away.name, "Resmi Yayıncı");
        basketbolMatchesLog.push({ home: g.teams.home.name, away: g.teams.away.name, kanal: result.kanal, source: result.source });

        globalBasketballCache.set(g.id, {
            id: g.id,
            isElite: true,
            status: statusType,
            fixedDate: dayStr,
            fixedTime: timeString,
            timestamp: g.timestamp * 1000,
            broadcaster: result.kanal,
            homeTeam: { name: g.teams.home.name, logo: g.teams.home.logo, id: g.teams.home.id }, // Direkt API-Sports'un logosu
            awayTeam: { name: g.teams.away.name, logo: g.teams.away.logo, id: g.teams.away.id }, // Direkt API-Sports'un logosu
            tournamentLogo: g.league.logo, // Direkt API-Sports'un turnuva logosu
            homeScore: (isInProgress || isFinished) ? String(g.scores.home.total ?? "0") : "-",
            awayScore: (isInProgress || isFinished) ? String(g.scores.away.total ?? "0") : "-",
            tournament: g.league.name
        });
    }

    const finalMatches = Array.from(globalBasketballCache.values()).sort((a, b) => a.timestamp - b.timestamp);
    await uploadToFirebase("basketball", { success: true, matches: finalMatches });
    
    logMatchesBySport({ basketbol: basketbolMatchesLog });
    const hasLiveMatch = finalMatches.some(m => m.status === 'inprogress');
    return { hasLiveMatch, nextMatchTimestamp: findNextMatchTime(globalBasketballCache), hasAnyMatches: finalMatches.length > 0 };
}


// =========================================================================
// 🎾 TENİS GÜNCELLEME (SOFASCORE - ESKİ HALİYLE KORUNDU)
// =========================================================================
async function updateTennis(targetDates) {
    console.log(`🎾 Tenis Sofascore'dan güncelleniyor... (Taranan gün: ${targetDates.length})`);
    const validDates = [getTRDate(-2), getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2), getTRDate(3)];

    let rawEvents = [];
    for (const date of targetDates) {
        const data = await fetchSofascore(`https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${date}`);
        if (data?.events) rawEvents.push(...data.events);
    }

    for (const [id, match] of globalTennisCache.entries()) {
        if (!validDates.includes(match.fixedDate)) globalTennisCache.delete(id);
    }

    for (let idx = 0; idx < rawEvents.length; idx++) {
        const e = rawEvents[idx];
        const startTimestamp = e.startTimestamp * 1000;
        const dateTR = new Date(startTimestamp);
        const fixedDate = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        if (!targetDates.includes(fixedDate)) continue;

        const statusType = e.status?.type;
        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        const hasScore = statusType === 'inprogress' || statusType === 'finished';
        if (statusType === 'inprogress') timeString += "\nCANLI";
        else if (statusType === 'finished') timeString += "\nMS";

        const result = getBroadcasterWithFallback("tenis", fixedDate, timeString, e.homeTeam.name, e.awayTeam.name, "S Sport / beIN");

        globalTennisCache.set(e.id, {
            id: e.id,
            isElite: true,
            status: statusType,
            fixedDate: fixedDate,
            fixedTime: timeString,
            timestamp: startTimestamp,
            broadcaster: result.kanal,
            homeTeam: { name: e.homeTeam.name || "Belli Değil" },
            awayTeam: { name: e.awayTeam.name || "Belli Değil" },
            tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/tournament_logos/default.png`,
            homeScore: !hasScore ? "-" : String(e.homeScore?.display ?? "0"),
            awayScore: !hasScore ? "-" : String(e.awayScore?.display ?? "0"),
            tournament: e.tournament?.name || ""
        });
    }

    const finalMatches = Array.from(globalTennisCache.values()).sort((a, b) => a.timestamp - b.timestamp);
    await uploadToFirebase("tennis", { success: true, matches: finalMatches });
    
    const hasLiveMatch = finalMatches.some(m => m.status === 'inprogress');
    return { hasLiveMatch, nextMatchTimestamp: findNextMatchTime(globalTennisCache), hasAnyMatches: finalMatches.length > 0 };
}


// =========================================================================
// 🏎️ FORMULA 1 GÜNCELLEME (ERGAST/JOLPI - ESKİ HALİYLE KORUNDU)
// =========================================================================
async function updateF1() {
    console.log(`🏎️ Formula 1 güncelleniyor...`);
    try {
        const response = await fetchSofascore('https://api.jolpi.ca/ergast/f1/current.json');
        if (!response) return;
        const races = response.MRData?.RaceTable?.Races || [];
        const finalEvents = [];

        races.forEach(race => {
            const addSession = (sessionName, dateStr, timeStr) => {
                if (!dateStr || !timeStr) return;
                const dateObj = new Date(`${dateStr}T${timeStr}`);
                finalEvents.push({
                    id: `${race.round}_${sessionName.replace(/\s/g, '')}`,
                    fixedDate: dateObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' }),
                    fixedTime: dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
                    timestamp: dateObj.getTime(),
                    broadcaster: "beIN Sports / F1 TV",
                    grandPrix: race.raceName,
                    sessionName: sessionName
                });
            };

            if (race.FirstPractice) addSession("1. Antrenman", race.FirstPractice.date, race.FirstPractice.time);
            if (race.SecondPractice) addSession("2. Antrenman", race.SecondPractice.date, race.SecondPractice.time);
            if (race.ThirdPractice) addSession("3. Antrenman", race.ThirdPractice.date, race.ThirdPractice.time);
            if (race.Qualifying) addSession("Sıralama", race.Qualifying.date, race.Qualifying.time);
            if (race.Sprint) addSession("Sprint", race.Sprint.date, race.Sprint.time);
            addSession("Yarış", race.date, race.time);
        });

        finalEvents.sort((a, b) => a.timestamp - b.timestamp);
        await uploadToFirebase("f1", { success: true, events: finalEvents });
        console.log(`  ✅ F1 güncellemesi tamamlandı.`);
    } catch (error) { console.error(`   ⚠️ F1 hatası: ${error.message}`); }
}


// =========================================================================
// 🆕 ANA DÖNGÜ
// =========================================================================
async function main() {
    if (!apnProvider) {
        console.error("⚠️ KRİTİK HATA: APNs Sağlayıcı başlatılamadı!");
        return;
    }

    loadState();
    console.log("============================================================");
    console.log("🟢 J7 CANLI SUNUCU BAŞLADI (API-SPORTS ENTEGRE, V8)");
    console.log("============================================================");

    let iteration = 1;
    let lastPeriodicUpdate = 0;

    while (true) {
        try {
            const now = Date.now();
            console.log(`\n[İterasyon ${iteration}] ${new Date().toLocaleTimeString('tr-TR')}`);
            loadExternalBroadcasters();

            const d = new Date(now);
            const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
            const msSinceMidnight = now - startOfDay;

            const TARGET_TIMES = [
                10 * 60 * 1000,
                (6 * 60 + 10) * 60 * 1000,
                (12 * 60 + 10) * 60 * 1000,
                (18 * 60 + 10) * 60 * 1000
            ];

            let activeTarget = startOfDay - (5 * 60 + 50) * 60 * 1000;
            for (let i = TARGET_TIMES.length - 1; i >= 0; i--) {
                if (msSinceMidnight >= TARGET_TIMES[i]) {
                    activeTarget = startOfDay + TARGET_TIMES[i];
                    break;
                }
            }

            const days4 = [getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)];
            const quickScanDates = [getTRDate(-1), getTRDate(0), getTRDate(1)]; 
            const todayOnly = [getTRDate(0)]; 

            // 1. ANA PERİYODİK GÜNCELLEME (Günde 4 kez tüm sporlar 4 günlük veri çeker)
            if (lastPeriodicUpdate < activeTarget) {
                console.log("🔄 [PERİYODİK GÜNCELLEME] Ana Saat Dilimi Tetiklendi!");

                const footballResult = await updateFootball(days4);
                const basketballResult = await updateBasketball(days4);
                const tennisResult = await updateTennis(days4);
                await updateF1();

                sportUpdateStatus.football.nextMatchTime = footballResult.nextMatchTimestamp;
                sportUpdateStatus.basketball.nextMatchTime = basketballResult.nextMatchTimestamp;
                sportUpdateStatus.tennis.nextMatchTime = tennisResult.nextMatchTimestamp;
                sportUpdateStatus.football.hasLiveMatch = footballResult.hasLiveMatch;
                sportUpdateStatus.basketball.hasLiveMatch = basketballResult.hasLiveMatch;
                sportUpdateStatus.tennis.hasLiveMatch = tennisResult.hasLiveMatch;

                lastPeriodicUpdate = now;
            }

            // 2. FUTBOL HIZLI GÜNCELLEME DÖNGÜSÜ
            if (sportUpdateStatus.football.hasLiveMatch) {
                if (now - sportUpdateStatus.football.lastQuickUpdate >= MINUTE_MS) {
                    console.log("⚽ [HIZLI DÖNGÜ] Canlı futbol maçı var - Sadece bugün güncelleniyor...");
                    const footResult = await updateFootball(todayOnly); 
                    sportUpdateStatus.football.lastQuickUpdate = now;
                    sportUpdateStatus.football.hasLiveMatch = footResult.hasLiveMatch;
                    sportUpdateStatus.football.nextMatchTime = footResult.nextMatchTimestamp;
                }
            } else if (sportUpdateStatus.football.nextMatchTime && now >= (sportUpdateStatus.football.nextMatchTime - MINUTE_MS * 1.1)) {
                if (now - sportUpdateStatus.football.lastQuickUpdate >= MINUTE_MS) {
                    const footResult = await updateFootball(quickScanDates); 
                    sportUpdateStatus.football.lastQuickUpdate = now;
                    sportUpdateStatus.football.hasLiveMatch = footResult.hasLiveMatch;
                    sportUpdateStatus.football.nextMatchTime = footResult.nextMatchTimestamp;
                }
            }

            // 3. BASKETBOL HIZLI GÜNCELLEME DÖNGÜSÜ
            const hasUpcomingBasketball = sportUpdateStatus.basketball.nextMatchTime && now >= (sportUpdateStatus.basketball.nextMatchTime - MINUTE_MS * 11);
            if ((sportUpdateStatus.basketball.hasLiveMatch || hasUpcomingBasketball) && now - sportUpdateStatus.basketball.lastQuickUpdate >= TEN_MIN_MS) {
                console.log("🏀 [HIZLI DÖNGÜ] Basketbol verileri güncelleniyor...");
                const basketResult = await updateBasketball(quickScanDates);
                sportUpdateStatus.basketball.lastQuickUpdate = now;
                sportUpdateStatus.basketball.nextMatchTime = basketResult.nextMatchTimestamp;
                sportUpdateStatus.basketball.hasLiveMatch = basketResult.hasLiveMatch;
            }

            // 4. TENİS HIZLI GÜNCELLEME DÖNGÜSÜ
            const hasUpcomingTennis = sportUpdateStatus.tennis.nextMatchTime && now >= (sportUpdateStatus.tennis.nextMatchTime - MINUTE_MS * 11);
            if ((sportUpdateStatus.tennis.hasLiveMatch || hasUpcomingTennis) && now - sportUpdateStatus.tennis.lastQuickUpdate >= TEN_MIN_MS) {
                console.log("🎾 [HIZLI DÖNGÜ] Tenis verileri güncelleniyor...");
                const tennisResult = await updateTennis(quickScanDates);
                sportUpdateStatus.tennis.lastQuickUpdate = now;
                sportUpdateStatus.tennis.nextMatchTime = tennisResult.nextMatchTimestamp;
                sportUpdateStatus.tennis.hasLiveMatch = tennisResult.hasLiveMatch;
            }

            // 5. UYKU HESAPLAMASI
            let sleepTime = TEN_MIN_MS;
            const isFootballActive = sportUpdateStatus.football.hasLiveMatch || (sportUpdateStatus.football.nextMatchTime && now >= (sportUpdateStatus.football.nextMatchTime - MINUTE_MS * 12));

            if (isFootballActive) {
                sleepTime = MINUTE_MS;
                console.log("⚡ Aktif futbol takibi, 1 dakika sonra kontrol...");
            } else if (sportUpdateStatus.basketball.hasLiveMatch || hasUpcomingBasketball || sportUpdateStatus.tennis.hasLiveMatch || hasUpcomingTennis) {
                let timeToNextBask = sportUpdateStatus.basketball.hasLiveMatch || hasUpcomingBasketball ? TEN_MIN_MS - (now - sportUpdateStatus.basketball.lastQuickUpdate) : TEN_MIN_MS;
                let timeToNextTen = sportUpdateStatus.tennis.hasLiveMatch || hasUpcomingTennis ? TEN_MIN_MS - (now - sportUpdateStatus.tennis.lastQuickUpdate) : TEN_MIN_MS;
                
                sleepTime = Math.min(timeToNextBask, timeToNextTen);
                if (sleepTime < MINUTE_MS) sleepTime = MINUTE_MS;
                console.log(`⏱️ Basketbol/Tenis takibi: Sonraki uyandırma ${Math.ceil(sleepTime / 60000)} dakika sonra...`);
            } else {
                console.log("💤 Hiç maç yok, 10 dakika derin uyku modu...");
            }

            await new Promise(r => setTimeout(r, sleepTime));
            iteration++;

        } catch (e) {
            console.error("🚨 Hata:", e.message);
            await new Promise(r => setTimeout(r, MINUTE_MS));
        }
    }
}

main();
