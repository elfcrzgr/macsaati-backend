const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const admin = require('firebase-admin');
const apn = require('apn');
const axios = require('axios');

const triggeredMatches = new Set();

// =========================================================================
// 🔥 AYARLAR VE ÇALIŞMA ORTAMI
// =========================================================================
const IS_PRODUCTION = false; 

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

// =========================================================================
// ⚙️ AYARLAR VE YAYINCI BİLGİSİ
// =========================================================================
const GITHUB_USER = "elfcrzgr";
const REPO_NAME = "macsaati-backend";
const MINUTE_MS = 60000;
const TEN_MIN_MS = 10 * 60000;

function logMatchesBySport(matchGroups) {
    for (const sportType of Object.keys(matchGroups)) {
        const sporekraniMatches = matchGroups[sportType].filter(
            matchInfo => matchInfo.source === "sporekrani"
        );
        if (sporekraniMatches.length === 0) continue;
        let icon = "🏟️";
        if (sportType === "futbol" || sportType === "football") icon = "⚽";
        if (sportType === "basketbol" || sportType === "basketball") icon = "🏀";
        if (sportType === "tenis" || sportType === "tennis") icon = "🎾";
        console.log(`\n--------- ${icon} ${sportType.toUpperCase()} SPOREKRANI ---------`);
        for (const matchInfo of sporekraniMatches) {
            const { home, away, kanal } = matchInfo;
            console.log(`${icon} ${home} vs ${away} | Kanal: ${kanal} [SPOREKRANI]`);
        }
    }
}

let externalBroadcasters = {};
function loadExternalBroadcasters() {
    try {
        if (fs.existsSync('yayinci_bilgisi.json')) {
            externalBroadcasters = JSON.parse(fs.readFileSync('yayinci_bilgisi.json', 'utf8'));
        } else {
            externalBroadcasters = {};
        }
    } catch (e) {
        externalBroadcasters = {};
    }
}

function getBroadcasterWithFallback(sportCategory, dateStr, timeStr, homeName, awayName, fallback) {
    const cleanTime = (timeStr || "").replace(/\n?CANLI/, "").replace(/\n?MS/, "").replace('.', ':').trim();
    const [cH, cM] = cleanTime.split(':').map(Number);
    const toTR = (str) => str.replace(/İ/g, 'i').replace(/I/g, 'i').replace(/ı/g, 'i').toLowerCase().trim();
    const hName = toTR(homeName || "");
    const aName = toTR(awayName || "");

    const getSafeDates = (baseStr) => {
        const [y, m, d] = baseStr.split('-').map(Number);
        return [0, 1].map(offset => {
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
            if (m.spor && toTR(m.spor) === toTR(sportCategory)) {
                const mTime = (m.saat || "").replace('.', ':').trim();
                const [mH, mM] = mTime.split(':').map(Number);
                const mTitle = toTR(m.mac || "");

                const getCleanWords = (str) => str.replace(/İ/g, 'i').replace(/I/g, 'i').replace(/Ğ/g, 'g').replace(/ğ/g, 'g').replace(/Ü/g, 'u').replace(/ü/g, 'u').replace(/Ş/g, 's').replace(/ş/g, 's').replace(/Ö/g, 'o').replace(/ö/g, 'o').replace(/Ç/g, 'c').replace(/ç/g, 'c').replace(/ı/g, 'i').toLowerCase().replace(/[^a-z0-9]/g, ' ').split(' ').map(w => w.trim()).filter(w => w.length >= 3);

                const matchHome = getCleanWords(hName).length === 0 || getCleanWords(hName).some(w => mTitle.includes(w));
                const matchAway = getCleanWords(aName).length === 0 || getCleanWords(aName).some(w => mTitle.includes(w));
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
// 🛠️ YARDIMCI FONKSİYONLAR VE API BAĞLANTISI
// =========================================================================
async function uploadToFirebase(sportName, data) {
    try {
        await admin.database().ref(`matches_${sportName}`).set(data);
        console.log(`✅ [FIREBASE] ${sportName.toUpperCase()} başarıyla güncellendi!`);
    } catch (error) {
        console.error(`❌ [FIREBASE] ${sportName} Hata:`, error.message);
    }
}

// 🔥 API-SPORTS ORTAK FETCH FONKSİYONU
async function fetchApiSports(url) {
    try {
        const API_SPORTS_KEY = '870e5a7510c80ee4e84491d6c891bfe7'; 
        const response = await axios.get(url, {
            headers: { 'x-apisports-key': API_SPORTS_KEY },
            timeout: 10000 
        });
        if (response.data && response.data.response) {
            return response.data.response;
        }
        return [];
    } catch (e) {
        const status = e.response ? e.response.status : null;
        console.error(`❌ API-Sports Hatası (${url}): HTTP ${status || e.message}`);
        return null;
    }
}

// 🔥 SOFASCORE & ERGAST FETCH FONKSİYONU (TENİS VE F1 İÇİN)
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
    } catch (e) {
        return null;
    }
}

const getTRDate = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
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

// =========================================================================
// 🔔 BİLDİRİM KONTROLÜ VE GÖNDERME
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
            data: {
                matchId: String(id),
                type: "match_update",
                title: String(title),
                body: String(body),
                imageUrl: imageUrl || ""
            },
            apns: {
                headers: { "apns-push-type": "alert", "apns-priority": "10" },
                payload: {
                    aps: {
                        alert: { title: title, body: body },
                        "mutable-content": 1, sound: "default", category: "MATCH_UPDATE"
                    },
                    matchId: String(id), type: "match_update"
                }
            }
        };

        if (matchData) {
            payload.data.homeName = String(matchData.homeTeam?.name || "Ev Sahibi");
            payload.data.awayName = String(matchData.awayTeam?.name || "Deplasman");
            payload.data.homeScore = String(matchData.homeScore || "-");
            payload.data.awayScore = String(matchData.awayScore || "-");
            payload.data.homeLogo = String(matchData.homeTeam?.logo || "");
            payload.data.awayLogo = String(matchData.awayTeam?.logo || "");
            payload.data.status = String(matchData.status || "inprogress");
            payload.data.timeOrMinute = String(matchData.liveMinute || "");

            payload.apns.payload.homeName = payload.data.homeName;
            payload.apns.payload.awayName = payload.data.awayName;
            payload.apns.payload.homeLogo = payload.data.homeLogo;
            payload.apns.payload.awayLogo = payload.data.awayLogo;
            payload.apns.payload.homeTeamId = String(matchData.homeTeam?.id || '0');
            payload.apns.payload.awayTeamId = String(matchData.awayTeam?.id || '0');
        }

        if (imageUrl) {
            payload.apns.fcmOptions = { imageUrl: imageUrl };
            payload.android = { notification: { imageUrl: imageUrl } };
        }

        await admin.messaging().send(payload);
        lastNotificationTime.set(id, now);
        console.log(`✅ [BİLDİRİM GÖNDERİLDİ] ${title}: ${body}`);
    } catch (e) {
        console.error("❌ Bildirim Hatası:", e.message);
    }
}

