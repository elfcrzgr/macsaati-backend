const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);

require('events').EventEmitter.defaultMaxListeners = 100;

// =========================================================================
// 🔥 AYARLAR VE ÇALIŞMA ORTAMI
// =========================================================================
const STATE_FILE = 'basketball_states.json'; 
const GITHUB_USER = "elfcrzgr";
const REPO_NAME = "macsaati-backend";
const MINUTE_MS = 180000;
const LIVE_FAST_MS = 180000; // 🔥 CANLI MAÇ İÇİN: 3 Dakika
const TEN_MIN_MS = 10 * 60000;

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

// =========================================================================
// 🏆 LİG İSİMLERİNİ GITHUB REPO ID'LERİNE BAĞLAYAN SÖZLÜK
// =========================================================================
function getTournamentRepoId(compName) {
    if (!compName) return "519"; 
    const name = String(compName).toUpperCase();

    if (name.includes("NBA")) return "3547";
    if (name.includes("EUROLEAGUE")) return "138";
    if (name.includes("EUROCUP")) return "141";
    if (name.includes("TÜRKİYE SİGORTA BSL") || name.includes("BASKETBOL SÜPER LİGİ")) return "519";
    if (name.includes("ŞAMPiyonlar LİGİ") || name.includes("BCL") || name.includes("CHAMPIONS LEAGUE")) return "9357";
    if (name.includes("İSPANYA") || name.includes("ACB")) return "264";
    if (name.includes("YUNANİSTAN")) return "304";
    if (name.includes("ALMANYA") || name.includes("BBL")) return "227";
    if (name.includes("FRANSA") || name.includes("PRO A")) return "156";
    if (name.includes("ADRIYATIK") || name.includes("ABA")) return "235";
    if (name.includes("VTB")) return "1438";
    if (name.includes("WNBA")) return "486";
    if (name.includes("YAZ LİGİ")) return "10415";
    if (name.includes("DÜNYA KUPASI")) return "10437";
    if (name.includes("TÜRKİYE BASKETBOL LİGİ") || name.includes("TBL") || name.includes("2. LİG")) return "1179";

    return "519"; 
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
        const response = await fetch(url, { signal: timeoutSignal(10000), cache: 'no-store' });
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

                if (matchScore === 2 && diff <= 120) return { kanal: m.yayin, source: "sporekrani" };
                else if (matchScore === 1 && diff <= 15 && dateKey === dateStr) return { kanal: m.yayin, source: "sporekrani" };
            }
        }
    }
    return { kanal: fallback, source: "fallback" };
}

const getFallbackBroadcaster = (compName) => {
    return " "; 
};

