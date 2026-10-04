const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const apn = require('apn');
const xml2js = require('xml2js');

require('events').EventEmitter.defaultMaxListeners = 100;

// =========================================================================
// 🔥 AYARLAR VE ÇALIŞMA ORTAMI
// =========================================================================
const IS_PRODUCTION = true; 
const STATE_FILE = 'futbol_states.json';
const GITHUB_USER = "elfcrzgr";
const REPO_NAME = "macsaati-backend";
const MINUTE_MS = 60000;

// 🚨 TELEGRAM AYARLARI 
const TELEGRAM_BOT_TOKEN = "8401956459:AAEFkkO8Z0mj3BV73m8FQiYTz2oLeqGrCTY";
const TELEGRAM_CHAT_ID = "1168053894";

// =========================================================================
// 🔥 FIREBASE & APNs BAŞLATMA
// =========================================================================
const serviceAccount = JSON.parse(fs.readFileSync('./serviceAccountKey.json', 'utf8'));
const firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app/"
}, 'football_app');
console.log("🔥 [FUTBOL] Firebase Admin başlatıldı.");

const apnProvider = new apn.Provider({
    token: {
        key: __dirname + "/AuthKey_9JFB2X7TY9.p8",
        keyId: "9JFB2X7TY9",
        teamId: "9MQ7UDX75J"
    },
    production: IS_PRODUCTION
});
console.log(`🍏 [FUTBOL] Apple APNs hazır. (Mod: ${IS_PRODUCTION ? "CANLI" : "GELİŞTİRİCİ"})`);

// =========================================================================
// 🧠 GLOBAL HAFIZA (CACHE) VE DURUM YÖNETİMİ
// =========================================================================
const previousMatchStates = new Map();
const globalFootballCache = new Map();

const sportUpdateStatus = {
    nextMatchTime: null, 
    hasLiveMatch: false
};

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
            console.log(`📂 [HAFIZA-FUTBOL] ${previousMatchStates.size} maç durumu dosyadan yüklendi.`);
        } catch (e) {
            console.error("❌ Hafıza dosyası okunamadı, yeni başlatılıyor.");
        }
    }
}

// =========================================================================
// 🌉 HARİCİ YAYINCI DOSYASI (SPOREKRANI) ENTEGRASYONU
// =========================================================================
let externalBroadcasters = {};