async function triggerPushToStart(matchId) {
    const match = globalFootballCache.get(matchId);
    if (!match) return;

    let tokensToAlert = [];
    const normalTokens = (await admin.database().ref(`push_to_start_tokens/${matchId}`).once('value')).val();
    if (normalTokens) tokensToAlert.push(...Object.keys(normalTokens));

    tokensToAlert = [...new Set(tokensToAlert)];
    if (tokensToAlert.length === 0) return;

    const cleanHomeScore = match.homeScore && match.homeScore !== "-" ? Number(match.homeScore) : 0;
    const cleanAwayScore = match.awayScore && match.awayScore !== "-" ? Number(match.awayScore) : 0;
    const cleanMinute = match.liveMinute ? String(match.liveMinute).replace("'", "") : "Canlı";

    console.log(`🚀 [PUSH-TO-START] ${match.homeTeam.name} - ${match.awayTeam.name} maçı (${cleanMinute}) ${tokensToAlert.length} cihaza başlatılıyor...`);

    for (const token of tokensToAlert) {
        let notification = new apn.Notification();
        notification.rawPayload = {
            aps: {
                timestamp: Math.floor(Date.now() / 1000),
                event: 'start',
                "attributes-type": "MacSaatiWidgetAttributes", 
                "attributes": {
                    "matchId": String(match.id),
                    "homeTeamName": String(match.homeTeam.name),
                    "awayTeamName": String(match.awayTeam.name),
                    "leagueName": String(match.tournament || "Futbol"),
                    "homeTeamId": match.homeTeam.id ? Number(match.homeTeam.id) : 0,
                    "awayTeamId": match.awayTeam.id ? Number(match.awayTeam.id) : 0,
                    "homeLogoFile": `logo_home_${match.id}.png`,
                    "awayLogoFile": `logo_away_${match.id}.png`
                },
                "content-state": {
                    "homeScore": Number(cleanHomeScore),
                    "awayScore": Number(cleanAwayScore),
                    "matchMinute": String(cleanMinute)
                },
                "alert": {
                    "title": "Maç Saati",
                    "body": `${match.homeTeam.name} - ${match.awayTeam.name} canlı takibi başladı!`
                }
            }
        };

        notification.topic = "com.elfcrzgr.macsaati.push-type.liveactivity";
        notification.priority = 10;
        notification.pushType = "liveactivity";

        if (typeof notification.headers === 'function') {
            const originalHeadersFn = notification.headers.bind(notification);
            notification.headers = function() {
                let h = originalHeadersFn();
                h["apns-push-type"] = "liveactivity";
                return h;
            };
        }

        try {
            const result = await apnProvider.send(notification, token);
            if (result.failed.length > 0) {
                const err = result.failed[0];
                const errorReason = err.response ? err.response.reason : err.error;
                console.error(`❌ [START REDDEDİLDİ] Sebep: ${errorReason} | Token: ${token.substring(0,10)}...`);
            }
        } catch (e) { console.error("❌ İletim Hatası:", e); }
    }
}

