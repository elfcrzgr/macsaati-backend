const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const axios = require('axios');

const serviceAccount = JSON.parse(fs.readFileSync('./serviceAccountKey.json', 'utf8'));
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app/"
    });
}
console.log("🔥 Firebase Admin başlatıldı (Basketbol).");

const globalBasketballCache = new Map();
const sportUpdateStatus = { lastQuickUpdate: 0, nextMatchTime: null, hasLiveMatch: false };
const MINUTE_MS = 60000;
const TEN_MIN_MS = 10 * 60000;
const HOUR_MS = 60 * 60000;

function logMatchesBySport(matchGroups) {
    for (const sportType of Object.keys(matchGroups)) {
        const sporekraniMatches = matchGroups[sportType].filter(m => m.source === "sporekrani");
        if (sporekraniMatches.length === 0) continue;
        console.log(`\n--------- 🏀 BASKETBOL SPOREKRANI ---------`);
        for (const m of sporekraniMatches) console.log(`🏀 ${m.home} vs ${m.away} | Kanal: ${m.kanal}`);
    }
}

let externalBroadcasters = {};
function loadExternalBroadcasters() {
    try { if (fs.existsSync('yayinci_bilgisi.json')) externalBroadcasters = JSON.parse(fs.readFileSync('yayinci_bilgisi.json', 'utf8')); else externalBroadcasters = {}; } catch (e) { externalBroadcasters = {}; }
}

function getBroadcasterWithFallback(sportCategory, dateStr, timeStr, homeName, awayName, fallback) {
    const cleanTime = (timeStr || "").replace(/\n?CANLI/, "").replace(/\n?MS/, "").replace('.', ':').trim();
    const [cH, cM] = cleanTime.split(':').map(Number);
    const toTR = (str) => str.replace(/İ/g, 'i').replace(/I/g, 'i').replace(/ı/g, 'i').toLowerCase().trim();
    
    for (const dateKey of [dateStr]) {
        const dayData = externalBroadcasters[dateKey];
        if (!dayData || !dayData.matches) continue;
        for (const m of dayData.matches) {
            if (m.spor && toTR(m.spor) === toTR(sportCategory)) {
                const mTime = (m.saat || "").replace('.', ':').trim();
                const [mH, mM] = mTime.split(':').map(Number);
                const mTitle = toTR(m.mac || "");
                const getCleanWords = (str) => str.replace(/İ/g, 'i').replace(/I/g, 'i').replace(/Ğ/g, 'g').replace(/ğ/g, 'g').replace(/Ü/g, 'u').replace(/ü/g, 'u').replace(/Ş/g, 's').replace(/ş/g, 's').replace(/Ö/g, 'o').replace(/ö/g, 'o').replace(/Ç/g, 'c').replace(/ç/g, 'c').replace(/ı/g, 'i').toLowerCase().replace(/[^a-z0-9]/g, ' ').split(' ').map(w => w.trim()).filter(w => w.length >= 3);
                
                const matchHome = getCleanWords(homeName).length === 0 || getCleanWords(homeName).some(w => mTitle.includes(w));
                const matchAway = getCleanWords(awayName).length === 0 || getCleanWords(awayName).some(w => mTitle.includes(w));
                const matchScore = (matchHome ? 1 : 0) + (matchAway ? 1 : 0);

                let diff = 9999;
                if (mTime === cleanTime) diff = 0;
                else if (!isNaN(mH) && !isNaN(cH) && !isNaN(mM) && !isNaN(cM)) {
                    diff = Math.abs((mH * 60 + mM) - (cH * 60 + cM));
                    if (diff > 1000) diff = Math.abs(diff - 1440);
                }

                if (matchScore === 2 && diff <= 120) return { kanal: m.yayin, source: "sporekrani" };
                else if (matchScore === 1 && diff <= 15) return { kanal: m.yayin, source: "sporekrani" };
            }
        }
    }
    return { kanal: fallback, source: "fallback" };
}

async function uploadToFirebase(sportName, data) {
    try { await admin.database().ref(`matches_${sportName}`).set(data); console.log(`✅ [FIREBASE] ${sportName.toUpperCase()} güncellendi!`); } catch (error) {}
}

