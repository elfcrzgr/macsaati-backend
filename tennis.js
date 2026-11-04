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
const MINUTE_MS = 180000; 
const TEN_MIN_MS = 10 * 60000;

const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/`;
const TENNIS_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/tournament_logos/`;

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


// =========================================================================
// 🎾 ESPN ENTEGRASYONU — ATP & WTA (MAÇKOLİK'İN YERİNE)
// =========================================================================
const ESPN_TENNIS_LEAGUES = {
    atp: { slug: 'atp', displayName: 'ATP' },
    wta: { slug: 'wta', displayName: 'WTA' }
};

async function fetchESPNMatches(leagueSlug) {
    try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/tennis/${leagueSlug}/scoreboard`;
        
        const response = await fetch(url, {
            signal: timeoutSignal(15000),
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/json"
            }
        });
        
        if (!response.ok) return null;
        const json = await response.json();
        return json?.events || [];
    } catch (e) {
        return null;
    }
}

function mapESPNStatus(state) {
    if (state === 'post') return 'finished';
    if (state === 'in') return 'inprogress';
    return 'notstarted';
}

const getRepoLogoByTournamentName = (tourName) => {
    if (!tourName) return "default.png";
    const n = tourName.toUpperCase();

    if (n.includes("AUSTRALIAN OPEN")) return "2363.png";
    if (n.includes("ROLAND GARROS") || n.includes("FRENCH OPEN")) return "2480.png";
    if (n.includes("WIMBLEDON")) return "2361.png";
    if (n.includes("US OPEN")) return "2449.png";

    if (n.includes("INDIAN WELLS")) return "2487.png";
    if (n.includes("MIAMI")) return "2430.png";
    if (n.includes("MONTE CARLO")) return "2391.png";
    if (n.includes("MADRID")) return "2374.png";
    if (n.includes("ROME") || n.includes("ROMA")) return "2488.png";
    if (n.includes("MONTREAL") || n.includes("TORONTO") || n.includes("CANADA")) return "2390.png";
    if (n.includes("CINCINNATI")) return "2373.png";
    if (n.includes("SHANGHAI") || n.includes("ŞANGHAY")) return "2519.png";
    if (n.includes("PARIS") || n.includes("PARİS")) return "2404.png";

    if (n.includes("TOKYO")) return "2435.png";
    if (n.includes("BEIJING") || n.includes("PEKİN")) return "2436.png";
    if (n.includes("WASHINGTON")) return "2368.png";
    if (n.includes("ROTTERDAM")) return "2444.png";
    if (n.includes("DUBAI") || n.includes("DUBAİ")) return "2389.png";
    if (n.includes("BARCELONA") || n.includes("BARSELONA")) return "2407.png";
    if (n.includes("HALLE")) return "2493.png";
    if (n.includes("HAMBURG")) return "2405.png";
    if (n.includes("VIENNA") || n.includes("VİYANA")) return "2428.png";
    if (n.includes("ATP FINALS")) return "2429.png";
    if (n.includes("WTA FINALS") || n.includes("RIYADH")) return "2431.png";

    return "default.png";
};

// =========================================================================
// 🎾 TENİS GÜNCELLEME (ARINDIRILMIŞ SAF YAPI - MÜKEMMEL ÇÖZÜM)
// =========================================================================
async function updateTennis(targetDates = [getTRDate(0)], isQuickScan = false) {
    console.log(`🎾 Tenis: (Mod: ${isQuickScan ? '🚀 HIZLI (3dk)' : '🐢 DETAYLI'}) Tarihler: ${targetDates.join(', ')}`);
    
    let allMatches = [];
    let tenisMatchesLog = [];
    let rejectedLeagues = new Set();

    for (const [code, league] of Object.entries(ESPN_TENNIS_LEAGUES)) {
        const events = await fetchESPNMatches(league.slug);
        if (!events) continue;

        for (const event of events) {
            const tourName = event.name || `${league.displayName} Turnuvası`;
            const nameUpper = tourName.toUpperCase();
            
            const allowedTournaments = [
                "TOKYO", "BEIJING", "PEKİN", "SHANGHAI", "ŞANGHAY", 
                "WIMBLEDON", "US OPEN", "AUSTRALIAN OPEN", "ROLAND GARROS", 
                "FRENCH OPEN", "INDIAN WELLS", "MIAMI", "MONTE CARLO", 
                "MADRID", "ROME", "ROMA", "CINCINNATI", "CANADA", "MONTREAL", 
                "TORONTO", "PARIS", "PARİS", "BASEL", "VIENNA", "VİYANA", 
                "HAMBURG", "ACAPULCO", "DUBAI", "DUBAİ", "ROTTERDAM", 
                "BARCELONA", "BARSELONA", "QUEEN", "HALLE",
                "ATP FINALS", "WTA FINALS", "DAVIS CUP", "BILLIE JEAN", "NEXT GEN", "RIYADH"
            ];

            const isAllowed = allowedTournaments.some(item => nameUpper.includes(item));
            if (!isAllowed) {
                rejectedLeagues.add(tourName);
                continue; 
            }

            if (!event.groupings) continue;

            for (const grouping of event.groupings) {
                const competitions = grouping.competitions || [];

                for (const comp of competitions) {
                    const matchDateString = comp.date || event.date;
                    if (!matchDateString) continue;

                    const eventDate = new Date(matchDateString);
                    const fixedDate = eventDate.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
                    if (!targetDates.includes(fixedDate)) continue;

                    const homeC = comp.competitors?.find(c => c.homeAway === 'home');
                    const awayC = comp.competitors?.find(c => c.homeAway === 'away');
                    if (!homeC || !awayC) continue;

                    const getPlayerName = (c) => {
                        if (c.athlete?.displayName) return c.athlete.displayName;
                        if (c.roster?.displayName) return c.roster.displayName;
                        if (c.team?.displayName) return c.team.displayName;
                        if (c.roster?.athletes && Array.isArray(c.roster.athletes)) {
                            return c.roster.athletes.map(a => a.displayName || a.shortName).join(' / ');
                        }
                        if (c.athletes && Array.isArray(c.athletes)) {
                            return c.athletes.map(a => a.athlete?.displayName || a.athlete?.shortName).join(' / ');
                        }
                        return "Tenisçi";
                    };

                    const hName = getPlayerName(homeC);
                    const aName = getPlayerName(awayC);
                    if (hName === "TBD" || aName === "TBD") continue;

                    const getLogos = (c) => {
                        let flags = new Set();
                        
                        if (c.athlete?.flag?.href) flags.add(c.athlete.flag.href);
                        if (c.athlete?.country?.flag?.href) flags.add(c.athlete.country.flag.href);

                        if (c.roster?.athletes && Array.isArray(c.roster.athletes)) {
                            c.roster.athletes.forEach(a => {
                                if (a.flag?.href) flags.add(a.flag.href);
                                if (a.country?.flag?.href) flags.add(a.country.flag.href);
                            });
                        }

                        if (c.athletes && Array.isArray(c.athletes)) {
                            c.athletes.forEach(a => {
                                if (a.flag?.href) flags.add(a.flag.href);
                                if (a.athlete?.flag?.href) flags.add(a.athlete.flag.href);
                                if (a.athlete?.country?.flag?.href) flags.add(a.athlete.country.flag.href);
                            });
                        }

                        const flagArray = Array.from(flags);
                        return flagArray.length > 0 ? flagArray : [`${TENNIS_TOURNAMENT_BASE}default.png`];
                    };

                    const homeLogos = getLogos(homeC);
                    const awayLogos = getLogos(awayC);

                    const state = comp.status?.type?.state;
                    const statusType = mapESPNStatus(state);
                    const hasScore = statusType !== 'notstarted';

                    let fixedTime = eventDate.toLocaleTimeString('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
                    const startMs = eventDate.getTime();

                    if (statusType === 'inprogress') {
                        fixedTime = `${fixedTime}\nCANLI`;
                    }

                    // SADECE BURASI DEĞİŞTİ: Yayıncı bulunamazsa boş kalsın
                    const fallbackBroadcaster = "";
                    const result = getBroadcasterWithFallback("tenis", fixedDate, fixedTime, hName, aName, fallbackBroadcaster);
                    if (!isQuickScan) tenisMatchesLog.push({ home: hName, away: aName, kanal: result.kanal, source: result.source });

                    let setScoresArr = [];
                    let homeSetsWon = 0;
                    let awaySetsWon = 0;

                    const maxSets = Math.max(homeC.linescores?.length || 0, awayC.linescores?.length || 0);
                    for (let i = 0; i < maxSets; i++) {
                        const g1 = homeC.linescores?.[i]?.value ?? 0;
                        const g2 = awayC.linescores?.[i]?.value ?? 0;
                        setScoresArr.push(`${g1}-${g2}`);
                        
                        if ((g1 >= 6 && g1 - g2 >= 2) || g1 === 7 || (g1 === 1 && g2 === 0)) {
                            homeSetsWon++;
                        } else if ((g2 >= 6 && g2 - g1 >= 2) || g2 === 7 || (g2 === 1 && g1 === 0)) {
                            awaySetsWon++;
                        }
                    }

                    const statusDetail = (comp.status?.type?.detail || "").toLowerCase();
                    const statusDesc = (comp.status?.type?.description || "").toLowerCase();
                    
                    const isRetired = statusDetail.includes('ret') || statusDesc.includes('ret');
                    const isWalkover = statusDetail.includes('walkover') || statusDesc.includes('walkover') || statusDesc.includes('wo');

                    if (isRetired && setScoresArr.length > 0) {
                        setScoresArr[setScoresArr.length - 1] += " (Çek.)";
                    } else if (isWalkover && setScoresArr.length === 0) {
                        setScoresArr.push("(Hükmen)");
                    }

                    if (statusType === 'finished') {
                        if (homeC.winner === true && homeSetsWon <= awaySetsWon) {
                            homeSetsWon++;
                        } else if (awayC.winner === true && awaySetsWon <= homeSetsWon) {
                            awaySetsWon++;
                        }
                    }

                    const finalHomeScore = hasScore ? String(homeSetsWon) : "-";
                    const finalAwayScore = hasScore ? String(awaySetsWon) : "-";

                    const tournamentLogoUrl = `${TENNIS_TOURNAMENT_BASE}${getRepoLogoByTournamentName(tourName)}`;
                    const uniqueId = `espn_${comp.id || Math.random().toString(36).substring(7)}`;

                    globalTennisCache.set(uniqueId, {
                        id: uniqueId, 
                        isElite: true, 
                        status: statusType, 
                        fixedDate: fixedDate, 
                        fixedTime: fixedTime, 
                        timestamp: startMs,
                        broadcaster: result.kanal,
                        homeTeam: { name: hName, logos: homeLogos },
                        awayTeam: { name: aName, logos: awayLogos },
                        tournamentLogo: tournamentLogoUrl,
                        homeScore: finalHomeScore, 
                        awayScore: finalAwayScore, 
                        setScores: setScoresArr, 
                        tournament: tourName
                    });

                    previousMatchStates.set(uniqueId, { status: statusType, date: fixedDate });
                    allMatches.push(uniqueId);
                }
            }
        }
    }

    if (!isQuickScan && rejectedLeagues.size > 0) {
        console.log(`\n🗑️ [FİLTRE] Elenen Turnuvalar: ${Array.from(rejectedLeagues).join(', ')}`);
    }
    console.log(`📊 Toplam çekilen tenis maçı (ESPN): ${allMatches.length}`);

    if (allMatches.length === 0) {
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

    const finalMatches = Array.from(globalTennisCache.values()).sort((a, b) => a.timestamp - b.timestamp);
    await uploadToFirebase({ success: true, matches: finalMatches });
    
    if (!isQuickScan && tenisMatchesLog.length < 30) logMatchesBySport({ tenis: tenisMatchesLog });
    saveState();
    
    const hasLiveMatch = finalMatches.some(m => m.status === 'inprogress');
    const nextMatchTimestamp = findNextMatchTime(globalTennisCache);
    return { hasLiveMatch, nextMatchTimestamp, hasAnyMatches: finalMatches.length > 0 };
}

// =========================================================================
// 🆕 ANA DÖNGÜ (TENİS)
// =========================================================================
async function main() {
    loadState();
    console.log("============================================================");
    console.log("🟢 [TENİS] MAÇKOLİK'TEN ARINDIRILMIŞ (SAF ESPN) SERVİS BAŞLADI");
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
