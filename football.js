const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const apn = require('apn');

require('events').EventEmitter.defaultMaxListeners = 100;

// =========================================================================
// 🔥 AYARLAR VE ÇALIŞMA ORTAMI
// =========================================================================
const IS_PRODUCTION = true; 
const STATE_FILE = 'futbol_states.json';
const GITHUB_USER = "elfcrzgr";
const REPO_NAME = "macsaati-backend";
const MINUTE_MS = 60000;

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
const pendingGoalCancel = new Map();
const globalFootballCache = new Map();
const triggeredMatches = new Set();

const sportUpdateStatus = {
    lastFullUpdate: 0, 
    lastQuickUpdate: 0, 
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
// 🛠️ MAÇKOLİK VERİ ÇEKME MOTORU
// =========================================================================
async function fetchData(url) {
    try {
        const delay = Math.floor(Math.random() * 800) + 300;
        await new Promise(r => setTimeout(r, delay));

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 7000);

        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15",
                "Accept": "application/json",
                "Referer": "https://www.mackolik.com/"
            }
        });
        
        clearTimeout(timeoutId);

        if (!response.ok) {
            if (response.status === 404 || response.status === 204) return { is404: true }; 
            return null;
        }

        const data = await response.json();
        if (!data || Object.keys(data).length === 0) return { is404: true };
        
        return data;
    } catch (e) {
        return null;
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
// 🔔 BİLDİRİM VE APNs YÖNETİMİ
// =========================================================================
const lastNotificationTime = new Map();

async function sendPush(id, title, body, imageUrl = null, matchData = null) {
    const now = Date.now();
    const lastTime = lastNotificationTime.get(id) || 0;
    if (now - lastTime < 15000) return;

    try {
        const payload = {
            topic: `match_${id}`,
            notification: { title: title, body: body },
            data: { matchId: String(id), type: "match_update", title: String(title), body: String(body), imageUrl: imageUrl || "" },
            apns: { headers: { "apns-push-type": "alert", "apns-priority": "10" }, payload: { aps: { alert: { title: title, body: body }, "mutable-content": 1, sound: "default", category: "MATCH_UPDATE" }, matchId: String(id), type: "match_update" } }
        };

        if (matchData) {
            const hName = String(matchData.homeTeam?.name || "Ev Sahibi");
            const aName = String(matchData.awayTeam?.name || "Deplasman");

            payload.data.homeName = hName; payload.data.awayName = aName;
            payload.data.homeScore = String(matchData.homeScore || "-"); payload.data.awayScore = String(matchData.awayScore || "-");
            payload.data.homeLogo = String(matchData.homeTeam?.logo || ""); payload.data.awayLogo = String(matchData.awayTeam?.logo || "");
            payload.data.status = String(matchData.status || "inprogress"); payload.data.timeOrMinute = String(matchData.liveMinute || "");

            payload.apns.payload.homeName = hName; payload.apns.payload.awayName = aName;
            payload.apns.payload.homeLogo = String(matchData.homeTeam?.logo || ''); payload.apns.payload.awayLogo = String(matchData.awayTeam?.logo || '');
            payload.apns.payload.homeTeamId = String(matchData.homeTeam?.id || '0'); payload.apns.payload.awayTeamId = String(matchData.awayTeam?.id || '0');
        }

        await firebaseApp.messaging().send(payload);
        lastNotificationTime.set(id, now);
        console.log(`✅ [BİLDİRİM] ${title}: ${body}`);
    } catch (e) {
        console.error("❌ Bildirim Hatası:", e.message);
    }
}

async function checkAndSendNotifications(newMatches) {
    for (const match of newMatches) {
        const matchIdStr = String(match.id);
        const prev = previousMatchStates.get(matchIdStr) || { status: null, homeScore: 0, awayScore: 0, hasNotifiedStart: false, hasNotifiedFinished: false };

        let currH = parseInt(match.homeScore) || 0;
        let currA = parseInt(match.awayScore) || 0;
        const appTitle = "Maç Saati";

        if (match.status === 'inprogress' && !prev.hasNotifiedStart) {
            await sendPush(matchIdStr, appTitle, `⚽ Maç Başladı!\n${match.homeTeam.name} - ${match.awayTeam.name}`, null, match);
            prev.hasNotifiedStart = true;
        } else if (['finished', 'ended', 'closed'].includes(match.status) && !prev.hasNotifiedFinished) {
            if (prev.status === 'inprogress') {
                await sendPush(matchIdStr, appTitle, `🏁 Maç Bitti\n${match.homeTeam.name} ${match.homeScore} - ${match.awayScore} ${match.awayTeam.name}`, null, match);
            }
            prev.hasNotifiedFinished = true;
        }

        if (match.status === 'inprogress' && prev.status !== null) {
            if (prev.homeScore !== currH || prev.awayScore !== currA) {
                const homeScored = currH > prev.homeScore;
                const scorerTeam = homeScored ? match.homeTeam.name : match.awayTeam.name;
                const scoringTeamLogo = homeScored ? match.homeTeam.logo : match.awayTeam.logo;
                await sendPush(matchIdStr, appTitle, `⚽ Gol - ${scorerTeam} (${match.liveMinute})\n${match.homeTeam.name} ${match.homeScore} - ${match.awayScore} ${match.awayTeam.name}`, scoringTeamLogo, match);
            }
        }

        previousMatchStates.set(matchIdStr, {
            status: match.status, homeScore: currH, awayScore: currA, hasNotifiedStart: prev.hasNotifiedStart, hasNotifiedFinished: prev.hasNotifiedFinished,
            date: match.fixedDate
        });
    }
    saveState();
}

// =========================================================================
// ⚽ MAÇKOLİK ANA GÜNCELLEME DÖNGÜSÜ
// =========================================================================
async function updateFootball(targetDates = [getTRDate(0)], isQuickScan = false) {
    console.log(`⚽ Maçkolik Tarama: (Mod: ${isQuickScan ? '🚀 HIZLI' : '🐢 DETAYLI'})`);

    const validDates = [getTRDate(-2), getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)];
    
    for (const [id, state] of previousMatchStates.entries()) {
        if (state.date && !validDates.includes(state.date) && state.status !== 'inprogress') previousMatchStates.delete(id);
    }
    for (const [id, match] of globalFootballCache.entries()) {
        if (!validDates.includes(match.fixedDate)) globalFootballCache.delete(id);
    }

    for (const date of targetDates) {
        // Maçkolik günlük maç listesi uç noktası
        const url = `https://atif.mackolik.com/api/live/scores?date=${date}`;
        const data = await fetchData(url);
        
        if (data && data.matches) {
            data.matches.forEach(m => {
                let parsedStatus = 'notstarted';
                let homeSc = String(m.homeScore ?? "-");
                let awaySc = String(m.awayScore ?? "-");
                let liveMin = m.minute || "";

                if (m.isFinished) {
                    parsedStatus = 'finished';
                } else if (m.isLive) {
                    parsedStatus = 'inprogress';
                }

                const matchTimestamp = new Date(`${date}T${m.time || "00:00"}:00+03:00`).getTime();

                globalFootballCache.set(m.id, {
                    id: m.id, isElite: true, status: parsedStatus, statusCode: 0, liveMinute: liveMin,
                    fixedDate: date, fixedTime: m.time || "00:00", timestamp: matchTimestamp, broadcaster: m.broadcaster || "Maçkolik",
                    homeTeam: { name: m.homeTeam, logo: m.homeLogo || "", id: m.homeId }, 
                    awayTeam: { name: m.awayTeam, logo: m.awayLogo || "", id: m.awayId },
                    tournamentLogo: "", 
                    homeScore: homeSc, awayScore: awaySc,
                    setScores: [], tournament: m.tournament || "Futbol", timeObj: {}
                });
            });
        }
    }

    const matches = Array.from(globalFootballCache.values()).sort((a, b) => a.timestamp - b.timestamp);
    await checkAndSendNotifications(matches);
    await uploadToFirebase({ success: true, lastUpdate: new Date().toLocaleTimeString('tr-TR'), matches });

    const hasLiveMatch = matches.some(m => m.status === 'inprogress');
    const nextMatchTimestamp = findNextMatchTime(globalFootballCache);

    if(!isQuickScan && matches.length > 0) {
        console.log(`✅ ${matches.length} maç Maçkolik üzerinden başarıyla Firebase'e yazıldı!`);
    }

    return { hasLiveMatch, nextMatchTimestamp, hasAnyMatches: matches.length > 0 };
}

