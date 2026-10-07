const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

require('events').EventEmitter.defaultMaxListeners = 100;

// =========================================================================
// 🔥 AYARLAR VE ÇALIŞMA ORTAMI
// =========================================================================
const STATE_FILE = 'basketball_states.json'; 
const GITHUB_USER = "elfcrzgr";
const REPO_NAME = "macsaati-backend";
const MINUTE_MS = 180000;
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

function logMatchesBySport(matchGroups) {
    for (const sportType of Object.keys(matchGroups)) {
        const sporekraniMatches = matchGroups[sportType].filter(matchInfo => matchInfo.source === "sporekrani");
        if (sporekraniMatches.length === 0) continue;
        console.log(`\n--------- 🏀 BASKETBOL SPOREKRANI ---------`);
        for (const matchInfo of sporekraniMatches) {
            const { home, away, kanal } = matchInfo;
            console.log(`🏀 ${home} vs ${away} | Kanal: ${kanal}`);
        }
        console.log('---------------------------------------------');
    }
}


// =========================================================================
// 🏆 LİG İSİMLERİNİ GITHUB REPO ID'LERİNE BAĞLAYAN SÖZLÜK
// =========================================================================
function getTournamentRepoId(compName) {
    if (!compName) return "519"; // Varsayılan bir lig ID'si
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

    return "519"; // Bulunamazsa varsayılan lig logosu
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

                if (matchScore === 2 && diff <= 120) return { kanal: m.yayin, source: "sporekrani" };
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


//TOKEN

async function getMackolikToken() {
    try {
        // Belirlediğiniz token_basketball.txt dosyasından okuyacak
        const url = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/token_basketball.txt?t=${Date.now()}`;
        const response = await fetch(url);
        if (response.ok) {
            const token = await response.text();
            return token.trim(); 
        }
    } catch (e) {
        console.log("⚠️ GitHub'dan token çekilemedi.");
    }
    return null;
}




// 🔥 YENİ MAÇKOLİK FETCH MOTORU
async function fetchMackolikBasketball(dateStr) {
    try {
        const currentToken = await getMackolikToken(); // GitHub'dan token'ı al

        const url = `https://api.mackolikfeeds.com/basket/api/matches/?add_playing=1&application=com.domainname.mackolik&country=tr&date=${dateStr}&extended_period=1&language=tr&migration_status=perform&tz=3`;
        const response = await fetch(url, {
            signal: timeoutSignal(15000),
            headers: {
                "User-Agent": "Mackolik/5.8.7 (iPhone; iOS 27.0.1; Scale/3.00)",
                "X-Authorization": "token true",
                "X-RequestToken": currentToken, // DİNAMİK TOKEN BURADAN GELECEK
                "Accept-Language": "tr-TR;q=1, en-GB;q=0.9",
                "Connection": "keep-alive"
            }
        });

        if (!response.ok) {
            console.error(`❌ Mackolik ${response.status} döndü (Token süresi dolmuş veya yanlış ACL olabilir)`);
            return null;
        }
        return await response.json();
    } catch (e) { return null; }
}

// Mackolik lig isimlerine göre varsayılan yayıncılar
const getFallbackBroadcaster = (compName) => {
    const upper = String(compName).toUpperCase();
    if (upper.includes("NBA")) return "S Sport / NBA TV";
    if (upper.includes("EUROLEAGUE")) return "S Sport / S Sport Plus";
    if (upper.includes("EUROCUP")) return "TRT Spor / S Sport";
    if (upper.includes("TÜRKİYE SİGORTA BSL")) return "beIN Sports";
    if (upper.includes("BASKETBOL ŞAMPİYONLAR LİGİ")) return "Tivibu Spor";
    if (upper.includes("İSPANYA")) return "S Sport Plus";
    if (upper.includes("İTALYA")) return "S Sport Plus";
    return "Resmi Yayıncı";
};

// =========================================================================
// 🏀 BASKETBOL GÜNCELLEME (GÜNCELLENMİŞ MAÇKOLİK PARSER)
// =========================================================================
// =========================================================================
// 🏀 ELİT LİG FİLTRELEME VE SEÇİM KURALLARI
// =========================================================================
function isEliteCompetition(compName) {
    if (!compName) return false;
    const name = String(compName).toLowerCase();

    // ❌ Kadınlar liglerini ele (Sadece WNBA hariç)
    if ((name.includes('kadın') || name.includes('women') || name.includes('kbsl')) && !name.includes('wnba')) {
        return false;
    }

    // ✅ İzin verilen ana ve elit lig anahtar kelimeleri
    const allowedKeywords = [
        'nba', 'wnba',
        'euroleague', 'eurocup',
        'şampiyonlar ligi', 'champions league',
        'türkiye sigorta bsl', 'türkiye basketbol ligi', 'tbl', 'basketbol süper ligi',
        'acb', 'lig a', 'basket league', 'bbl', 'pro a', 'aba league', 'vtb',
        'italya', 'ispanya', 'yunanistan', 'almanya', 'fransa'
    ];

    return allowedKeywords.some(keyword => name.includes(keyword));
}

// =========================================================================
// 🏀 BASKETBOL GÜNCELLEME (FİLTRELENMİŞ & LOGOSU DÜZELTİLMİŞ)
// =========================================================================
async function updateBasketball(targetDates = [getTRDate(0)], isQuickScan = false) {
    console.log(`🏀 Basketbol: (Mod: ${isQuickScan ? '🚀 HIZLI' : '🐢 DETAYLI'}) Tarihler: ${targetDates.join(', ')}`);
    
    let allMatches = [];
    let basketbolMatchesLog = [];
    let anySuccess = false;

    for (const date of targetDates) {
        const responseData = await fetchMackolikBasketball(date);
        const rootData = responseData?.data;
        const areasArray = Array.isArray(rootData) ? rootData : rootData?.areas;

        if (rootData && areasArray && Array.isArray(areasArray)) {
            anySuccess = true;
            areasArray.forEach(area => {
                if (area.competitions && Array.isArray(area.competitions)) {
                    area.competitions.forEach(comp => {
                        if (isEliteCompetition(comp.name)) {
                            if (comp.matches && Array.isArray(comp.matches)) {
                                comp.matches.forEach(match => {
                                    match.competitionName = comp.name; 
                                    match.competitionId = comp.uuid;
                                    match.fixedDate = date;
                                    allMatches.push(match);
                                });
                            }
                        }
                    });
                }
            });
        }
    }

    if (!anySuccess) {
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

    for (const e of allMatches) {
        const rawStatus = String(e.status || "").toLowerCase();
        let statusType = 'notstarted';
        if (rawStatus === 'played' || rawStatus === 'finished') statusType = 'finished';
        else if (rawStatus === 'playing' || rawStatus === 'live' || rawStatus === 'fixture') {
            statusType = (rawStatus === 'fixture') ? 'notstarted' : 'inprogress';
        }

        const isFinished = statusType === 'finished'; 
        const isInProgress = statusType === 'inprogress';
        const hasScore = isFinished || isInProgress;

        // YENİ SKOR OKUMA MANTIĞI (Hata ayıklama logları silindi, fts_A ve fts_B eklendi)
        const homeScoreRaw = e.fts_A ?? e.fs_A ?? e.rs_A ?? e.score_A ?? (e.team_A && e.team_A.score) ?? "0";
        const awayScoreRaw = e.fts_B ?? e.fs_B ?? e.rs_B ?? e.score_B ?? (e.team_B && e.team_B.score) ?? "0";

        const dateTR = new Date(e.date_time_utc + "Z"); 
        let timeString = `${String(dateTR.getHours()).padStart(2, '0')}:${String(dateTR.getMinutes()).padStart(2, '0')}`;
        if (isInProgress) {
            const minStr = e.minute ? `${e.minute}'` : "CANLI";
            timeString = `${timeString}\n${minStr}`;
        }

        const hName = e.team_A?.display_name || e.team_A?.name || "Ev Sahibi";
        const aName = e.team_B?.display_name || e.team_B?.name || "Deplasman";
        const fallbackBroadcaster = getFallbackBroadcaster(e.competitionName);
        const result = getBroadcasterWithFallback("basketbol", e.fixedDate, timeString, hName, aName, fallbackBroadcaster);

        if (!isQuickScan) basketbolMatchesLog.push({ home: hName, away: aName, kanal: result.kanal, source: result.source });

        globalBasketballCache.set(e.uuid, {
            id: e.uuid, 
            isElite: true, 
            status: statusType, 
            fixedDate: e.fixedDate, 
            fixedTime: timeString, 
            timestamp: dateTR.getTime(), 
            broadcaster: result.kanal,
            homeTeam: { name: hName, logo: `https://api.mackolikfeeds.com/basket/images/teams/150x150/${e.team_A?.uuid}.png` },
            awayTeam: { name: aName, logo: `https://api.mackolikfeeds.com/basket/images/teams/150x150/${e.team_B?.uuid}.png` },
            tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/tournament_logos/${getTournamentRepoId(e.competitionName)}.png`,
            homeScore: hasScore ? String(homeScoreRaw) : "-", 
            awayScore: hasScore ? String(awayScoreRaw) : "-", 
            tournament: e.competitionName || "Basketbol Ligi"
        });

        previousMatchStates.set(e.uuid, { status: statusType, date: e.fixedDate });
    }

    const finalMatches = Array.from(globalBasketballCache.values()).sort((a, b) => a.timestamp - b.timestamp);
    await uploadToFirebase({ success: true, matches: finalMatches });
    
    if (!isQuickScan && basketbolMatchesLog.length < 30) logMatchesBySport({ basketbol: basketbolMatchesLog });
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
    console.log("🟢 [BASKETBOL] BAĞIMSIZ MAÇKOLİK SERVİSİ BAŞLADI");
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