async function checkAndSendNotifications(newMatches) {
    for (const match of newMatches) {
        const matchIdStr = String(match.id);
        const prev = previousMatchStates.get(matchIdStr) || {
            status: null, homeScore: 0, awayScore: 0,
            hasNotifiedStart: false, hasNotifiedHT: false, hasNotifiedSH: false, hasNotifiedFinished: false,
            lastMinute: 0, liveMinuteStr: ""
        };

        let currH = parseInt(match.homeScore) || 0;
        let currA = parseInt(match.awayScore) || 0;
        const notifAwayScore = String(match.awayScore).replace('\n', ' ');
        const liveMin = match.liveMinute || "";
        const tObj = match.timeObj || {};
        let currentMinNum = tObj.currentMinute || 0;

        if (match.status === 'inprogress' && currentMinNum > 0 && prev.lastMinute > 0 && currentMinNum < prev.lastMinute) {
            currH = prev.homeScore;
            currA = prev.awayScore;
            match.homeScore = String(currH);
            match.awayScore = String(currA);
            currentMinNum = prev.lastMinute;
        }

        const isLive = match.status === 'inprogress';
        const isFinished = ['finished', 'ended', 'closed'].includes(match.status);
        const minuteChanged = liveMin !== prev.liveMinuteStr;
        const scoreChanged = currH !== prev.homeScore || currA !== prev.awayScore;
        const statusChanged = match.status !== prev.status;

        if ((isLive || isFinished) && (minuteChanged || scoreChanged || statusChanged)) {
            const tokensRef = admin.database().ref(`live_activity_tokens/${matchIdStr}`);
            const snapshot = await tokensRef.once('value');
            const tokensObj = snapshot.val();

            if (tokensObj) {
                const tokenList = Object.keys(tokensObj);
                const promises = tokenList.map(async (deviceToken) => {
                    let notification = new apn.Notification();
                    notification.rawPayload = {
                        aps: {
                            timestamp: Math.floor(Date.now() / 1000),
                            event: isFinished ? 'end' : 'update',
                            "content-state": { homeScore: currH, awayScore: currA, matchMinute: isFinished ? "MS" : String(liveMin) }
                        }
                    };
                    notification.topic = "com.elfcrzgr.macsaati.push-type.liveactivity";
                    notification.pushType = "liveactivity";
                    notification.priority = 10;

                    if (typeof notification.headers === 'function') {
                        const originalHeadersFn = notification.headers.bind(notification);
                        notification.headers = function() {
                            let h = originalHeadersFn();
                            h["apns-push-type"] = "liveactivity"; 
                            return h;
                        };
                    }

                    try {
                        const result = await apnProvider.send(notification, deviceToken);
                        if (result.failed.length > 0) {
                            const errorReason = result.failed[0].response ? result.failed[0].response.reason : result.failed[0].error;
                            if (errorReason === 'BadDeviceToken' || errorReason === 'Unregistered') {
                                await admin.database().ref(`live_activity_tokens/${matchIdStr}/${deviceToken}`).remove();
                            }
                        }
                    } catch (e) { console.error("APNs Bağlantı Hatası:", e); }
                });
                await Promise.all(promises);
            }
        }

        const appTitle = "Maç Saati";
        const whistleIconUrl = "https://img.icons8.com/color/96/whistle.png";
        
        if (match.status === 'inprogress' && !prev.hasNotifiedStart) {
            await sendPush(matchIdStr, appTitle, `⚽ Maç Başladı!\n${match.homeTeam.name} - ${match.awayTeam.name}`, null, match);
            prev.hasNotifiedStart = true;
        } else if (match.status === 'inprogress' && (liveMin === "İY" || match.statusCode === 31) && !prev.hasNotifiedHT) {
            await sendPush(matchIdStr, appTitle, `⏱️ İlk Yarı Sonucu\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`, whistleIconUrl, match);
            prev.hasNotifiedHT = true;
        } else if (match.status === 'inprogress' && prev.hasNotifiedHT && (liveMin !== "İY" && match.statusCode !== 31) && !prev.hasNotifiedSH && match.statusCode === 7) {
            await sendPush(matchIdStr, appTitle, `▶️ İkinci Yarı Başladı\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`, whistleIconUrl, match);
            prev.hasNotifiedSH = true;
        } else if (['finished', 'ended', 'closed'].includes(match.status) && !prev.hasNotifiedFinished) {
            if (prev.status === 'inprogress') {
                await sendPush(matchIdStr, appTitle, `🏁 Maç Bitti\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`, null, match);
            }
            prev.hasNotifiedFinished = true;
        }

        if (match.status === 'inprogress' && prev.status !== null) {
            if (prev.homeScore !== currH || prev.awayScore !== currA) {
                if ((currH + currA) > (prev.homeScore + prev.awayScore)) {
                    const homeScored = currH > prev.homeScore;
                    const scoringTeamLogo = homeScored ? match.homeTeam.logo : match.awayTeam.logo;
                    await sendPush(matchIdStr, appTitle, `⚽ Gol! (${liveMin})\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`, scoringTeamLogo, match);
                }
            }
        }

        previousMatchStates.set(matchIdStr, {
            status: match.status, homeScore: currH, awayScore: currA,
            hasNotifiedStart: prev.hasNotifiedStart, hasNotifiedHT: prev.hasNotifiedHT,
            hasNotifiedSH: prev.hasNotifiedSH, hasNotifiedFinished: prev.hasNotifiedFinished,
            lastMinute: Math.max(currentMinNum, prev.lastMinute || 0),
            liveMinuteStr: liveMin, date: match.fixedDate || getTRDate(0)
        });
    }
    saveState();
}

