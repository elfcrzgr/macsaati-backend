const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

// =========================================================================
// 🔥 AYARLAR VE ÇALIŞMA ORTAMI
// =========================================================================
const STATE_FILE = 'tennis_states.json'; // ⚠️ BAĞIMSIZ HAFIZA
const GITHUB_USER = "elfcrzgr";
const REPO_NAME = "macsaati-backend";
const MINUTE_MS = 60000;
const TEN_MIN_MS = 10 * 60000;

// O gün maçı KESİN OLMAYAN tenis ligleri (Akıllı Tarama Kara Listesi)
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
            console.log(`🎾 ${home} vs ${away} | Kanal: ${kanal} [SPOREKRANI]`);
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
            console.log(`📂 [HAFIZA-TENİS] ${previousMatchStates.size} maç durumu yüklendi.`);
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
// 🛠️ YARDIMCI FONKSİYONLAR VE FETCH
// =========================================================================
async function uploadToFirebase(data) {
    try {
        const db = firebaseApp.database();
        const ref = db.ref(`matches_tennis`);
        await ref.set(data);
    } catch (error) { console.error(`❌ [FIREBASE-TENİS] Hata:`, error.message); }
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
            return null; 
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
// 🎾 TENİS YAPILANDIRMASI (HEDEF TURNUVALAR)
// =========================================================================
const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/`;
const TENNIS_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/tournament_logos/`;

// 🔥 YENİ SİSTEM: Sofascore genel aramayı kapattığı için ID bazlı arıyoruz
const targetTennisIds = [
    2361, // 🎾 Wimbledon ATP (Erkekler - Senin yakaladığın gerçek ID!)
    2600, // 🎾 Wimbledon WTA (Kadınlar - Genelde ardışık olur, bunu da ekleyelim)
    2375,// wimbledon ciftler 
    2364,// winbeldon karisik ciftler 
    2449,// us open 
    2601,// us open kadinlar
    2508, // us open ciftler 
    2551,// us open kadinlar ciftler 
    2402, //us open karisik ciftler 
    // 💡 İleride oynanacak diğer turnuvaları Sofascore'dan açıp URL'deki 
    // sayıyı (örn: 2361) tam buraya virgülle ekleyebilirsin.
];


const isGarbage = (tourName, catName) => {
    const t = (tourName || "").toUpperCase(); const c = (catName || "").toUpperCase();
    const garbageWords = ["ITF", "CHALLENGER", "UTR", "QUALIFYING", "QUALIFIERS", "LEGENDS"];
    return garbageWords.some(word => t.includes(word) || c.includes(word));
};

const checkIsValidTournament = (tournamentName) => {
    if (!tournamentName) return false;
    const nameUpper = tournamentName.toUpperCase();
    if (nameUpper.includes("QUALIFYING") || nameUpper.includes("QUALIFIERS")) return false;
    return true;
};

// =========================================================================
// 🎾 TENİS GÜNCELLEME (GERÇEK AKILLI TARAMA)
// =========================================================================
async function updateTennis(targetDates = [getTRDate(0)], isQuickScan = false) {
    console.log(`🎾 Tenis: (Mod: ${isQuickScan ? '🚀 HIZLI' : '🐢 DETAYLI'})`);
    const validDates = [getTRDate(-2), getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2), getTRDate(3)];

    for (const [id, state] of previousMatchStates.entries()) {
        if (state.date && !validDates.includes(state.date) && state.status !== 'inprogress') previousMatchStates.delete(id);
    }
    saveState();

    // 🧹 HAFIZA TEMİZLİĞİ
    for (const dateKey of emptyLeaguesCache.keys()) {
        if (!validDates.includes(dateKey)) emptyLeaguesCache.delete(dateKey);
    }

    let rawEvents = [];
    let successfulDates = [];
    const seenEventIds = new Set();
    let tenisMatchesLog = [];

    for (const date of targetDates) {
        let dateHasMatches = false;
        
        if (!emptyLeaguesCache.has(date)) emptyLeaguesCache.set(date, new Set());
        const knownEmptyLeagues = emptyLeaguesCache.get(date);

        let leaguesToFetch = [];

        if (isQuickScan) {
            const activeLeagues = new Set();
            for (const match of globalTennisCache.values()) {
                if (match.fixedDate === date) {
                    const lId = match.tournamentLogo.split('/').pop().replace('.png', '');
                    activeLeagues.add(Number(lId));
                }
            }
            leaguesToFetch = Array.from(activeLeagues);
        } else {
            leaguesToFetch = targetTennisIds.filter(id => !knownEmptyLeagues.has(id));
        }

        if (leaguesToFetch.length > 0 && !isQuickScan) {
            console.log(`🔍 [${date}] için sorgulanacak tenis turnuvası sayısı: ${leaguesToFetch.length}`);
        }

        for (const leagueId of leaguesToFetch) {
            const url = `https://www.sofascore.com/api/v1/unique-tournament/${leagueId}/scheduled-events/${date}`;
            const data = await fetchData(url);
            
            if (data?.events && data.events.length > 0) {
                const filtered = data.events.filter(e => {
                    const tourName = e.tournament?.name; const catName = e.tournament?.category?.name;
                    if (isGarbage(tourName, catName)) return false;
                    if (!checkIsValidTournament(tourName)) return false;
                    if (seenEventIds.has(e.id)) return false;
                    seenEventIds.add(e.id);
                    return true;
                });
                
                if (filtered.length > 0) {
                    rawEvents.push(...filtered);
                    dateHasMatches = true;
                }
            } else if (data?.is404) {
                knownEmptyLeagues.add(leagueId); // Maç yoksa kara listeye eklendi!
            }
        }
        if (dateHasMatches) successfulDates.push(date);
    }

    if (successfulDates.length === 0 || rawEvents.length === 0) {
        console.log("⚠️ [TENİS] Yeni maç bulunamadı veya takip edilen turnuvalarda maç yok.");
        return { hasLiveMatch: sportUpdateStatus.hasLiveMatch, nextMatchTimestamp: sportUpdateStatus.nextMatchTime, hasAnyMatches: globalTennisCache.size > 0 };
    }

    for (const [id, match] of globalTennisCache.entries()) {
        if (!validDates.includes(match.fixedDate)) globalTennisCache.delete(id);
    }

    // 🔥 ANTI-BAN SİSTEMİ: Tüm detayları yavaşça çeker
    console.log(`⏳ ${rawEvents.length} maçın detayları (sıralama, ülke vb.) sıralı olarak çekiliyor...`);
    const detailsMap = {};
    for (let i = 0; i < rawEvents.length; i++) {
        const e = rawEvents[i];
        process.stdout.write(`\r  🎾 İşleniyor: %${Math.round(((i + 1) / rawEvents.length) * 100)} (${i + 1}/${rawEvents.length})`);
        const detailData = await fetchData(`https://www.sofascore.com/api/v1/event/${e.id}`);
        detailsMap[e.id] = detailData;
    }
    console.log(`\n✅ Tüm detaylar başarıyla alındı!`);

    for (let idx = 0; idx < rawEvents.length; idx++) {
        const e = rawEvents[idx];
        try {
            const startTimestamp = e.startTimestamp * 1000;
            const dateTR = new Date(startTimestamp);
            const fixedDate = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
            if (!targetDates.includes(fixedDate)) continue;

            const tourName = e.tournament?.name || "";
            let homeLogos = []; let awayLogos = []; let hRank = null; let aRank = null;
            const detailData = detailsMap[e.id];

            if (detailData?.event) {
                const ev = detailData.event;
                if (ev.homeTeam?.ranking !== undefined && ev.homeTeam.ranking !== null) hRank = ev.homeTeam.ranking;
                if (ev.awayTeam?.ranking !== undefined && ev.awayTeam.ranking !== null) aRank = ev.awayTeam.ranking;
                if (!hRank && ev.homeTeam?.subTeams?.length > 0) { const ranks = ev.homeTeam.subTeams.map(p => p.ranking).filter(r => r !== undefined && r !== null); if (ranks.length > 0) hRank = Math.min(...ranks); }
                if (!aRank && ev.awayTeam?.subTeams?.length > 0) { const ranks = ev.awayTeam.subTeams.map(p => p.ranking).filter(r => r !== undefined && r !== null); if (ranks.length > 0) aRank = Math.min(...ranks); }
                const getCodes = (team) => { if (team.subTeams && team.subTeams.length > 0) return team.subTeams.map(p => p.country?.alpha2?.toLowerCase()).filter(Boolean); return [team.country?.alpha2?.toLowerCase() || "mc"]; };
                homeLogos = getCodes(ev.homeTeam).map(c => `${TENNIS_LOGO_BASE}${c}.png`); awayLogos = getCodes(ev.awayTeam).map(c => `${TENNIS_LOGO_BASE}${c}.png`);
            } else {
                homeLogos = [e.homeTeam?.country?.alpha2 ? `${TENNIS_LOGO_BASE}${e.homeTeam.country.alpha2.toLowerCase()}.png` : `${TENNIS_LOGO_BASE}mc.png`];
                awayLogos = [e.awayTeam?.country?.alpha2 ? `${TENNIS_LOGO_BASE}${e.awayTeam.country.alpha2.toLowerCase()}.png` : `${TENNIS_LOGO_BASE}mc.png`];
            }

            const statusType = e.status?.type; let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
            const hasScore = statusType === 'inprogress' || statusType === 'finished';
            if (statusType === 'inprogress') timeString += "\nCANLI"; else if (statusType === 'finished') timeString += "\nMS";

            let sets = [];
            if (hasScore && e.homeScore && e.awayScore) {
                for (let i = 1; i <= 5; i++) {
                    const hScore = e.homeScore[`period${i}`]; const aScore = e.awayScore[`period${i}`];
                    if (hScore !== undefined && aScore !== undefined) sets.push(`${hScore}-${aScore}`);
                }
            }

            const fallbackBroadcaster = "S Sport / beIN Sports";
            const result = getBroadcasterWithFallback("tenis", fixedDate, timeString, e.homeTeam.name, e.awayTeam.name, fallbackBroadcaster);

            if (!isQuickScan) tenisMatchesLog.push({ home: e.homeTeam.name, away: e.awayTeam.name, kanal: result.kanal, source: result.source });

            globalTennisCache.set(e.id, {
                id: e.id, isElite: true, status: statusType, fixedDate: fixedDate, fixedTime: timeString, timestamp: startTimestamp, broadcaster: result.kanal,
                homeTeam: { name: e.homeTeam.name || "Belli Değil", ranking: hRank, logos: homeLogos }, awayTeam: { name: e.awayTeam.name || "Belli Değil", ranking: aRank, logos: awayLogos },
                tournamentLogo: TENNIS_TOURNAMENT_BASE + (e.tournament?.uniqueTournament?.id || e.tournament?.category?.id) + ".png",
                homeScore: !hasScore ? "-" : String(e.homeScore?.display ?? "0"), awayScore: !hasScore ? "-" : String(e.awayScore?.display ?? "0"), setScores: sets, tournament: tourName
            });
            
            previousMatchStates.set(String(e.id), { status: statusType, date: fixedDate });
        } catch (error) { continue; }
    }

    const finalMatches = Array.from(globalTennisCache.values()).sort((a, b) => a.timestamp - b.timestamp);
    await uploadToFirebase({ success: true, matches: finalMatches });
    
    if (!isQuickScan && finalMatches.length < 30) logMatchesBySport({ tenis: tenisMatchesLog });

    const hasLiveMatch = finalMatches.some(m => m.status === 'inprogress');
    const nextMatchTimestamp = findNextMatchTime(globalTennisCache);
    return { hasLiveMatch, nextMatchTimestamp, hasAnyMatches: finalMatches.length > 0 };
}