async function fetchApiSports(url) {
    try {
        const API_SPORTS_KEY = '870e5a7510c80ee4e84491d6c891bfe7'; 
        const response = await axios.get(url, { headers: { 'x-apisports-key': API_SPORTS_KEY }, timeout: 10000 });
        
        // 🔥 GİZLİ HATALARI EKRANA YAZDIR
        if (response.data && response.data.errors && Object.keys(response.data.errors).length > 0) {
            console.log(`⚠️ API-SPORTS BASKETBOL HATASI:`, response.data.errors);
        }

        if (response.data && response.data.response) return response.data.response; 
        return [];
    } catch (e) { 
        console.error(`❌ BAĞLANTI HATASI:`, e.message);
        return null; 
    }
}

const getTRDate = (offset = 0) => {
    const d = new Date(); d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
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

const teamTranslations = { "turkey": "Türkiye", "germany": "Almanya", "france": "Fransa", "england": "İngiltere", "spain": "İspanya", "italy": "İtalya", "usa": "ABD", "united states": "ABD" };
const translateTeam = (name) => {
    if (!name) return name; const lowerName = name.toLowerCase().trim();
    if (teamTranslations[lowerName]) return teamTranslations[lowerName];
    for (const [eng, tr] of Object.entries(teamTranslations)) {
        const regex = new RegExp(`\\b${eng}\\b`, 'i'); if (regex.test(name)) return name.replace(regex, tr);
    }
    return name;
};

const TARGET_BASKET_LEAGUES = [12, 120, 116, 119, 117, 138];

async function updateBasketball(targetDates) {
    console.log(`🏀 Basketbol verisi çekiliyor... (Gün: ${targetDates.length})`);
    let allGames = [];
    
    for (const date of targetDates) {
        // 🔥 TIMEZONE EKLENDİ! API artık tam olarak Türkiye gününe göre maçları yollayacak.
        const url = `https://v1.basketball.api-sports.io/games?date=${date}&timezone=Europe/Istanbul`;
        const games = await fetchApiSports(url);
        
        if (games !== null) {
            console.log(`  📅 ${date} tarihi için API'den ${games.length} basketbol maçı geldi.`);
            if (games.length > 0) allGames.push(...games);
        }
        await new Promise(r => setTimeout(r, 1000));
    }

    if (allGames.length === 0) {
        console.log("⚠️ Basketbol API tamamen boş döndü! Maç yok veya filtrede takıldı.");
        return { hasLiveMatch: sportUpdateStatus.hasLiveMatch, nextMatchTimestamp: sportUpdateStatus.nextMatchTime }; 
    }

    const validDates = [getTRDate(-2), getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2), getTRDate(3)];
    for (const [id, match] of globalBasketballCache.entries()) if (!validDates.includes(match.fixedDate)) globalBasketballCache.delete(id);

    let basketbolMatchesLog = [];
    for (const g of allGames) {
        // 🔥 FİLTRE KAPALI: Tüm maçlar alınacak (Test için)
        // if (!TARGET_BASKET_LEAGUES.includes(g.league.id)) continue;

        const dateTR = new Date(g.timestamp * 1000); const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        if (!targetDates.includes(dayStr)) continue;

        const statusShort = g.status.short;
        const isFinished = ["FT", "AOT"].includes(statusShort); const isInProgress = ["Q1", "Q2", "HT", "Q3", "Q4", "OT"].includes(statusShort);
        let statusType = isFinished ? "finished" : (isInProgress ? "inprogress" : "notstarted");
        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        if (isInProgress) timeString = `${timeString}\n${statusShort}`;

        const translatedHome = translateTeam(g.teams.home.name); const translatedAway = translateTeam(g.teams.away.name);
        const result = getBroadcasterWithFallback("basketbol", dayStr, timeString, translatedHome, translatedAway, "Resmi Yayıncı");
        basketbolMatchesLog.push({ home: translatedHome, away: translatedAway, kanal: result.kanal, source: result.source });

        globalBasketballCache.set(g.id, {
            id: g.id, isElite: true, status: statusType, fixedDate: dayStr, fixedTime: timeString, timestamp: g.timestamp * 1000, broadcaster: result.kanal,
            homeTeam: { name: translatedHome, logo: g.teams.home.logo, id: g.teams.home.id }, awayTeam: { name: translatedAway, logo: g.teams.away.logo, id: g.teams.away.id }, 
            tournamentLogo: g.league.logo, homeScore: (isInProgress || isFinished) ? String(g.scores.home.total ?? "0") : "-", awayScore: (isInProgress || isFinished) ? String(g.scores.away.total ?? "0") : "-", tournament: g.league.name
        });
    }

    const matches = Array.from(globalBasketballCache.values()).sort((a, b) => a.timestamp - b.timestamp);
    await uploadToFirebase("basketball", { success: true, lastUpdate: new Date().toLocaleTimeString('tr-TR'), matches });
    logMatchesBySport({ basketbol: basketbolMatchesLog });
    
    return { hasLiveMatch: matches.some(m => m.status === 'inprogress'), nextMatchTimestamp: findNextMatchTime(globalBasketballCache), hasAnyMatches: matches.length > 0 };
}