async function uploadToFirebase(data) {
    try {
        const db = firebaseApp.database();
        const ref = db.ref(`matches_football`);
        await ref.set(data);
    } catch (error) {
        console.error(`❌ [FIREBASE] Hata:`, error.message);
    }
}

// =========================================================================
// 🆕 ANA DÖNGÜ 
// =========================================================================
async function main() {
    loadState();
    console.log("============================================================");
    console.log("🟢 [MAÇKOLİK] FUTBOL SERVİSİ BAŞLADI");
    console.log("============================================================");

    let lastPeriodicUpdate = 0;

    while (true) {
        try {
            const now = Date.now();
            const ist = getIstanbulNow();
            const msSinceMidnight = (ist.getHours() * 3600000) + (ist.getMinutes() * 60000) + (ist.getSeconds() * 1000);
            const startOfDay = now - msSinceMidnight;

            const TARGET_TIMES = [ 10 * 60 * 60 * 1000, 15 * 60 * 60 * 1000 ];
            let activeTarget = startOfDay - 24 * 60 * 60 * 1000;
            for (let i = TARGET_TIMES.length - 1; i >= 0; i--) {
                if (msSinceMidnight >= TARGET_TIMES[i]) { activeTarget = startOfDay + TARGET_TIMES[i]; break; }
            }

            if (lastPeriodicUpdate < activeTarget) {
                console.log("\n🔄 [PERİYODİK] Detaylı Maçkolik Taraması Başlıyor...");
                const days4 = [getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)];
                const result = await updateFootball(days4, false);
                sportUpdateStatus.nextMatchTime = result.nextMatchTimestamp; 
                sportUpdateStatus.hasLiveMatch = result.hasLiveMatch;
                lastPeriodicUpdate = now;
            }

            let quickScanDates = [getTRDate(0)];
            if (ist.getHours() >= 0 && ist.getHours() <= 4) quickScanDates = [getTRDate(-1), getTRDate(0)];

            if (sportUpdateStatus.hasLiveMatch || (sportUpdateStatus.nextMatchTime && now >= (sportUpdateStatus.nextMatchTime - MINUTE_MS * 1.1))) {
                if (now - sportUpdateStatus.lastQuickUpdate >= MINUTE_MS) {
                    console.log(`\n⚽ [HIZLI DÖNGÜ] Maç vakti!`);
                    const result = await updateFootball(quickScanDates, true);  
                    sportUpdateStatus.lastQuickUpdate = now; sportUpdateStatus.hasLiveMatch = result.hasLiveMatch; sportUpdateStatus.nextMatchTime = result.nextMatchTimestamp;
                }
            }

            const processDuration = Date.now() - now; 
            let sleepTime = 10 * MINUTE_MS;
            const isActive = sportUpdateStatus.hasLiveMatch || (sportUpdateStatus.nextMatchTime && now >= (sportUpdateStatus.nextMatchTime - MINUTE_MS * 12));
            
            if (isActive) {
                sleepTime = Math.max(15000, 60000 - processDuration);
                console.log(`⚡ Bekleniyor... (${Math.round(sleepTime/1000)} sn)`);
            } else {
                console.log("💤 Hareket yok, 10 dk uyku...");
            }

            await new Promise(r => setTimeout(r, sleepTime));
            
        } catch (e) { 
            console.error("🚨 Hata:", e.message); 
            await new Promise(r => setTimeout(r, MINUTE_MS)); 
        }
    }
}
main();