// =========================================================================
// 🛠️ YARDIMCI FONKSİYONLAR VE FETCH
// =========================================================================
async function uploadToFirebase(data) {
    try {
        await withTimeout(firebaseApp.database().ref(`matches_basketball`).set(data), 15000, 'Firebase yazma');
    } catch (error) { console.error(`❌ [FIREBASE-BASKETBOL] Hata:`, error.message); }
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
// 🏀 TBF (TÜRKİYE BASKETBOL FEDERASYONU) ENTEGRASYONU — BSL & TBL
// =========================================================================
const TBF_LEAGUES = {
    bsl: { id: 22214, displayName: "Türkiye Sigorta Basketbol Süper Ligi" },
    tbl: { id: 22215, displayName: "Türkiye Sigorta Türkiye Basketbol Ligi" }
};

// 🔥 YENİ: TBF CANLI SKOR AVCISI (Tekil Maç Uç Noktası)
async function fetchTBFLiveScore(matchId) {
    try {
        const url = `https://tbf.org.tr/api/Match/GetMatchInfo?matchId=${matchId}&_=${Date.now()}`;
        const { stdout } = await execFileAsync('curl', [
            '-s',
            '--max-time', '8',
            url,
            '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36',
            '-H', 'Accept: application/json',
            '-H', 'Cache-Control: no-cache, no-store, must-revalidate',
            '-H', 'Pragma: no-cache'
        ]);
        const json = JSON.parse(stdout);
        if (json && json.data) {
            return {
                homeScore: json.data.homeTeam?.score,
                awayScore: json.data.awayTeam?.score,
                statusId: json.data.matchStatusId
            };
        }
        return null;
    } catch (e) {
        console.error(`❌ TBF Canlı Skor Hatası (${matchId}):`, e.message);
        return null;
    }
}

async function fetchTBFWeek(activityId, weekFilter = null) {
    try {
        // 🔥 DÜZELTME: TBF Ana URL'sinin sonuna Cache kırmak için zaman damgası (Date.now) eklendi
        let url = `https://tbf.org.tr/api/Match/get-all-matches-for-filter?ActivityId=${activityId}&Page=1&PageSize=-1&_=${Date.now()}`;
        if (weekFilter !== null) url += `&WeekFilter=${weekFilter}`;

        const { stdout } = await execFileAsync('curl', [
            '-s',
            '--max-time', '15',
            url,
            '-H', 'User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15',
            '-H', 'Referer: https://tbf.org.tr/',
            '-H', 'Cache-Control: no-cache, no-store, must-revalidate',
            '-H', 'Pragma: no-cache'
        ]);

        const json = JSON.parse(stdout);
        return json?.data || null;
    } catch (e) {
        console.error(`❌ TBF istek hatası (ActivityId=${activityId}, Week=${weekFilter}):`, e.message);
        return null;
    }
}

function extractWeekNumber(matches) {
    if (!matches || matches.length === 0) return null;
    const m = matches[0].week?.match(/\d+/);
    return m ? parseInt(m[0]) : null;
}

function mapTBFStatus(matchStatusId, matchTimestamp) {
    if (matchStatusId === 1) return 'finished';
    
    // TBF statüsü canlı olarak güncellediyse
    if (matchStatusId === 2 || matchStatusId === 3) return 'inprogress';

    // Zorunlu Canlı: Maç saati geldi mi? (Maçın üzerinden 3 saat geçene kadar canlı say)
    const now = Date.now();
    const THREE_HOURS = 3 * 60 * 60 * 1000;
    
    if (matchStatusId !== 1 && now >= matchTimestamp && now <= matchTimestamp + THREE_HOURS) {
        return 'inprogress';
    }

    return 'notstarted';
}

async function fetchTBFLeagueMatches(activityId, targetDates) {
    const currentWeekMatches = await fetchTBFWeek(activityId);
    const currentWeek = extractWeekNumber(currentWeekMatches);

    let allMatches = [...(currentWeekMatches || [])];

    if (currentWeek !== null) {
        const [prevWeekMatches, nextWeekMatches] = await Promise.all([
            fetchTBFWeek(activityId, currentWeek - 1),
            fetchTBFWeek(activityId, currentWeek + 1)
        ]);
        if (prevWeekMatches) allMatches.push(...prevWeekMatches);
        if (nextWeekMatches) allMatches.push(...nextWeekMatches);
    }

    const uniqueMap = new Map();
    for (const m of allMatches) uniqueMap.set(m.matchId, m);
    allMatches = Array.from(uniqueMap.values());

    return allMatches.filter(m => targetDates.includes(m.matchDateOnly));
}

async function updateTBF(targetDates = [getTRDate(0)]) {
    let totalAdded = 0;

    for (const [code, league] of Object.entries(TBF_LEAGUES)) {
        const matches = await fetchTBFLeagueMatches(league.id, targetDates);
        if (!matches) continue;

        for (const m of matches) {
            
            const dateTimeStr = `${m.matchDateOnly}T${m.matchTime}:00+03:00`;
            const matchDateObj = new Date(dateTimeStr); 
            const matchTimestamp = matchDateObj.getTime();

            let statusType = mapTBFStatus(m.matchStatusId, matchTimestamp);
            
            let homeScore = "-";
            let awayScore = "-";

            // 🔥 CANLI İSE TEKİL MAÇ UÇ NOKTASINDAN GERÇEK ZAMANLI SKORU ÇEK
            if (statusType === 'inprogress') {
                const liveData = await fetchTBFLiveScore(m.matchId);
                
                if (liveData) {
                    if (liveData.statusId === 1) statusType = 'finished';
                    
                    if (liveData.homeScore !== null && liveData.homeScore !== undefined) {
                        homeScore = String(liveData.homeScore);
                    }
                    if (liveData.awayScore !== null && liveData.awayScore !== undefined) {
                        awayScore = String(liveData.awayScore);
                    }
                } else {
                    // API çökükse veya boşsa yedeğe (toplu listeye) düş
                    if (m.homeTeam?.score !== null && m.homeTeam?.score !== undefined) {
                        homeScore = String(m.homeTeam.score);
                    }
                    if (m.awayTeam?.score !== null && m.awayTeam?.score !== undefined) {
                        awayScore = String(m.awayTeam.score);
                    }
                }
            } else if (statusType === 'finished') {
                homeScore = String(m.homeTeam?.score ?? "0");
                awayScore = String(m.awayTeam?.score ?? "0");
            }

            const tbfFallback = m.broadcastChannel || " ";
            const result = getBroadcasterWithFallback("basketbol", m.matchDateOnly, m.matchTime, m.homeTeam.name, m.awayTeam.name, tbfFallback);

            const uniqueId = `tbf_${m.matchId}`;

            globalBasketballCache.set(uniqueId, {
                id: uniqueId,
                isElite: true,
                status: statusType,
                fixedDate: m.matchDateOnly,
                fixedTime: m.matchTime,
                timestamp: matchTimestamp,
                broadcaster: result.kanal,
                homeTeam: { name: m.homeTeam.name, logo: m.homeTeam.logoUrl },
                awayTeam: { name: m.awayTeam.name, logo: m.awayTeam.logoUrl },
                tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/tournament_logos/${getTournamentRepoId(league.displayName)}.png`,
                homeScore: homeScore,
                awayScore: awayScore,
                tournament: league.displayName
            });

            previousMatchStates.set(uniqueId, { status: statusType, date: m.matchDateOnly });
            totalAdded++;
        }
    }

    console.log(`🏀 [TBF] ${totalAdded} maç işlendi (BSL + TBL).`);
    return totalAdded;
}

// =========================================================================
// 🏀 ESPN ENTEGRASYONU — NBA & WNBA
// =========================================================================
const ESPN_LEAGUES = {
    nba: { slug: 'nba', displayName: 'NBA' },
    wnba: { slug: 'wnba', displayName: 'WNBA' }
};

function toESPNDateFormat(trDateStr) {
    return trDateStr.replace(/-/g, '');
}

async function fetchESPNDay(leagueSlug, dateStr) {
    try {
        const espnDate = toESPNDateFormat(dateStr);
        const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/${leagueSlug}/scoreboard?dates=${espnDate}&_=${Date.now()}`;

        const response = await fetch(url, {
            signal: timeoutSignal(15000),
            cache: 'no-store',
            headers: {
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15",
                "Accept": "application/json",
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache"
            }
        });

        if (!response.ok) {
            console.error(`❌ ESPN (${leagueSlug}) ${dateStr} -> HTTP ${response.status}`);
            return null;
        }

        const json = await response.json();
        return json?.events || [];
    } catch (e) {
        console.error(`❌ ESPN istek hatası (${leagueSlug}, ${dateStr}):`, e.message);
        return null;
    }
}

function mapESPNStatus(state) {
    if (state === 'post') return 'finished';
    if (state === 'in') return 'inprogress';
    return 'notstarted';
}

async function updateESPN(targetDates = [getTRDate(0)]) {
    let totalAdded = 0;

    for (const [code, league] of Object.entries(ESPN_LEAGUES)) {
        for (const dateStr of targetDates) {
            const events = await fetchESPNDay(league.slug, dateStr);
            if (!events) continue;

            for (const event of events) {
                const comp = event.competitions?.[0];
                if (!comp) continue;

                const homeC = comp.competitors.find(c => c.homeAway === 'home');
                const awayC = comp.competitors.find(c => c.homeAway === 'away');
                if (!homeC || !awayC) continue;

                const state = comp.status?.type?.state;
                const statusType = mapESPNStatus(state);
                const hasScore = statusType !== 'notstarted';

                const eventDate = new Date(event.date); 
                const fixedDate = eventDate.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
                const fixedTime = eventDate.toLocaleTimeString('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

                const espnBroadcasts = comp.broadcasts?.flatMap(b => b.names || []) || [];
                const espnFallback = espnBroadcasts.length > 0 ? espnBroadcasts.join(' / ') : getFallbackBroadcaster(league.displayName);

                const result = getBroadcasterWithFallback("basketbol", fixedDate, fixedTime, homeC.team.displayName, awayC.team.displayName, espnFallback);

                const uniqueId = `espn_${event.id}`;

                globalBasketballCache.set(uniqueId, {
                    id: uniqueId,
                    isElite: true,
                    status: statusType,
                    fixedDate: fixedDate,
                    fixedTime: fixedTime,
                    timestamp: eventDate.getTime(),
                    broadcaster: result.kanal,
                    homeTeam: { name: homeC.team.displayName, logo: homeC.team.logo },
                    awayTeam: { name: awayC.team.displayName, logo: awayC.team.logo },
                    tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/tournament_logos/${getTournamentRepoId(league.displayName)}.png`,
                    homeScore: hasScore ? String(homeC.score ?? "0") : "-",
                    awayScore: hasScore ? String(awayC.score ?? "0") : "-",
                    tournament: league.displayName
                });

                previousMatchStates.set(uniqueId, { status: statusType, date: fixedDate });
                totalAdded++;
            }
        }
    }

    console.log(`🏀 [ESPN] ${totalAdded} maç işlendi (NBA + WNBA).`);
    return totalAdded;
}

// =========================================================================
// 🏀 EUROLEAGUE & EUROCUP ENTEGRASYONU (RESMİ API)
// =========================================================================
const EUROLEAGUE_COMPETITIONS = {
    euroleague: { code: 'E', displayName: 'EuroLeague' },
    eurocup: { code: 'U', displayName: 'EuroCup' }
};

function getCurrentEuroSeasonYear() {
    const ist = getIstanbulNow();
    const month = ist.getMonth() + 1; 
    return month >= 7 ? ist.getFullYear() : ist.getFullYear() - 1;
}

async function fetchEuroLeagueSeason(competitionCode, seasonCode) {
    try {
        const url = `https://api-live.euroleague.net/v2/competitions/${competitionCode}/seasons/${seasonCode}/games?_=${Date.now()}`;
        const response = await fetch(url, {
            signal: timeoutSignal(15000),
            cache: 'no-store',
            headers: {
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15",
                "Accept": "application/json",
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache"
            }
        });
        if (!response.ok) {
            console.error(`❌ EuroLeague/Cup (${seasonCode}) -> HTTP ${response.status}`);
            return null;
        }
        const json = await response.json();
        return json?.data || null;
    } catch (e) {
        console.error(`❌ EuroLeague/Cup istek hatası (${seasonCode}):`, e.message);
        return null;
    }
}

function convertEuroleagueDate(dateStr) {
    if (!dateStr) return { fixedDate: "", fixedTime: "", timestamp: 0 };
    
    if (dateStr.endsWith('Z') || dateStr.includes('+')) {
        const matchDateObj = new Date(dateStr);
        return {
            fixedDate: matchDateObj.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: matchDateObj.toLocaleTimeString('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
            timestamp: matchDateObj.getTime()
        };
    }
    
    const baseDate = new Date(dateStr + 'Z'); 
    const berlinFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', timeZoneName: 'shortOffset' }).formatToParts(baseDate);
    const tzPart = berlinFmt.find(p => p.type === 'timeZoneName')?.value || 'GMT+1';
    
    const offset = tzPart.includes('+2') ? 2 : 1;
    
    const realUTC = baseDate.getTime() - (offset * 3600000);
    const matchDateObj = new Date(realUTC);
    
    return {
        fixedDate: matchDateObj.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
        fixedTime: matchDateObj.toLocaleTimeString('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
        timestamp: matchDateObj.getTime()
    };
}

function mapEuroLeagueStatus(game, matchTimestamp) {
    if (game.played === true) return 'finished';

    const now = Date.now();
    const THREE_HOURS = 3 * 60 * 60 * 1000;

    if (now >= matchTimestamp && now <= matchTimestamp + THREE_HOURS) return 'inprogress';
    return 'notstarted';
}

async function fetchEuroLiveScore(seasonCode, gameCode) {
    const headers = {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15",
        "Accept": "application/json",
        "Cache-Control": "no-cache"
    };
    try {
        const url = `https://live.euroleague.net/api/Header?gamecode=${gameCode}&seasoncode=${seasonCode}&_=${Date.now()}`;
        const r = await fetch(url, { signal: timeoutSignal(8000), cache: 'no-store', headers });
        if (!r.ok) {
            console.error(`⚠️ Canlı skor HTTP ${r.status} (${seasonCode}/${gameCode})`);
            return null;
        }
        const h = await r.json();
        if (h?.ScoreA === undefined || h?.ScoreB === undefined) {
            console.error("⚠️ Canlı skor beklenmeyen şema:", Object.keys(h || {}));
            return null;
        }
        return { homeScore: String(h.ScoreA), awayScore: String(h.ScoreB) };
    } catch (e) {
        console.error(`⚠️ Canlı skor hatası (${seasonCode}/${gameCode}):`, e.message);
        return null;
    }
}

async function updateEuroLeague(targetDates = [getTRDate(0)]) {
    let totalAdded = 0;
    const seasonYear = getCurrentEuroSeasonYear();

    for (const [key, comp] of Object.entries(EUROLEAGUE_COMPETITIONS)) {
        const seasonCode = `${comp.code}${seasonYear}`;
        const games = await fetchEuroLeagueSeason(comp.code, seasonCode);
        if (!games) continue;

        for (const g of games) {
            const { fixedDate, fixedTime, timestamp } = convertEuroleagueDate(g.date);

            if (!targetDates.includes(fixedDate)) continue;

            const statusType = mapEuroLeagueStatus(g, timestamp);
            const hasScore = statusType !== 'notstarted';
            
            const homeTeam = g.local?.club;
            const awayTeam = g.road?.club;
            if (!homeTeam || !awayTeam) continue;
            
            let homeScore = hasScore ? String(g.local?.score ?? "0") : "-";
            let awayScore = hasScore ? String(g.road?.score ?? "0") : "-";
            
            if (statusType === 'inprogress') {
                const gameCode = g.gameCode ?? g.code ?? g.id;
                console.log(`🔎 Canlı: ${homeTeam.name} gameCode=${gameCode} keys=${Object.keys(g).join(',')}`);
                const live = await fetchEuroLiveScore(seasonCode, gameCode);
                if (live) { homeScore = live.homeScore; awayScore = live.awayScore; }
            }

            const compFallback = getFallbackBroadcaster(comp.displayName);

            const result = getBroadcasterWithFallback("basketbol", fixedDate, fixedTime, homeTeam.name, awayTeam.name, compFallback);

            const uniqueId = `euro_${g.id}`;

            globalBasketballCache.set(uniqueId, {
                id: uniqueId,
                isElite: true,
                status: statusType,
                fixedDate: fixedDate,
                fixedTime: fixedTime,
                timestamp: timestamp,
                broadcaster: result.kanal,
                homeTeam: { name: homeTeam.name, logo: homeTeam.images?.crest || "" },
                awayTeam: { name: awayTeam.name, logo: awayTeam.images?.crest || "" },
                tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/tournament_logos/${getTournamentRepoId(comp.displayName)}.png`,
                homeScore: homeScore,
                awayScore: awayScore,
                tournament: comp.displayName
            });

            previousMatchStates.set(uniqueId, { status: statusType, date: fixedDate });
            totalAdded++;
        }
    }

    console.log(`🏀 [EUROLEAGUE/CUP] ${totalAdded} maç işlendi.`);
    return totalAdded;
}

// =========================================================================
// 🏀 ANA BİRLEŞTİRİCİ GÜNCELLEME DÖNGÜSÜ
// =========================================================================
async function updateBasketball(targetDates = [getTRDate(0)], isQuickScan = false) {
    console.log(`🏀 Basketbol: (Mod: ${isQuickScan ? '🚀 HIZLI' : '🐢 DETAYLI'}) Tarihler: ${targetDates.join(', ')}`);
    
    let tbfSuccess = false;
    try {
        const tbfCount = await withTimeout(updateTBF(targetDates), 30000, 'TBF taraması');
        tbfSuccess = tbfCount > 0;
    } catch (e) {
        console.error("❌ TBF güncelleme hatası:", e.message);
    }

    let espnSuccess = false;
    try {
        const espnCount = await withTimeout(updateESPN(targetDates), 30000, 'ESPN taraması');
        espnSuccess = espnCount > 0;
    } catch (e) {
        console.error("❌ ESPN güncelleme hatası:", e.message);
    }

    let euroSuccess = false;
    try {
        const euroCount = await withTimeout(updateEuroLeague(targetDates), 30000, 'EuroLeague/Cup taraması');
        euroSuccess = euroCount > 0;
    } catch (e) {
        console.error("❌ EuroLeague/Cup güncelleme hatası:", e.message);
    }

    if (!tbfSuccess && !espnSuccess && !euroSuccess) {
        const stillLive = Array.from(globalBasketballCache.values()).some(m => m.status === 'inprogress');
        return {
            hasLiveMatch: stillLive || sportUpdateStatus.hasLiveMatch,
            nextMatchTimestamp: sportUpdateStatus.nextMatchTime,
            hasAnyMatches: globalBasketballCache.size > 0
        };
    }

    const validDates = [getTRDate(-2), getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)];
    for (const [id, match] of globalBasketballCache.entries()) {
        if (!validDates.includes(match.fixedDate)) globalBasketballCache.delete(id);
    }

    const finalMatches = Array.from(globalBasketballCache.values()).sort((a, b) => a.timestamp - b.timestamp);
    await uploadToFirebase({ success: true, matches: finalMatches });
    
    saveState();
    
    const hasLiveMatch = finalMatches.some(m => m.status === 'inprogress');
    const nextMatchTimestamp = findNextMatchTime(globalBasketballCache);
    return { hasLiveMatch, nextMatchTimestamp, hasAnyMatches: finalMatches.length > 0 };
}


// =========================================================================
// 🆕 ANA DÖNGÜ
// =========================================================================
async function main() {
    loadState();
    console.log("============================================================");
    console.log("🟢 [BASKETBOL] TBF + ESPN + EUROLEAGUE SERVİSİ BAŞLADI");
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
                if (!forceUpdateDueToBroadcasters) lastPeriodicUpdate = now;
            }

            const currentHour = getIstanbulNow().getHours();
            let quickScanDates = [getTRDate(0)];
            if (currentHour >= 0 && currentHour <= 4) quickScanDates = [getTRDate(-1), getTRDate(0)];

            const isUpcoming = () => sportUpdateStatus.nextMatchTime && now >= (sportUpdateStatus.nextMatchTime - (30 * 60000));
        
            if (sportUpdateStatus.hasLiveMatch) {
                if (now - sportUpdateStatus.lastQuickUpdate >= LIVE_FAST_MS) {
                    console.log("\n🏀 [HIZLI DÖNGÜ] Canlı basketbol maçı var! (3 DK ARAYLA GÜNCELLENİYOR)");
                    const result = await withTimeout(updateBasketball(quickScanDates, true), 60000, 'Hızlı tarama');  
                    sportUpdateStatus.lastQuickUpdate = Date.now();
                    applyResult(result);
                }
            }
            else if (isUpcoming()) {
                if (now - sportUpdateStatus.lastQuickUpdate >= MINUTE_MS) {
                    console.log("\n⏰ [BASKETBOL YAKLAŞAN] Yaklaşan maç vakti! (3 DK ARAYLA GÜNCELLENİYOR)");
                    const result = await withTimeout(updateBasketball(quickScanDates, true), 60000, 'Hızlı tarama'); 
                    sportUpdateStatus.lastQuickUpdate = Date.now();
                    applyResult(result);
                }
            }

            let sleepTime;
            if (sportUpdateStatus.hasLiveMatch) {
                sleepTime = Math.max(10000, LIVE_FAST_MS - (Date.now() - sportUpdateStatus.lastQuickUpdate));
                console.log(`\n⚡ [BASKETBOL] Canlı maç var. ${Math.round(sleepTime / 1000)} sn sonra anlık skor güncellenecek.`);
            } else if (isUpcoming()) {
                sleepTime = Math.max(10000, MINUTE_MS - (Date.now() - sportUpdateStatus.lastQuickUpdate));
                console.log(`\n⚡ [BASKETBOL] Yaklaşan maç var. ${Math.round(sleepTime / 1000)} sn sonra tekrar bakılacak.`);
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