async function main() {
    console.log("============================================================");
    console.log("🟢 J7 BASKETBOL MİKROSERVİSİ BAŞLADI (SAATLİK MOD)");
    console.log("============================================================");

    let iteration = 1; let lastPeriodicUpdate = 0;

    while (true) {
        try {
            const now = Date.now();
            console.log(`\n[🏀 İterasyon ${iteration}] ${new Date().toLocaleTimeString('tr-TR')}`);
            loadExternalBroadcasters();

            const d = new Date(now); const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
            const msSinceMidnight = now - startOfDay;
            // Sadece Gece 01:00'de 4 günlük veriyi çeker
            const TARGET_TIMES = [ 1 * 60 * 60 * 1000 ]; 
            let activeTarget = startOfDay - (23 * 60 * 60 * 1000);
            for (let i = TARGET_TIMES.length - 1; i >= 0; i--) if (msSinceMidnight >= TARGET_TIMES[i]) { activeTarget = startOfDay + TARGET_TIMES[i]; break; }

            if (lastPeriodicUpdate < activeTarget) {
                console.log("🔄 [PERİYODİK GÜNCELLEME] Basketbol Ana Saat Dilimi Tetiklendi!");
                const basketResult = await updateBasketball([getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)]);
                sportUpdateStatus.nextMatchTime = basketResult.nextMatchTimestamp;
                sportUpdateStatus.hasLiveMatch = basketResult.hasLiveMatch;
                
                // Çifte vuruş engeli
                lastPeriodicUpdate = now;
                sportUpdateStatus.lastQuickUpdate = now;
            }

            const isActiveToday = sportUpdateStatus.hasLiveMatch || (sportUpdateStatus.nextMatchTime && sportUpdateStatus.nextMatchTime < now + 24 * HOUR_MS);
            if (isActiveToday && now - sportUpdateStatus.lastQuickUpdate >= HOUR_MS) {
                console.log("🏀 [SAATLİK DÖNGÜ] Basketbol verileri güncelleniyor...");
                const basketResult = await updateBasketball([getTRDate(0)]);
                sportUpdateStatus.lastQuickUpdate = now;
                sportUpdateStatus.nextMatchTime = basketResult.nextMatchTimestamp;
                sportUpdateStatus.hasLiveMatch = basketResult.hasLiveMatch;
            }

            let sleepTime = HOUR_MS; 
            if (isActiveToday) {
                let timeToNextBask = HOUR_MS - (now - sportUpdateStatus.lastQuickUpdate);
                if (timeToNextBask > 0 && timeToNextBask < sleepTime) sleepTime = timeToNextBask;
            }
            if (sleepTime < TEN_MIN_MS) sleepTime = TEN_MIN_MS;
            console.log(`⏱️ Dinlenme modu: Sonraki basketbol uyandırması ${Math.ceil(sleepTime / 60000)} dakika sonra...`);

            await new Promise(r => setTimeout(r, sleepTime)); iteration++;
        } catch (e) { console.error("🚨 Hata:", e.message); await new Promise(r => setTimeout(r, TEN_MIN_MS)); }
    }
}
main();