// =========================================================================
// ⚽ FUTBOL TRANSLATIONS VE LİG MAPPER
// =========================================================================
const teamTranslations = {
    "turkey": "Türkiye", "türkiye": "Türkiye", "germany": "Almanya", "france": "Fransa",
    "england": "İngiltere", "spain": "İspanya", "italy": "İtalya", "portugal": "Portekiz",
    "netherlands": "Hollanda", "belgium": "Belçika", "switzerland": "İsviçre", "austria": "Avusturya",
    "croatia": "Hırvatistan", "denmark": "Danimarka", "sweden": "İsveç", "norway": "Norveç",
    "poland": "Polonya", "ukraine": "Ukrayna", "czech republic": "Çekya", "czechia": "Çekya",
    "serbia": "Sırbistan", "hungary": "Macaristan", "romania": "Romanya", "greece": "Yunanistan",
    "slovakia": "Slovakya", "wales": "Galler", "scotland": "İskoçya", "ireland": "İrlanda",
    "northern ireland": "Kuzey İrlanda", "albania": "Arnavutluk", "north macedonia": "Kuzey Makedonya",
    "georgia": "Gürcistan", "slovenia": "Slovenya", "iceland": "İzlanda", "finland": "Finlandiya",
    "bosnia & herzegovina": "Bosna-Hersek", "bosnia and herzegovina": "Bosna-Hersek",
    "montenegro": "Karadağ", "bulgaria": "Bulgaristan", "russia": "Rusya",
    "israel": "İsrail", "luxembourg": "Lüksemburg", "cyprus": "Kıbrıs Rum Kesimi", "andorra": "Andorra",
    "liechtenstein": "Lihtenştayn", "azerbaijan": "Azerbaycan", "malta": "Malta", "belarus": "Belarus",
    "armenia": "Ermenistan", "kazakhstan": "Kazakistan", "gibraltar": "Cebelitarık",
    "brazil": "Brezilya", "argentina": "Arjantin", "uruguay": "Uruguay", "colombia": "Kolombiya",
    "chile": "Şili", "peru": "Peru", "venezuela": "Venezuela", "paraguay": "Paraguay",
    "bolivia": "Bolivya", "ecuador": "Ekvador",
    "usa": "ABD", "united states": "ABD", "mexico": "Meksika", "canada": "Kanada",
    "costa rica": "Kosta Rika", "jamaica": "Jamaika", "panama": "Panama", "honduras": "Honduras",
    "curaçao": "Curaçao", "curacao": "Curaçao", "dr congo": "Demokratik Kongo", 
    "ivory coast": "Fildişi Sahili", "south korea": "Güney Kore", "japan": "Japonya", 
    "iran": "İran", "saudi arabia": "Suudi Arabistan", "qatar": "Katar", "australia": "Avustralya"
};

const translateTeam = (name) => {
    if (!name) return name;
    const lowerName = name.toLowerCase().trim();
    if (teamTranslations[lowerName]) return teamTranslations[lowerName];
    for (const [eng, tr] of Object.entries(teamTranslations)) {
        const regex = new RegExp(`\\b${eng}\\b`, 'i');
        if (regex.test(name)) return name.replace(regex, tr);
    }
    return name;
};

const ELITE_FOOT_IDS = [39, 140, 78, 135, 61, 203, 2, 3, 848, 1, 4, 9, 15, 66, 137, 71]; 
const REGULAR_FOOT_IDS = [204, 205, 206, 40, 41, 141, 136, 62, 79, 72, 119, 144, 253, 283];
const ALL_FOOT_TARGETS = [...ELITE_FOOT_IDS, ...REGULAR_FOOT_IDS];

const footballLeagues = {
    39: "İngiltere Premier Lig", 140: "İspanya La Liga", 78: "Almanya Bundesliga",
    135: "İtalya Serie A", 61: "Fransa Ligue 1", 203: "Türkiye Süper Lig",
    204: "Trendyol 1. Lig", 205: "TFF 2. Lig", 206: "Türkiye Kupası",
    2: "UEFA Şampiyonlar Ligi", 3: "UEFA Avrupa Ligi", 848: "UEFA Konferans Ligi",
    1: "FIFA Dünya Kupası", 4: "UEFA EURO", 9: "Copa America",
    15: "FIFA Kulüpler Dünya Kupası", 40: "İngiltere Championship", 41: "İngiltere League One",
    141: "İspanya Segunda Division", 136: "İtalya Serie B", 62: "Fransa Ligue 2", 79: "Almanya 2. Bundesliga",
    71: "Brezilya Serie A", 119: "Hollanda Eredivisie", 144: "Belçika Pro League"
};

const tournamentLogoMapper = {
    39: 17, 140: 8, 78: 35, 135: 23, 61: 34, 203: 52, 204: 98, 205: 97, 
    206: 938, 2: 7, 3: 679, 848: 17015, 1: 16, 4: 1, 9: 133
};

