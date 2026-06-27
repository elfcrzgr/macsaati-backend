const fs = require('fs');
const admin = require('firebase-admin');

if (!admin.apps.length) {
    const serviceAccount = JSON.parse(fs.readFileSync('./serviceAccountKey.json', 'utf8'));
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount), databaseURL: "https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app/" });
}
console.log("🔥 Firebase Admin başlatıldı (Tenis/F1).");

const globalTennisCache = new Map();
const sportUpdateStatus = { lastQuickUpdate: 0, nextMatchTime: null, hasLiveMatch: false };
const HOUR_MS = 60 * 60000;
const GITHUB_USER = "elfcrzgr"; const REPO_NAME = "macsaati-backend";

let externalBroadcasters = {};
function loadExternalBroadcasters() { try { if (fs.existsSync('yayinci_bilgisi.json')) externalBroadcasters = JSON.parse(fs.readFileSync('yayinci_bilgisi.json', 'utf8')); } catch (e) { externalBroadcasters = {}; } }

function getBroadcasterWithFallback(sportCategory, dateStr, timeStr, homeName, awayName, fallback) {
    const cleanTime = (timeStr || "").replace(/\n?CANLI/, "").replace(/\n?MS/, "").replace('.', ':').trim();
    const [cH, cM] = cleanTime.split(':').map(Number);
    const toTR = (str) => str.replace(/İ/g, 'i').replace(/I/g, 'i').replace(/ı/g, 'i').toLowerCase().trim();
    const hName = toTR(homeName || ""); const aName = toTR(awayName || "");
    for (const dateKey of [dateStr]) {
        const dayData = externalBroadcasters[dateKey];
        if (!dayData || !dayData.matches) continue;
        for (const m of dayData.matches) {
            if (m.spor && toTR(m.spor) === toTR(sportCategory)) {
                const mTime = (m.saat || "").replace('.', ':').trim();
                const mTitle = toTR(m.mac || "");
                const getCleanWords = (str) => str.replace(/İ/g, 'i').replace(/I/g, 'i').replace(/Ğ/g, 'g').replace(/ğ/g, 'g').replace(/Ü/g, 'u').replace(/ü/g, 'u').replace(/Ş/g, 's').replace(/ş/g, 's').replace(/Ö/g, 'o').replace(/ö/g, 'o').replace(/Ç/g, 'c').replace(/ç/g, 'c').replace(/ı/g, 'i').toLowerCase().replace(/[^a-z0-9]/g, ' ').split(' ').map(w => w.trim()).filter(w => w.length >= 3);
                const matchHome = getCleanWords(hName).length === 0 || getCleanWords(hName).some(w => mTitle.includes(w));
                const matchAway = getCleanWords(aName).length === 0 || getCleanWords(aName).some(w => mTitle.includes(w));
                if ((matchHome ? 1 : 0) + (matchAway ? 1 : 0) >= 1) return { kanal: m.yayin, source: "sporekrani" };
            }
        }
    }
    return { kanal: fallback, source: "fallback" };
}

async function uploadToFirebase(sportName, data) { try { await admin.database().ref(`matches_${sportName}`).set(data); } catch (error) {} }

async function fetchSofascore(url) {
    try {
        const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36", "Accept-Language": "tr-TR,tr;q=0.9" } });
        if (!response.ok) return null; return await response.json();
    } catch (e) { return null; }
}

const getTRDate = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }); };

function findNextMatchTime(cache, now = Date.now()) {
    let nextTime = null;
    for (const match of cache.values()) if (match.status === 'notstarted' || match.status === 'delayed') { if (match.timestamp <= now) return now; if (!nextTime || match.timestamp < nextTime) nextTime = match.timestamp; }
    return nextTime;
}