// =========================================================================
// 🆕 ANA DÖNGÜ (SADECE TENİS)
// =========================================================================
async function main() {
    loadState();
    console.log("============================================================");
    console.log("🟢 [TENİS] BAĞIMSIZ SERVİS BAŞLADI");
    console.log("============================================================");

    let lastPeriodicUpdate = 0;

    while (true) {
        try {
            const now = Date.now();
            loadExternalBroadcasters();

            const d = new Date(now);
            const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
            const msSinceMidnight = now - startOfDay;
            const TARGET_TIMES = [ 10 * 60 * 1000, (6 * 60 + 10) * 60 * 1000, (12 * 60 + 10) * 60 * 1000, (18 * 60 + 10) * 60 * 1000 ];
            let activeTarget = startOfDay - (5 * 60 + 50) * 60 * 1000;
            for (let i = TARGET_TIMES.length - 1; i >= 0; i--) {
                if (msSinceMidnight >= TARGET_TIMES[i]) { activeTarget = startOfDay + TARGET_TIMES[i]; break; }
            }

            if (lastPeriodicUpdate < activeTarget) {
                console.log("\n🔄 [PERİYODİK] Detaylı Tarama Başlıyor...");
                const days4 = [getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)];
                const result = await updateTennis(days4, false);
                sportUpdateStatus.nextMatchTime = result.nextMatchTimestamp; sportUpdateStatus.hasLiveMatch = result.hasLiveMatch;
                lastPeriodicUpdate = now;
            }

            const quickScanDates = [getTRDate(-1), getTRDate(0), getTRDate(1)]; 
            const hasUpcoming = sportUpdateStatus.nextMatchTime && now >= (sportUpdateStatus.nextMatchTime - MINUTE_MS * 11);

            if ((sportUpdateStatus.hasLiveMatch || hasUpcoming) && now - sportUpdateStatus.lastQuickUpdate >= TEN_MIN_MS) {
                console.log("\n⚡ [HIZLI DÖNGÜ] Maç vakti yaklaştı/oynanıyor...");
                const result = await updateTennis(quickScanDates, true);
                sportUpdateStatus.lastQuickUpdate = now; sportUpdateStatus.nextMatchTime = result.nextMatchTimestamp; sportUpdateStatus.hasLiveMatch = result.hasLiveMatch;
            }

            let sleepTime = TEN_MIN_MS;
            if (sportUpdateStatus.hasLiveMatch || hasUpcoming) {
                sleepTime = TEN_MIN_MS - (now - sportUpdateStatus.lastQuickUpdate);
                if (sleepTime < MINUTE_MS) sleepTime = MINUTE_MS;
                console.log(`\n⚡ [TENİS] Aktif/Yaklaşan maç var. Terminal ${Math.ceil(sleepTime / 60000)} dakika uykuya yatıyor...`);
            } else {
                console.log("\n💤 [TENİS] Şu an hareket yok. Terminal 10 dakika derin uyku modunda...");
            }

            await new Promise(r => setTimeout(r, sleepTime));
        } catch (e) { 
            console.error("🚨 Hata:", e.message); 
            await new Promise(r => setTimeout(r, MINUTE_MS)); 
        }
    }
}
main();