const getFootBroadcaster = (leagueId, hName, aName) => {
    const staticConfigs = {
        39: "beIN Sports", 140: "S Sport Plus", 78: "Tivibu Spor", 
        135: "S Sport Plus", 61: "beIN Sports", 203: "beIN Sports",
        204: "TRT Spor / beIN Sports", 205: "TFF YouTube", 206: "A Spor / ATV",
        2: "Tabii / TRT", 3: "Tabii / TRT", 848: "Tabii / TRT"
    };
    if (staticConfigs[leagueId]) return staticConfigs[leagueId];
    return "Resmi Yayıncı / Canlı Skor";
};

// =========================================================================
// ⚽ FUTBOL GÜNCELLEME (API-SPORTS)
// =========================================================================
const teamIdMapper = {
    777: 4700, 2380: 4789
};

async function updateFootball(targetDates) {
    console.log(`⚽ Futbol verisi çekiliyor... (Gün: ${targetDates.length})`);
    let allFixtures = [];
    let apiSuccessCount = 0;

    for (const date of targetDates) {
        const url = `https://v3.football.api-sports.io/fixtures?date=${date}`;
        const fixtures = await fetchApiSports(url);
        if (fixtures !== null && fixtures.length > 0) {
            allFixtures.push(...fixtures.filter(f => ALL_FOOT_TARGETS.includes(f.league.id)));
            apiSuccessCount++;
        }
        await new Promise(r => setTimeout(r, 1000));
    }

    if (apiSuccessCount === 0) {
        console.log("⚠️ API'den hiçbir veri alınamadı! Mevcut liste korunuyor...");
        return { hasLiveMatch: sportUpdateStatus.football.hasLiveMatch, nextMatchTimestamp: sportUpdateStatus.football.nextMatchTime }; 
    }

    const validDates = [getTRDate(-2), getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2), getTRDate(3)];
    for (const [id, state] of previousMatchStates.entries()) {
        if (state.date && !validDates.includes(state.date)) {
            if (state.status !== 'inprogress') previousMatchStates.delete(id);
        }
    }
    saveState();

    for (const [id, match] of globalFootballCache.entries()) {
        if (!validDates.includes(match.fixedDate)) globalFootballCache.delete(id);
    }

    let futbolMatchesLog = [];

    allFixtures.forEach(e => {
        const shortStatus = e.fixture.status.short;
        if (['PST', 'CANC', 'ABD', 'AWD', 'WO'].includes(shortStatus)) return;

        let status = 'notstarted';
        let statusCode = 0;
        let liveMinute = "";
        let timeObj = {};

        if (['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE'].includes(shortStatus)) {
            status = 'inprogress';
            if (shortStatus === '1H') statusCode = 6;
            else if (shortStatus === 'HT') statusCode = 31;
            else if (shortStatus === '2H') statusCode = 7;
            
            if (shortStatus === 'HT') liveMinute = "İY";
            else if (shortStatus === 'BT') liveMinute = "UZ İY";
            else if (shortStatus === 'P') liveMinute = "PEN";
            else liveMinute = e.fixture.status.elapsed ? `${e.fixture.status.elapsed}'` : "Canlı";
            
            timeObj = { currentMinute: e.fixture.status.elapsed || 0 };
        } 
        else if (['FT', 'AET', 'PEN'].includes(shortStatus)) {
            status = 'finished';
        }

        const leagueId = e.league.id;
        const hName = translateTeam(e.teams.home.name);
        const aName = translateTeam(e.teams.away.name);
        const cleanTournamentName = footballLeagues[leagueId] || e.league.name;

        const dateTR = new Date(e.fixture.timestamp * 1000);
        const dayTR = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        const timeString = dateTR.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

        const fallbackBroadcaster = getFootBroadcaster(leagueId, hName, aName);
        const result = getBroadcasterWithFallback("futbol", dayTR, timeString, hName, aName, fallbackBroadcaster);
        const finalBroadcaster = result.kanal;

        futbolMatchesLog.push({ home: hName, away: aName, kanal: finalBroadcaster, source: result.source });

        const finalHomeScore = (status === 'inprogress' || status === 'finished') ? String(e.goals.home ?? "0") : "-";
        const finalAwayScore = (status === 'inprogress' || status === 'finished') ? String(e.goals.away ?? "0") : "-";

        const repoLogoId = tournamentLogoMapper[leagueId];
        const finalTournamentLogo = repoLogoId ? `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/${repoLogoId}.png` : e.league.logo;

        const mappedHomeId = teamIdMapper[e.teams.home.id] || e.teams.home.id;
        const mappedAwayId = teamIdMapper[e.teams.away.id] || e.teams.away.id;

        globalFootballCache.set(e.fixture.id, {
            id: e.fixture.id,
            isElite: ELITE_FOOT_IDS.includes(leagueId),
            status: status,
            statusCode: statusCode,
            liveMinute: liveMinute,
            fixedDate: dayTR,
            fixedTime: timeString,
            timestamp: e.fixture.timestamp * 1000,
            broadcaster: finalBroadcaster,
            homeTeam: { name: hName, logo: e.teams.home.logo, id: e.teams.home.id },
            awayTeam: { name: aName, logo: e.teams.away.logo, id: e.teams.away.id },
            tournamentLogo: finalTournamentLogo, 
            homeScore: finalHomeScore,
            awayScore: finalAwayScore,
            setScores: [],
            tournament: cleanTournamentName,
            timeObj: timeObj
        });
    });

    const matches = Array.from(globalFootballCache.values()).sort((a, b) => a.timestamp - b.timestamp);
    await checkAndSendNotifications(matches);
    await uploadToFirebase("football", { success: true, lastUpdate: new Date().toLocaleTimeString('tr-TR'), matches });

    logMatchesBySport({ futbol: futbolMatchesLog });

    const forcedSnapshot = await admin.database().ref('forced_matches').once('value');
    const forcedMatches = forcedSnapshot.val() || {};
    for (const [id, match] of globalFootballCache.entries()) {
        if (forcedMatches[String(id)] === true && !triggeredMatches.has(String(id))) {
            console.log(`🌟 [KRİTİK MAÇ] ${match.homeTeam.name} tetikleniyor...`);
            await triggerPushToStart(id);
            triggeredMatches.add(String(id));
        }
    }

    const hasLiveMatch = matches.some(m => m.status === 'inprogress');
    console.log(`  ✅ İşlem tamam. Toplam ${matches.length} maç (${hasLiveMatch ? '🟢 CANLI VAR' : '⚪ CANLI YOK'})`);
    
    return { hasLiveMatch, nextMatchTimestamp: findNextMatchTime(globalFootballCache), hasAnyMatches: matches.length > 0 };
}