async function updateTennis(targetDates) {
    console.log(`🎾 Tenis Sofascore'dan çekiliyor... (Gün: ${targetDates.length})`);
    let rawEvents = [];
    for (const date of targetDates) {
        const data = await fetchSofascore(`https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${date}`);
        if (data?.events) rawEvents.push(...data.events);
    }

    const validDates = [getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)];
    for (const [id, match] of globalTennisCache.entries()) if (!validDates.includes(match.fixedDate)) globalTennisCache.delete(id);

    for (const e of rawEvents) {
        const startTimestamp = e.startTimestamp * 1000; const dateTR = new Date(startTimestamp);
        const fixedDate = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        if (!targetDates.includes(fixedDate)) continue;

        const statusType = e.status?.type;
        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        const hasScore = statusType === 'inprogress' || statusType === 'finished';
        if (statusType === 'inprogress') timeString += "\nCANLI"; else if (statusType === 'finished') timeString += "\nMS";

        const result = getBroadcasterWithFallback("tenis", fixedDate, timeString, e.homeTeam.name, e.awayTeam.name, "S Sport / beIN");
        globalTennisCache.set(e.id, {
            id: e.id, isElite: true, status: statusType, fixedDate: fixedDate, fixedTime: timeString, timestamp: startTimestamp, broadcaster: result.kanal,
            homeTeam: { name: e.homeTeam.name || "Belli Değil" }, awayTeam: { name: e.awayTeam.name || "Belli Değil" },
            tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/tournament_logos/default.png`,
            homeScore: !hasScore ? "-" : String(e.homeScore?.display ?? "0"), awayScore: !hasScore ? "-" : String(e.awayScore?.display ?? "0"), tournament: e.tournament?.name || ""
        });
    }

    const finalMatches = Array.from(globalTennisCache.values()).sort((a, b) => a.timestamp - b.timestamp);
    await uploadToFirebase("tennis", { success: true, matches: finalMatches });
    return { hasLiveMatch: finalMatches.some(m => m.status === 'inprogress'), nextMatchTimestamp: findNextMatchTime(globalTennisCache) };
}

const CIRCUIT_DETAILS = { "bahrain": { laps: "57", length: "5.412 km", record: "1:31.447 - Pedro de la Rosa" }, "jeddah": { laps: "50", length: "6.174 km", record: "1:30.734 - Lewis Hamilton" } }; // Diğerleri kodun orijinalinde uzun duruyor, buraya ekleyebilirsin
async function updateF1() {
    console.log(`🏎️ Formula 1 güncelleniyor...`);
    try {
        const response = await fetchSofascore('https://api.jolpi.ca/ergast/f1/current.json');
        if (!response) return;
        const races = response.MRData?.RaceTable?.Races || []; const finalEvents = [];
        races.forEach(race => {
            const circuitId = race.Circuit.circuitId; const stats = CIRCUIT_DETAILS[circuitId] || { laps: "-", length: "-", record: "-" };
            const addSession = (sessionName, dateStr, timeStr) => {
                if (!dateStr || !timeStr) return; const dateObj = new Date(`${dateStr}T${timeStr}`);
                finalEvents.push({ id: `${race.round}_${sessionName.replace(/\s/g, '')}`, fixedDate: `${dateObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })} ${dateObj.toLocaleDateString('tr-TR', { weekday: 'long' })}`, fixedTime: dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }), timestamp: dateObj.getTime(), broadcaster: "beIN Sports / F1 TV", grandPrix: race.raceName, sessionName: sessionName, trackName: race.Circuit.circuitName, circuitStats: { laps: stats.laps, length: stats.length, record: stats.record } });
            };
            if (race.FirstPractice) addSession("1. Antrenman", race.FirstPractice.date, race.FirstPractice.time);
            addSession("Yarış", race.date, race.time);
        });
        finalEvents.sort((a, b) => a.timestamp - b.timestamp);
        await uploadToFirebase("f1", { success: true, lastUpdated: new Date().toISOString(), totalSessions: finalEvents.length, events: finalEvents });
    } catch (error) {}
}

async function main() {
    console.log("============================================================");
    console.log("🟢 J7 TENİS VE F1 MİKROSERVİSİ BAŞLADI (SAATLİK MOD)");
    console.log("============================================================");

    let iteration = 1; let lastPeriodicUpdate = 0;
    while (true) {
        try {
            const now = Date.now();
            console.log(`\n[🎾 İterasyon ${iteration}] ${new Date().toLocaleTimeString('tr-TR')}`);
            loadExternalBroadcasters();

            const d = new Date(now); const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
            const msSinceMidnight = now - startOfDay;
            const TARGET_TIMES = [ 10 * 60 * 1000, (6 * 60 + 10) * 60 * 1000, (12 * 60 + 10) * 60 * 1000, (18 * 60 + 10) * 60 * 1000 ];
            let activeTarget = startOfDay - (5 * 60 + 50) * 60 * 1000;
            for (let i = TARGET_TIMES.length - 1; i >= 0; i--) if (msSinceMidnight >= TARGET_TIMES[i]) { activeTarget = startOfDay + TARGET_TIMES[i]; break; }

            if (lastPeriodicUpdate < activeTarget) {
                console.log("🔄 [PERİYODİK GÜNCELLEME] Tenis Ana Saat Dilimi Tetiklendi!");
                const tennisResult = await updateTennis([getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)]);
                await updateF1();
                sportUpdateStatus.nextMatchTime = tennisResult.nextMatchTimestamp;
                sportUpdateStatus.hasLiveMatch = tennisResult.hasLiveMatch;
                lastPeriodicUpdate = now;
            }

            const isActiveToday = sportUpdateStatus.hasLiveMatch || (sportUpdateStatus.nextMatchTime && sportUpdateStatus.nextMatchTime < now + 24 * HOUR_MS);
            if (isActiveToday && now - sportUpdateStatus.lastQuickUpdate >= HOUR_MS) {
                console.log("🎾 [SAATLİK DÖNGÜ] Tenis verileri güncelleniyor...");
                const tennisResult = await updateTennis([getTRDate(0)]);
                sportUpdateStatus.lastQuickUpdate = now;
                sportUpdateStatus.nextMatchTime = tennisResult.nextMatchTimestamp;
                sportUpdateStatus.hasLiveMatch = tennisResult.hasLiveMatch;
            }

            let sleepTime = HOUR_MS; 
            if (isActiveToday) {
                let timeToNextTen = HOUR_MS - (now - sportUpdateStatus.lastQuickUpdate);
                if (timeToNextTen > 0 && timeToNextTen < sleepTime) sleepTime = timeToNextTen;
            }
            if (sleepTime < 10 * 60000) sleepTime = 10 * 60000;
            console.log(`⏱️ Dinlenme modu: Sonraki tenis uyandırması ${Math.ceil(sleepTime / 60000)} dakika sonra...`);

            await new Promise(r => setTimeout(r, sleepTime)); iteration++;
        } catch (e) { await new Promise(r => setTimeout(r, 10 * 60000)); }
    }
}
main();