async function loadExternalBroadcasters() {
    try {
        const url = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/yayinci_bilgisi.json?t=${Date.now()}`;
        const response = await fetch(url);
        
        if (response.ok) {
            externalBroadcasters = await response.json();
            fs.writeFileSync('yayinci_bilgisi.json', JSON.stringify(externalBroadcasters, null, 2));
        } else {
            throw new Error(`HTTP ${response.status}`);
        }
    } catch (e) {
        if (fs.existsSync('yayinci_bilgisi.json')) {
            externalBroadcasters = JSON.parse(fs.readFileSync('yayinci_bilgisi.json', 'utf8'));
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
        return [-1, 0, 1].map(offset => {
            const dateObj = new Date(y, m - 1, d + offset);
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            return `${dateObj.getFullYear()}-${month}-${day}`;
        });
    };

    for (const dateKey of getSafeDates(dateStr)) {
        const dayData = externalBroadcasters[dateKey];
        if (!dayData || !dayData.matches) continue;

        for (const m of dayData.matches) {
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

                if (matchScore === 2 && diff <= 300) {
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
// 🛠️ YARDIMCI FONKSİYONLAR & FOTMOB API
// =========================================================================
let lastBanAlertTime = 0;

async function notifyAdminForBan(statusCode) {
    const now = Date.now();
    if (now - lastBanAlertTime < 1800000) return;

    const message = `🚨 Maç Saati Sunucu Uyarısı\nFotMob API hata döndürdü (HTTP ${statusCode}).`;
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage?chat_id=${TELEGRAM_CHAT_ID}&text=${encodeURIComponent(message)}`;

    try {
        const response = await fetch(url);
        if (response.ok) lastBanAlertTime = now;
    } catch (e) {}
}

async function uploadToFirebase(data) {
    try {
        const db = firebaseApp.database();
        const ref = db.ref(`matches_football`);
        await ref.set(data);
    } catch (error) {
        console.error(`❌ [FIREBASE-FUTBOL] Hata:`, error.message);
    }
}

// 🔥 FOTMOB XML VERİ ÇEKME MOTORU
async function fetchFotMobMatches(dateStr) {
    try {
        const delay = Math.floor(Math.random() * 500) + 200;
        await new Promise(r => setTimeout(r, delay));

        const formattedDate = dateStr.replace(/-/g, '');
        const url = `https://api3.fotmob.com/matches?date=${formattedDate}&tz=10800000&tzone=Europe%2FIstanbul`;

        const response = await fetch(url, {
            headers: {
                "Host": "api3.fotmob.com",
                "fotmob-version": "1243.0",
                "Accept": "application/xml, text/xml, */*",
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FotMob",
                "Accept-Language": "tr-TR,tr;q=0.9",
                "Connection": "keep-alive"
            }
        });

        if (!response.ok) {
            if (response.status === 404) return [];
            console.log(`⚠️ FotMob API Reddi (HTTP ${response.status})`);
            if (response.status === 403 || response.status === 429) {
                notifyAdminForBan(response.status);
            }
            return [];
        }

        const xmlText = await response.text();
        
        return new Promise((resolve) => {
            xml2js.parseString(xmlText, { explicitArray: false }, (err, result) => {
                if (err || !result || !result.live || !result.live.exmatches) {
                    resolve([]);
                    return;
                }

                let leagues = result.live.exmatches.league;
                if (!leagues) {
                    resolve([]);
                    return;
                }
                if (!Array.isArray(leagues)) leagues = [leagues];

                let parsedEvents = [];

                leagues.forEach(league => {
                    let matches = league.match;
                    if (!matches) return;
                    if (!Array.isArray(matches)) matches = [matches];

                    matches.forEach(m => {
                        const attr = m.$ || {};
                        parsedEvents.push({
                            id: attr.id,
                            tournament: league.$.name || "Futbol",
                            tournamentId: league.$.id,
                            homeTeam: { name: attr.hTeam, id: attr.hId, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${attr.hId}.png` },
                            awayTeam: { name: attr.aTeam, id: attr.aId, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${attr.aId}.png` },
                            homeScore: { display: attr.hScore ?? "0" },
                            awayScore: { display: attr.aScore ?? "0" },
                            status: { 
                                type: attr.Status === 'F' ? 'finished' : (attr.Status === 'C' ? 'canceled' : (attr.hScore !== undefined && attr.hScore !== "" ? 'inprogress' : 'notstarted')),
                                description: attr.Status === 'F' ? 'Full Time' : (attr.time || 'Not Started')
                            },
                            liveMinute: attr.time || "",
                            fixedDate: dateStr,
                            startTimestamp: Math.floor(new Date(`${dateStr}T${attr.time || '00:00'}:00`).getTime() / 1000)
                        });
                    });
                });

                resolve(parsedEvents);
            });
        });

    } catch (e) {
        console.error("FotMob Fetch Hatası:", e.message);
        return [];
    }
}

const getTRDate = (offset = 0) => {
    const now = new Date();
    const istStr = now.toLocaleString('en-US', { timeZone: 'Europe/Istanbul' });
    const ist = new Date(istStr);
    ist.setDate(ist.getDate() + offset);
    const y = ist.getFullYear();
    const m = String(ist.getMonth() + 1).padStart(2, '0');
    const d = String(ist.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
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
// ⚽ FUTBOL GÜNCELLEME DÖNGÜSÜ
// =========================================================================
async function updateFootball(targetDates = [getTRDate(0)], isQuickScan = false) {
    console.log(`⚽ Futbol (FotMob): (Mod: ${isQuickScan ? '🚀 HIZLI' : '🐢 DETAYLI'})`);

    let allEvents = [];
    for (const date of targetDates) {
        const events = await fetchFotMobMatches(date);
        if (events.length > 0) {
            allEvents.push(...events);
        }
    }

    if (allEvents.length === 0) {
        const stillLive = Array.from(globalFootballCache.values()).some(m => m.status === 'inprogress');
        return {
            hasLiveMatch: stillLive || sportUpdateStatus.hasLiveMatch,
            nextMatchTimestamp: sportUpdateStatus.nextMatchTime,
            hasAnyMatches: globalFootballCache.size > 0
        };
    }

    allEvents.forEach(e => {
        const hName = e.homeTeam.name || ""; 
        const aName = e.awayTeam.name || "";

        const finalBroadcaster = getBroadcasterWithFallback("futbol", e.fixedDate, "20:00", hName, aName, "Resmi Yayıncı / Canlı Skor").kanal;

        globalFootballCache.set(e.id, {
            id: e.id, 
            isElite: true, 
            status: e.status.type, 
            statusCode: 0, 
            liveMinute: e.liveMinute,
            fixedDate: e.fixedDate, 
            fixedTime: "20:00", 
            timestamp: e.startTimestamp * 1000, 
            broadcaster: finalBroadcaster,
            homeTeam: { name: hName, logo: e.homeTeam.logo, id: e.homeTeam.id }, 
            awayTeam: { name: aName, logo: e.awayTeam.logo, id: e.awayTeam.id },
            tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/default.png`, 
            homeScore: String(e.homeScore.display), 
            awayScore: String(e.awayScore.display),
            setScores: [], 
            tournament: e.tournament, 
            timeObj: {}
        });
    });

    const matches = Array.from(globalFootballCache.values()).sort((a, b) => a.timestamp - b.timestamp);
    await uploadToFirebase({ success: true, lastUpdate: new Date().toLocaleTimeString('tr-TR'), matches });

    const hasLiveMatch = matches.some(m => m.status === 'inprogress');
    const nextMatchTimestamp = findNextMatchTime(globalFootballCache);

    return { hasLiveMatch, nextMatchTimestamp, hasAnyMatches: matches.length > 0 };
}

// =========================================================================
// 🆕 ANA DÖNGÜ
// =========================================================================
async function main() {
    loadState();
    console.log("============================================================");
    console.log("🟢 [FUTBOL - FOTMOB] BAĞIMSIZ SERVİS BAŞLADI");
    console.log("============================================================");

    while (true) {
        try {
            await loadExternalBroadcasters();

            const days2 = [getTRDate(0), getTRDate(1)];
            const result = await updateFootball(days2, false);
            
            sportUpdateStatus.nextMatchTime = result.nextMatchTimestamp; 
            sportUpdateStatus.hasLiveMatch = result.hasLiveMatch;

            console.log("\n💤 [FUTBOL] Döngü tamamlandı. 5 dakika sonra tekrar taranacak...");
            await new Promise(r => setTimeout(r, 5 * MINUTE_MS));
            
        } catch (e) { 
            console.error("🚨 Hata:", e.message); 
            await new Promise(r => setTimeout(r, MINUTE_MS)); 
        }
    }
}
main();