// =========================================================================
// 🏀 BASKETBOL GÜNCELLEME (API-SPORTS)
// =========================================================================
const TARGET_BASKET_LEAGUES = [12, 120]; 

async function updateBasketball(targetDates) {
    console.log(`🏀 Basketbol verisi çekiliyor... (Gün: ${targetDates.length})`);
    
    let allGames = [];
    let successfulDates = [];

    for (const date of targetDates) {
        const url = `https://v1.basketball.api-sports.io/games?date=${date}`;
        const games = await fetchApiSports(url);
        if (games !== null && games.length > 0) {
            allGames.push(...games);
            successfulDates.push(date);
        }
        await new Promise(r => setTimeout(r, 1000));
    }

    if (successfulDates.length === 0) {
        console.log("⚠️ Basketbol API'den veri alınamadı. Mevcut liste korunuyor...");
        return { hasLiveMatch: sportUpdateStatus.basketball.hasLiveMatch, nextMatchTimestamp: sportUpdateStatus.basketball.nextMatchTime }; 
    }

    const validDates = [getTRDate(-2), getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2), getTRDate(3)];
    for (const [id, match] of globalBasketballCache.entries()) {
        if (!validDates.includes(match.fixedDate)) {
            globalBasketballCache.delete(id);
        }
    }

    let basketbolMatchesLog = [];

    for (const g of allGames) {
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

        const translatedHome = translateTeam(g.teams.home.name);
        const translatedAway = translateTeam(g.teams.away.name);

        const result = getBroadcasterWithFallback("basketbol", dayStr, timeString, translatedHome, translatedAway, "Resmi Yayıncı");
        basketbolMatchesLog.push({ home: translatedHome, away: translatedAway, kanal: result.kanal, source: result.source });

        globalBasketballCache.set(g.id, {
            id: g.id,
            isElite: true,
            status: statusType,
            fixedDate: dayStr,
            fixedTime: timeString,
            timestamp: g.timestamp * 1000,
            broadcaster: result.kanal,
            homeTeam: { name: translatedHome, logo: g.teams.home.logo, id: g.teams.home.id }, 
            awayTeam: { name: translatedAway, logo: g.teams.away.logo, id: g.teams.away.id }, 
            tournamentLogo: g.league.logo, 
            homeScore: (isInProgress || isFinished) ? String(g.scores.home.total ?? "0") : "-",
            awayScore: (isInProgress || isFinished) ? String(g.scores.away.total ?? "0") : "-",
            tournament: g.league.name
        });
    }

    const matches = Array.from(globalBasketballCache.values()).sort((a, b) => a.timestamp - b.timestamp);
    await uploadToFirebase("basketball", { success: true, lastUpdate: new Date().toLocaleTimeString('tr-TR'), matches });

    logMatchesBySport({ basketbol: basketbolMatchesLog });
    
    const hasLiveMatch = matches.some(m => m.status === 'inprogress');
    console.log(`  ✅ İşlem tamam. Toplam ${matches.length} basketbol maçı (${hasLiveMatch ? '🟢 CANLI VAR' : '⚪ CANLI YOK'})`);
    
    return { hasLiveMatch, nextMatchTimestamp: findNextMatchTime(globalBasketballCache), hasAnyMatches: matches.length > 0 };
}

// =========================================================================
// 🎾 TENİS GÜNCELLEME (SOFASCORE)
// =========================================================================
async function updateTennis(targetDates) {
    console.log(`🎾 Tenis verisi çekiliyor... (Gün: ${targetDates.length})`);
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
// 🏎️ FORMULA 1 GÜNCELLEME (ERGAST)
// =========================================================================
const F1_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/tournament_logos/`;
const F1_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/logos/`;
const CIRCUIT_DETAILS = {
    "bahrain": { laps: "57", length: "5.412 km", record: "1:31.447 - Pedro de la Rosa" },
    "jeddah": { laps: "50", length: "6.174 km", record: "1:30.734 - Lewis Hamilton" },
    "albert_park": { laps: "58", length: "5.278 km", record: "1:19.813 - Charles Leclerc" },
    "suzuka": { laps: "53", length: "5.807 km", record: "1:30.983 - Lewis Hamilton" },
    "shanghai": { laps: "56", length: "5.451 km", record: "1:32.238 - Michael Schumacher" },
    "miami": { laps: "57", length: "5.412 km", record: "1:29.708 - Max Verstappen" },
    "imola": { laps: "63", length: "4.909 km", record: "1:15.484 - Lewis Hamilton" },
    "monaco": { laps: "78", length: "3.337 km", record: "1:12.909 - Lewis Hamilton" },
    "villeneuve": { laps: "70", length: "4.361 km", record: "1:13.078 - Valtteri Bottas" },
    "catalunya": { laps: "66", length: "4.675 km", record: "1:18.149 - Max Verstappen" },
    "red_bull_ring": { laps: "71", length: "4.318 km", record: "1:05.619 - Carlos Sainz" },
    "silverstone": { laps: "52", length: "5.891 km", record: "1:27.097 - Max Verstappen" },
    "hungaroring": { laps: "70", length: "4.381 km", record: "1:16.627 - Lewis Hamilton" },
    "spa": { laps: "44", length: "7.004 km", record: "1:46.286 - Valtteri Bottas" },
    "zandvoort": { laps: "72", length: "4.259 km", record: "1:11.097 - Lewis Hamilton" },
    "monza": { laps: "53", length: "5.793 km", record: "1:21.046 - Rubens Barrichello" },
    "baku": { laps: "51", length: "6.003 km", record: "1:43.009 - Charles Leclerc" },
    "marina_bay": { laps: "62", length: "4.940 km", record: "1:35.867 - Lewis Hamilton" },
    "americas": { laps: "56", length: "5.513 km", record: "1:36.169 - Charles Leclerc" },
    "rodriguez": { laps: "71", length: "4.304 km", record: "1:17.774 - Valtteri Bottas" },
    "interlagos": { laps: "71", length: "4.309 km", record: "1:10.540 - Valtteri Bottas" },
    "vegas": { laps: "50", length: "6.201 km", record: "1:35.490 - Oscar Piastri" },
    "losail": { laps: "57", length: "5.419 km", record: "1:24.319 - Max Verstappen" },
    "yas_marina": { laps: "58", length: "5.281 km", record: "1:26.103 - Max Verstappen" }
};

async function updateF1() {
    console.log(`🏎️ Formula 1 güncelleniyor...`);
    try {
        const response = await fetchSofascore('https://api.jolpi.ca/ergast/f1/current.json');
        if (!response) return;
        const races = response.MRData?.RaceTable?.Races || [];
        const finalEvents = [];

        const countryToCode = {
            "Bahrain": "bh", "Saudi Arabia": "sa", "Australia": "au", "Japan": "jp",
            "China": "cn", "USA": "us", "United States": "us", "Italy": "it",
            "Monaco": "mc", "Canada": "ca", "Spain": "es", "Austria": "at",
            "UK": "gb", "Hungary": "hu", "Belgium": "be", "Netherlands": "nl",
            "Azerbaijan": "az", "Singapore": "sg", "Mexico": "mx", "Brazil": "br",
            "Qatar": "qa", "UAE": "ae"
        };

        races.forEach(race => {
            const circuitId = race.Circuit.circuitId;
            const countryName = race.Circuit.Location.country;
            const stats = CIRCUIT_DETAILS[circuitId] || { laps: "-", length: "-", record: "-" };
            let flagCode = countryToCode[countryName] || countryName.toLowerCase().substring(0, 2);
            if (countryName.toLowerCase().includes("usa")) flagCode = "us";

            const addSession = (sessionName, dateStr, timeStr) => {
                if (!dateStr || !timeStr) return;
                const dateObj = new Date(`${dateStr}T${timeStr}`);
                const dayName = dateObj.toLocaleDateString('tr-TR', { weekday: 'long' });
                const dayAndMonth = dateObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
                
                finalEvents.push({
                    id: `${race.round}_${sessionName.replace(/\s/g, '')}`,
                    fixedDate: `${dayAndMonth} ${dayName}`,
                    fixedTime: dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
                    timestamp: dateObj.getTime(),
                    broadcaster: "beIN Sports / F1 TV",
                    grandPrix: race.raceName,
                    sessionName: sessionName,
                    trackName: race.Circuit.circuitName,
                    circuitStats: { laps: stats.laps, length: stats.length, record: stats.record },
                    countryLogo: F1_LOGO_BASE + flagCode + ".png",
                    tournamentLogo: F1_TOURNAMENT_BASE + circuitId + ".png"
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
        await uploadToFirebase("f1", { success: true, lastUpdated: new Date().toISOString(), totalSessions: finalEvents.length, events: finalEvents });
        console.log(`  ✅ F1 güncellemesi tamamlandı.`);
    } catch (error) { console.error(`   ⚠️ F1 hatası: ${error.message}`); }
}

// =========================================================================
// 🆕 AKILLI DÖNGÜ (SÜPER KOTA KORUYUCU - SEÇENEK 1)
// =========================================================================
const HOUR_MS = 60 * 60000; // 1 Saat

async function main() {
    if (!apnProvider) {
        console.error("⚠️ KRİTİK HATA: APNs Sağlayıcı başlatılamadı!");
        return;
    }

    loadState();
    console.log("============================================================");
    console.log("🟢 J7 AKILLI SUNUCU BAŞLADI (MAX KOTA TASARRUFU AKTİF)");
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

            // 1. GÜNDE 4 KERE TAM LİSTE ÇEKİMİ
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

            // 2. FUTBOL: CANLI VEYA YAKLAŞAN VARSA 10 DAKİKADA BİR (KOTA DOSTU MOD)
            const isFootballActive = sportUpdateStatus.football.hasLiveMatch || (sportUpdateStatus.football.nextMatchTime && now >= (sportUpdateStatus.football.nextMatchTime - TEN_MIN_MS * 2));
            
            if (isFootballActive) {
                if (now - sportUpdateStatus.football.lastQuickUpdate >= TEN_MIN_MS) {
                    console.log("⚽ [HIZLI DÖNGÜ] Futbol maçları takip ediliyor (10 Dk. Modu)...");
                    const footResult = await updateFootball(sportUpdateStatus.football.hasLiveMatch ? todayOnly : quickScanDates); 
                    sportUpdateStatus.football.lastQuickUpdate = now;
                    sportUpdateStatus.football.hasLiveMatch = footResult.hasLiveMatch;
                    sportUpdateStatus.football.nextMatchTime = footResult.nextMatchTimestamp;
                }
            }

            // 3. BASKETBOL: MAÇ VARSA SADECE SAATTE 1 KERE
            const isBasketballActiveToday = sportUpdateStatus.basketball.hasLiveMatch || (sportUpdateStatus.basketball.nextMatchTime && sportUpdateStatus.basketball.nextMatchTime < now + 24 * HOUR_MS);
            
            if (isBasketballActiveToday && now - sportUpdateStatus.basketball.lastQuickUpdate >= HOUR_MS) {
                console.log("🏀 [SAATLİK DÖNGÜ] Basketbol verileri güncelleniyor...");
                const basketResult = await updateBasketball(todayOnly);
                sportUpdateStatus.basketball.lastQuickUpdate = now;
                sportUpdateStatus.basketball.nextMatchTime = basketResult.nextMatchTimestamp;
                sportUpdateStatus.basketball.hasLiveMatch = basketResult.hasLiveMatch;
            }

            // 4. TENİS: MAÇ VARSA SADECE SAATTE 1 KERE
            const isTennisActiveToday = sportUpdateStatus.tennis.hasLiveMatch || (sportUpdateStatus.tennis.nextMatchTime && sportUpdateStatus.tennis.nextMatchTime < now + 24 * HOUR_MS);
            
            if (isTennisActiveToday && now - sportUpdateStatus.tennis.lastQuickUpdate >= HOUR_MS) {
                console.log("🎾 [SAATLİK DÖNGÜ] Tenis verileri güncelleniyor...");
                const tennisResult = await updateTennis(todayOnly);
                sportUpdateStatus.tennis.lastQuickUpdate = now;
                sportUpdateStatus.tennis.nextMatchTime = tennisResult.nextMatchTimestamp;
                sportUpdateStatus.tennis.hasLiveMatch = tennisResult.hasLiveMatch;
            }

            // 5. AKILLI UYKU HESAPLAMASI
            let sleepTime = HOUR_MS; 

            if (isFootballActive) {
                // KOTAYI KORUMAK İÇİN BURAYI DA 10 DAKİKA YAPTIK
                sleepTime = TEN_MIN_MS;
                console.log("⚡ Futbol canlı/yaklaşan maç var, kota koruması için 10 dakika sonra kontrol...");
            } else if (sportUpdateStatus.football.nextMatchTime) {
                let timeToNextFoot = sportUpdateStatus.football.nextMatchTime - now - TEN_MIN_MS;
                if (timeToNextFoot > 0 && timeToNextFoot < HOUR_MS) {
                    sleepTime = timeToNextFoot;
                }
                
                if (isBasketballActiveToday) {
                    let timeToNextBask = HOUR_MS - (now - sportUpdateStatus.basketball.lastQuickUpdate);
                    if (timeToNextBask > 0 && timeToNextBask < sleepTime) sleepTime = timeToNextBask;
                }
                if (isTennisActiveToday) {
                    let timeToNextTen = HOUR_MS - (now - sportUpdateStatus.tennis.lastQuickUpdate);
                    if (timeToNextTen > 0 && timeToNextTen < sleepTime) sleepTime = timeToNextTen;
                }

                if (sleepTime < TEN_MIN_MS) sleepTime = TEN_MIN_MS;
                console.log(`⏱️ Dinlenme modu: Sonraki uyandırma ${Math.ceil(sleepTime / 60000)} dakika sonra...`);
            } else {
                console.log("🌙 Bugün için hiçbir maç kalmadı. Saatlik rutin bekleniyor...");
                sleepTime = HOUR_MS;
            }

            await new Promise(r => setTimeout(r, sleepTime));
            iteration++;

        } catch (e) {
            console.error("🚨 Hata:", e.message);
            await new Promise(r => setTimeout(r, TEN_MIN_MS));
        }
    }
}

main();
