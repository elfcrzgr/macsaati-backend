const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const admin = require('firebase-admin');
const apn = require('apn');
const axios = require('axios');

const triggeredMatches = new Set();
const IS_PRODUCTION = false; 

const serviceAccount = JSON.parse(fs.readFileSync('./serviceAccountKey.json', 'utf8'));
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app/"
});
console.log("🔥 Firebase Admin başlatıldı (Futbol).");

const apnProvider = new apn.Provider({
    token: {
        key: __dirname + "/AuthKey_9JFB2X7TY9.p8",
        keyId: "9JFB2X7TY9",
        teamId: "9MQ7UDX75J"
    },
    production: IS_PRODUCTION
});
console.log(`🍏 Apple APNs hazır. (Mod: ${IS_PRODUCTION ? "CANLI" : "GELİŞTİRİCİ"})`);

const previousMatchStates = new Map();
const pendingGoalCancel = new Map();
const globalFootballCache = new Map();

const sportUpdateStatus = { lastQuickUpdate: 0, nextMatchTime: null, hasLiveMatch: false };
const STATE_FILE = 'futbol_states.json'; 

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
            console.log(`📂 [HAFIZA] ${previousMatchStates.size} maç dosyadan yüklendi.`);
        } catch (e) {
            console.error("❌ Hafıza dosyası okunamadı.");
        }
    }
}

const GITHUB_USER = "elfcrzgr";
const REPO_NAME = "macsaati-backend";
const MINUTE_MS = 60000;
const TEN_MIN_MS = 4 * 60000;
const HOUR_MS = 60 * 60000;

function logMatchesBySport(matchGroups) {
    for (const sportType of Object.keys(matchGroups)) {
        const sporekraniMatches = matchGroups[sportType].filter(m => m.source === "sporekrani");
        if (sporekraniMatches.length === 0) continue;
        console.log(`\n--------- ⚽ FUTBOL SPOREKRANI ---------`);
        for (const m of sporekraniMatches) console.log(`⚽ ${m.home} vs ${m.away} | Kanal: ${m.kanal}`);
    }
}

let externalBroadcasters = {};
function loadExternalBroadcasters() {
    try {
        if (fs.existsSync('yayinci_bilgisi.json')) {
            externalBroadcasters = JSON.parse(fs.readFileSync('yayinci_bilgisi.json', 'utf8'));
        } else { 
            externalBroadcasters = {}; 
            console.log("⚠️ yayinci_bilgisi.json dosyası bulunamadı!");
        }
    } catch (e) { 
        // JSON dosyasında virgül veya parantez unutulduğunda anında terminalde göreceksin
        console.error("❌ JSON SÖZDİZİMİ (SYNTAX) HATASI! Dosya formatı bozuk:", e.message);
        externalBroadcasters = {}; 
    }
}

function getBroadcasterWithFallback(sportCategory, dateStr, timeStr, homeName, awayName, fallback) {
    const cleanTime = (timeStr || "").replace(/\n?CANLI/, "").replace(/\n?MS/, "").replace('.', ':').trim();
    const [cH, cM] = cleanTime.split(':').map(Number);
    
    // 🚀 KRİTİK DÜZELTME: Hem JSON maç adını hem API takım adını aynı filtreden geçiriyoruz
    const normalizeStr = (str) => {
        if (!str) return "";
        return str.replace(/İ/g, 'i').replace(/I/g, 'i').replace(/Ğ/g, 'g').replace(/ğ/g, 'g')
                  .replace(/Ü/g, 'u').replace(/ü/g, 'u').replace(/Ş/g, 's').replace(/ş/g, 's')
                  .replace(/Ö/g, 'o').replace(/ö/g, 'o').replace(/Ç/g, 'c').replace(/ç/g, 'c')
                  .replace(/ı/g, 'i').toLowerCase().replace(/[^a-z0-9]/g, ' ');
    };

    const homeWords = normalizeStr(homeName).split(' ').filter(w => w.length >= 3);
    const awayWords = normalizeStr(awayName).split(' ').filter(w => w.length >= 3);

    const getSafeDates = (baseStr) => {
        const [y, m, d] = baseStr.split('-').map(Number);
        return [-1, 0, 1].map(offset => {
            const dateObj = new Date(y, m - 1, d + offset);
            return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
        });
    };

    for (const dateKey of getSafeDates(dateStr)) {
        const dayData = externalBroadcasters[dateKey];
        if (!dayData || !dayData.matches) continue;
        
        for (const m of dayData.matches) {
            if (m.spor && normalizeStr(m.spor) === normalizeStr(sportCategory)) {
                const mTime = (m.saat || "").replace('.', ':').trim();
                const [mH, mM] = mTime.split(':').map(Number);
                
                // JSON'dan gelen isim de tamamen ascii karaktere (isvicre cezayir) dönüştürülüyor
                const mTitleClean = normalizeStr(m.mac); 

                const matchHome = homeWords.length === 0 || homeWords.some(w => mTitleClean.includes(w));
                const matchAway = awayWords.length === 0 || awayWords.some(w => mTitleClean.includes(w));
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


async function uploadToFirebase(sportName, data) {
    try {
        await admin.database().ref(`matches_${sportName}`).set(data);
        console.log(`✅ [FIREBASE] ${sportName.toUpperCase()} güncellendi!`);
    } catch (error) { console.error(`❌ [FIREBASE] Hata:`, error.message); }
}

async function fetchData(url) {
    try {
        const directUrl = url.replace('api-football-v1.p.rapidapi.com/v3', 'v3.football.api-sports.io');
        const API_SPORTS_KEY = '870e5a7510c80ee4e84491d6c891bfe7'; 
        const response = await axios.get(directUrl, { headers: { 'x-apisports-key': API_SPORTS_KEY }, timeout: 10000 });
        
        // Gizli API Hatalarını Yakalama
        if (response.data && response.data.errors && Object.keys(response.data.errors).length > 0) {
            console.log(`⚠️ API-SPORTS İZİN HATASI:`, response.data.errors);
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

const lastNotificationTime = new Map();
async function sendPush(id, title, body, imageUrl = null, matchData = null) {
    const now = Date.now();
    if (now - (lastNotificationTime.get(id) || 0) < 15000) return;
    try {
        const payload = {
            topic: `match_${id}`, notification: { title, body },
            data: { matchId: String(id), type: "match_update", title, body, imageUrl: imageUrl || "" },
            apns: { headers: { "apns-push-type": "alert", "apns-priority": "10" }, payload: { aps: { alert: { title, body }, "mutable-content": 1, sound: "default", category: "MATCH_UPDATE" }, matchId: String(id), type: "match_update" } }
        };
        if (matchData) {
            payload.data.homeName = String(matchData.homeTeam?.name || ""); payload.data.awayName = String(matchData.awayTeam?.name || "");
            payload.data.homeScore = String(matchData.homeScore || "-"); payload.data.awayScore = String(matchData.awayScore || "-");
            payload.data.homeLogo = String(matchData.homeTeam?.logo || ""); payload.data.awayLogo = String(matchData.awayTeam?.logo || "");
            payload.data.status = String(matchData.status || "inprogress"); payload.data.timeOrMinute = String(matchData.liveMinute || "");
            payload.apns.payload.homeName = payload.data.homeName; payload.apns.payload.awayName = payload.data.awayName;
            payload.apns.payload.homeLogo = payload.data.homeLogo; payload.apns.payload.awayLogo = payload.data.awayLogo;
            payload.apns.payload.homeTeamId = String(matchData.homeTeam?.id || '0'); payload.apns.payload.awayTeamId = String(matchData.awayTeam?.id || '0');
        }
        if (imageUrl) { payload.apns.fcmOptions = { imageUrl }; payload.android = { notification: { imageUrl } }; }
        await admin.messaging().send(payload);
        lastNotificationTime.set(id, now);
    } catch (e) {}
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

    for (const token of tokensToAlert) {
        let notification = new apn.Notification();
        notification.rawPayload = {
            aps: {
                timestamp: Math.floor(Date.now() / 1000), event: 'start', "attributes-type": "MacSaatiWidgetAttributes", 
                attributes: { "matchId": String(match.id), "homeTeamName": String(match.homeTeam.name), "awayTeamName": String(match.awayTeam.name), "leagueName": String(match.tournament || "Futbol"), "homeTeamId": match.homeTeam.id ? Number(match.homeTeam.id) : 0, "awayTeamId": match.awayTeam.id ? Number(match.awayTeam.id) : 0, "homeLogoFile": `logo_home_${match.id}.png`, "awayLogoFile": `logo_away_${match.id}.png` },
                "content-state": { "homeScore": Number(cleanHomeScore), "awayScore": Number(cleanAwayScore), "matchMinute": String(cleanMinute) },
                alert: { title: "Maç Saati", body: `${match.homeTeam.name} - ${match.awayTeam.name} canlı takibi başladı!` }
            }
        };
        notification.topic = "com.elfcrzgr.macsaati.push-type.liveactivity"; notification.priority = 10; notification.pushType = "liveactivity";
        if (typeof notification.headers === 'function') { const orig = notification.headers.bind(notification); notification.headers = () => { let h = orig(); h["apns-push-type"] = "liveactivity"; return h; }; }
        try { await apnProvider.send(notification, token); } catch (e) {}
    }
}

async function checkAndSendNotifications(newMatches) {
    for (const match of newMatches) {
        const matchIdStr = String(match.id);
        const prev = previousMatchStates.get(matchIdStr) || { status: null, homeScore: 0, awayScore: 0, hasNotifiedStart: false, hasNotifiedHT: false, hasNotifiedSH: false, hasNotifiedFinished: false, lastMinute: 0, liveMinuteStr: "" };
        let currH = parseInt(match.homeScore) || 0; let currA = parseInt(match.awayScore) || 0;
        const notifAwayScore = String(match.awayScore).replace('\n', ' '); const liveMin = match.liveMinute || ""; const tObj = match.timeObj || {}; let currentMinNum = tObj.currentMinute || 0;

        if (match.status === 'inprogress' && currentMinNum > 0 && prev.lastMinute > 0 && currentMinNum < prev.lastMinute) {
            currH = prev.homeScore; currA = prev.awayScore; match.homeScore = String(currH); match.awayScore = String(currA); currentMinNum = prev.lastMinute;
        }

        const isLive = match.status === 'inprogress'; const isFinished = ['finished', 'ended', 'closed'].includes(match.status);
        if ((isLive || isFinished) && (liveMin !== prev.liveMinuteStr || currH !== prev.homeScore || currA !== prev.awayScore || match.status !== prev.status)) {
            const tokensObj = (await admin.database().ref(`live_activity_tokens/${matchIdStr}`).once('value')).val();
            if (tokensObj) {
                const promises = Object.keys(tokensObj).map(async (deviceToken) => {
                    let notification = new apn.Notification();
                    notification.rawPayload = { aps: { timestamp: Math.floor(Date.now() / 1000), event: isFinished ? 'end' : 'update', "content-state": { homeScore: currH, awayScore: currA, matchMinute: isFinished ? "MS" : String(liveMin) } } };
                    notification.topic = "com.elfcrzgr.macsaati.push-type.liveactivity"; notification.pushType = "liveactivity"; notification.priority = 10;
                    if (typeof notification.headers === 'function') { const orig = notification.headers.bind(notification); notification.headers = () => { let h = orig(); h["apns-push-type"] = "liveactivity"; return h; }; }
                    try {
                        const res = await apnProvider.send(notification, deviceToken);
                        if (res.failed.length > 0 && ['BadDeviceToken', 'Unregistered'].includes(res.failed[0].response?.reason || res.failed[0].error)) {
                            await admin.database().ref(`live_activity_tokens/${matchIdStr}/${deviceToken}`).remove();
                        }
                    } catch (e) {}
                });
                await Promise.all(promises);
            }
        }

        const appTitle = "Maç Saati"; const whistleIconUrl = "https://img.icons8.com/color/96/whistle.png";
        if (match.status === 'inprogress' && !prev.hasNotifiedStart) {
            await sendPush(matchIdStr, appTitle, `⚽ Maç Başladı!\n${match.homeTeam.name} - ${match.awayTeam.name}`, null, match); prev.hasNotifiedStart = true;
        } else if (match.status === 'inprogress' && (liveMin === "İY" || match.statusCode === 31) && !prev.hasNotifiedHT) {
            await sendPush(matchIdStr, appTitle, `⏱️ İlk Yarı Sonucu\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`, whistleIconUrl, match); prev.hasNotifiedHT = true;
        } else if (match.status === 'inprogress' && prev.hasNotifiedHT && (liveMin !== "İY" && match.statusCode !== 31) && !prev.hasNotifiedSH && match.statusCode === 7) {
            await sendPush(matchIdStr, appTitle, `▶️ İkinci Yarı Başladı\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`, whistleIconUrl, match); prev.hasNotifiedSH = true;
        } else if (isFinished && !prev.hasNotifiedFinished) {
            if (prev.status === 'inprogress') await sendPush(matchIdStr, appTitle, `🏁 Maç Bitti\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`, null, match);
            prev.hasNotifiedFinished = true;
        }

        if (match.status === 'inprogress' && prev.status !== null) {
            if (prev.homeScore !== currH || prev.awayScore !== currA) {
                if ((currH + currA) > (prev.homeScore + prev.awayScore)) {
                    const homeScored = currH > prev.homeScore;
                    await sendPush(matchIdStr, appTitle, `⚽ Gol! (${liveMin})\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`, homeScored ? match.homeTeam.logo : match.awayTeam.logo, match);
                }
            }
        }
        previousMatchStates.set(matchIdStr, { status: match.status, homeScore: currH, awayScore: currA, hasNotifiedStart: prev.hasNotifiedStart, hasNotifiedHT: prev.hasNotifiedHT, hasNotifiedSH: prev.hasNotifiedSH, hasNotifiedFinished: prev.hasNotifiedFinished, lastMinute: Math.max(currentMinNum, prev.lastMinute || 0), liveMinuteStr: liveMin, date: match.fixedDate || getTRDate(0) });
    }
    saveState();
}

const teamTranslations = {
    "turkey": "Türkiye", "türkiye": "Türkiye", "germany": "Almanya", "france": "Fransa", "england": "İngiltere", "spain": "İspanya", "italy": "İtalya", "portugal": "Portekiz",
    "netherlands": "Hollanda", "belgium": "Belçika", "switzerland": "İsviçre", "austria": "Avusturya", "croatia": "Hırvatistan", "denmark": "Danimarka", "sweden": "İsveç", "norway": "Norveç",
    "poland": "Polonya", "ukraine": "Ukrayna", "czech republic": "Çekya", "czechia": "Çekya", "serbia": "Sırbistan", "hungary": "Macaristan", "romania": "Romanya", "greece": "Yunanistan",
    "slovakia": "Slovakya", "wales": "Galler", "scotland": "İskoçya", "ireland": "İrlanda", "northern ireland": "Kuzey İrlanda", "albania": "Arnavutluk", "north macedonia": "Kuzey Makedonya",
    "georgia": "Gürcistan", "slovenia": "Slovenya", "iceland": "İzlanda", "finland": "Finlandiya", "bosnia & herzegovina": "Bosna-Hersek", "bosnia and herzegovina": "Bosna-Hersek",
    "montenegro": "Karadağ", "bulgaria": "Bulgaristan", "russia": "Rusya", "israel": "İsrail", "luxembourg": "Lüksemburg", "cyprus": "Kıbrıs Rum Kesimi", "andorra": "Andorra",
    "liechtenstein": "Lihtenştayn", "azerbaijan": "Azerbaycan", "malta": "Malta", "belarus": "Belarus", "armenia": "Ermenistan", "kazakhstan": "Kazakistan", "gibraltar": "Cebelitarık",
    "brazil": "Brezilya", "argentina": "Arjantin", "uruguay": "Uruguay", "colombia": "Kolombiya", "chile": "Şili", "peru": "Peru", "venezuela": "Venezuela", "paraguay": "Paraguay",
    "bolivia": "Bolivya", "ecuador": "Ekvador", "usa": "ABD", "united states": "ABD", "mexico": "Meksika", "canada": "Kanada", "costa rica": "Kosta Rika", "jamaica": "Jamaika",
    "panama": "Panama", "honduras": "Honduras", "curaçao": "Curaçao", "curacao": "Curaçao", "british virgin islands": "Britanya Virjin Adaları", "dominican republic": "Dominik Cumhuriyeti",
    "el salvador": "El Salvador", "cayman islands": "Cayman Adaları", "nicaragua": "Nikaragua", "haiti": "Haiti", "senegal": "Senegal", "morocco": "Fas", "egypt": "Mısır",
    "tunisia": "Tunus", "nigeria": "Nijerya", "cameroon": "Kamerun", "ghana": "Gana", "algeria": "Cezayir", "south africa": "Güney Afrika", "mali": "Mali", "cabo verde": "Yeşil Burun Adaları",
    "cape verde": "Yeşil Burun Adaları", "madagascar": "Madagaskar", "dr congo": "Demokratik Kongo", "democratic republic of the congo": "Demokratik Kongo", "guinea": "Gine",
    "lesotho": "Lesotho", "kenya": "Kenya", "benin": "Benin", "niger": "Nijer", "sierra leone": "Sierra Leone", "liberia": "Liberya", "ivory coast": "Fildişi Sahili",
    "cote d'ivoire": "Fildişi Sahili", "côte d'ivoire": "Fildişi Sahili", "south korea": "Güney Kore", "japan": "Japonya", "iran": "İran", "saudi arabia": "Suudi Arabistan",
    "qatar": "Katar", "australia": "Avustralya", "new zealand": "Yeni Zelanda", "china": "Çin", "india": "Hindistan", "united arab emirates": "BAE", "uae": "BAE", "iraq": "Irak",
    "uzbekistan": "Özbekistan", "jordan": "Ürdün", "maldives": "Maldivler", "afghanistan": "Afganistan", "philippines": "Filipinler", "guam": "Guam", "bangladesh": "Bangladeş",
    "pakistan": "Pakistan", "cambodia": "Kamboçya", "bhutan": "Butan", "indonesia": "Endonezya", "oman": "Umman", "tajikistan": "Tacikistan", "syria": "Suriye", "bahrain": "Bahreyn",
    "hong kong": "Hong Kong", "mongolia": "Moğolistan", "thailand": "Tayland", "kuwait": "Kuveyt", "myanmar": "Myanmar"
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

const ELITE_FOOT_IDS = [1]; 
const REGULAR_FOOT_IDS = [];
const ALL_FOOT_TARGETS = [...ELITE_FOOT_IDS, ...REGULAR_FOOT_IDS];

const footballLeagues = { 39: "İngiltere Premier Lig", 140: "İspanya La Liga", 78: "Almanya Bundesliga", 135: "İtalya Serie A", 61: "Fransa Ligue 1", 203: "Türkiye Süper Lig", 204: "Trendyol 1. Lig", 205: "TFF 2. Lig", 206: "Türkiye Kupası", 2: "UEFA Şampiyonlar Ligi", 3: "UEFA Avrupa Ligi", 848: "UEFA Konferans Ligi", 1: "FIFA Dünya Kupası", 4: "UEFA EURO", 9: "Copa America", 15: "FIFA Kulüpler Dünya Kupası", 40: "İngiltere Championship", 41: "İngiltere League One", 141: "İspanya Segunda Division", 136: "İtalya Serie B", 62: "Fransa Ligue 2", 79: "Almanya 2. Bundesliga", 71: "Brezilya Serie A", 119: "Hollanda Eredivisie", 144: "Belçika Pro League" };
const tournamentLogoMapper = { 39: 17, 140: 8, 78: 35, 135: 23, 61: 34, 203: 52, 204: 98, 205: 97, 206: 938, 2: 7, 3: 679, 848: 17015, 1: 16, 4: 1, 9: 133 };
const teamIdMapper = { 777: 4700, 2380: 4789 };

const getFootBroadcaster = (leagueId, hName, aName) => {
    const staticConfigs = { 39: "beIN Sports", 140: "S Sport Plus", 78: "Tivibu Spor", 135: "S Sport Plus", 61: "beIN Sports", 203: "beIN Sports", 204: "TRT Spor / beIN Sports", 205: "TFF YouTube", 206: "A Spor / ATV", 2: "Tabii / TRT", 3: "Tabii / TRT", 848: "Tabii / TRT" };
    if (staticConfigs[leagueId]) return staticConfigs[leagueId];
    return "Resmi Yayıncı / Canlı Skor";
};

async function updateFootball(targetDates) {
    console.log(`⚽ Futbol verisi çekiliyor... (Gün: ${targetDates.length})`);
    let allFixtures = []; let apiSuccessCount = 0;

    for (const date of targetDates) {
        // 🔥 Timezone eklendi! Artık API bizim saat dilimimize göre 1 günü tam verecek
        const url = `https://v3.football.api-sports.io/fixtures?date=${date}&timezone=Europe/Istanbul`;
        const fixtures = await fetchData(url);
        
        if (fixtures !== null) {
            const currentDayMatches = fixtures.filter(f => ALL_FOOT_TARGETS.includes(f.league.id));
            
            // 🚨 Hangi güne kaç maç geldiğini bizzat terminalde görebilmen için log koyduk:
            console.log(`  📅 ${date} tarihi için API'den ${currentDayMatches.length} maç geldi.`);
            
            if (currentDayMatches.length > 0) {
                allFixtures.push(...currentDayMatches);
            }
            apiSuccessCount++;
        }
        await new Promise(r => setTimeout(r, 1000));
    }

    if (apiSuccessCount === 0) return { hasLiveMatch: sportUpdateStatus.hasLiveMatch, nextMatchTimestamp: sportUpdateStatus.nextMatchTime }; 

    const validDates = [getTRDate(-2), getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2), getTRDate(3)];
    for (const [id, state] of previousMatchStates.entries()) {
        if (state.date && !validDates.includes(state.date) && state.status !== 'inprogress') previousMatchStates.delete(id);
    }
    saveState();
    
    for (const [id, match] of globalFootballCache.entries()) {
        if (!validDates.includes(match.fixedDate)) globalFootballCache.delete(id);
    }

    let futbolMatchesLog = [];
    allFixtures.forEach(e => {
        const shortStatus = e.fixture.status.short;
        if (['PST', 'CANC', 'ABD', 'AWD', 'WO'].includes(shortStatus)) return;

        let status = 'notstarted'; let statusCode = 0; let liveMinute = ""; let timeObj = {};
        if (['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE'].includes(shortStatus)) {
            status = 'inprogress';
            if (shortStatus === '1H') statusCode = 6; else if (shortStatus === 'HT') statusCode = 31; else if (shortStatus === '2H') statusCode = 7;
            if (shortStatus === 'HT') liveMinute = "İY"; else if (shortStatus === 'BT') liveMinute = "UZ İY"; else if (shortStatus === 'P') liveMinute = "PEN";
            else liveMinute = e.fixture.status.elapsed ? `${e.fixture.status.elapsed}'` : "Canlı";
            timeObj = { currentMinute: e.fixture.status.elapsed || 0 };
        } else if (['FT', 'AET', 'PEN'].includes(shortStatus)) { status = 'finished'; }

        const leagueId = e.league.id; const hName = translateTeam(e.teams.home.name); const aName = translateTeam(e.teams.away.name);
        const cleanTournamentName = footballLeagues[leagueId] || e.league.name;
        const dateTR = new Date(e.fixture.timestamp * 1000); const dayTR = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
       // YENİ: Türkiye saatine zorlandı
        const timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });

        const fallbackBroadcaster = getFootBroadcaster(leagueId, hName, aName);
        const result = getBroadcasterWithFallback("futbol", dayTR, timeString, hName, aName, fallbackBroadcaster);
        
        futbolMatchesLog.push({ home: hName, away: aName, kanal: result.kanal, source: result.source });

        const finalHomeScore = (status === 'inprogress' || status === 'finished') ? String(e.goals.home ?? "0") : "-";
        const finalAwayScore = (status === 'inprogress' || status === 'finished') ? String(e.goals.away ?? "0") : "-";
        const repoLogoId = tournamentLogoMapper[leagueId];
        const finalTournamentLogo = repoLogoId ? `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/${repoLogoId}.png` : e.league.logo;
        const mappedHomeId = teamIdMapper[e.teams.home.id] || e.teams.home.id; const mappedAwayId = teamIdMapper[e.teams.away.id] || e.teams.away.id;

        globalFootballCache.set(e.fixture.id, {
            id: e.fixture.id, isElite: ELITE_FOOT_IDS.includes(leagueId), status: status, statusCode: statusCode, liveMinute: liveMinute,
            fixedDate: dayTR, fixedTime: timeString, timestamp: e.fixture.timestamp * 1000, broadcaster: result.kanal,
            homeTeam: { name: hName, logo: e.teams.home.logo, id: e.teams.home.id }, awayTeam: { name: aName, logo: e.teams.away.logo, id: e.teams.away.id },
            tournamentLogo: finalTournamentLogo, homeScore: finalHomeScore, awayScore: finalAwayScore, setScores: [], tournament: cleanTournamentName, timeObj: timeObj
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
            await triggerPushToStart(id); triggeredMatches.add(String(id));
        }
    }

    const hasLiveMatch = matches.some(m => m.status === 'inprogress');
    return { hasLiveMatch, nextMatchTimestamp: findNextMatchTime(globalFootballCache), hasAnyMatches: matches.length > 0 };
}

async function main() {
    if (!apnProvider) { console.error("⚠️ APNs başlatılamadı!"); return; }
    loadState();
    console.log("============================================================");
    console.log("🟢 J7 FUTBOL MİKROSERVİSİ BAŞLADI (10 DK. KOTA DOSTU)");
    console.log("============================================================");

    let iteration = 1; let lastPeriodicUpdate = 0;

    while (true) {
        try {
            const now = Date.now();
            console.log(`\n[⚽ İterasyon ${iteration}] ${new Date().toLocaleTimeString('tr-TR')}`);
            loadExternalBroadcasters();

            const d = new Date(now); const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
            const msSinceMidnight = now - startOfDay;
            // Sadece Gece 01:00'de tetiklenecek şekilde ayarlandı
            const TARGET_TIMES = [ 4 * 60 * 60 * 1000 ]; 
            let activeTarget = startOfDay - (23 * 60 * 60 * 1000);
            for (let i = TARGET_TIMES.length - 1; i >= 0; i--) if (msSinceMidnight >= TARGET_TIMES[i]) { activeTarget = startOfDay + TARGET_TIMES[i]; break; }

            const days4 = [getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)];
            const quickScanDates = [getTRDate(-1), getTRDate(0), getTRDate(1)]; 
            const todayOnly = [getTRDate(0)]; 

            if (lastPeriodicUpdate < activeTarget) {
                console.log("🔄 [PERİYODİK GÜNCELLEME] Futbol Ana Saat Dilimi Tetiklendi!");
                const footballResult = await updateFootball(days4);
                sportUpdateStatus.nextMatchTime = footballResult.nextMatchTimestamp;
                sportUpdateStatus.hasLiveMatch = footballResult.hasLiveMatch;
                
                // 🔥 Çifte Vuruş (Double Fetch) Hatası Çözümü: 
                // Periyodik güncelleme yapıldığında Hızlı Döngü'nün hemen peşinden uyanmasını engelliyoruz.
                lastPeriodicUpdate = now;
                sportUpdateStatus.lastQuickUpdate = now; 
            }

                        const isFootballActive = sportUpdateStatus.hasLiveMatch || (sportUpdateStatus.nextMatchTime && now >= (sportUpdateStatus.nextMatchTime - TEN_MIN_MS * 2));
            if (isFootballActive && (now - sportUpdateStatus.lastQuickUpdate >= TEN_MIN_MS)) {
                console.log("⚽ [HIZLI DÖNGÜ] Futbol maçları takip ediliyor (4 Dk. Modu)...");
                
                // Hangi günün maçını çekeceğimizi akıllıca belirliyoruz
                let targetDatesForLive = quickScanDates; 
                if (sportUpdateStatus.hasLiveMatch) {
                    let activeDates = new Set();
                    // Önbellekteki HANGİ GÜNÜN maçları canlıysa sadece o günleri listeye ekle
                    for (const match of globalFootballCache.values()) {
                        if (match.status === 'inprogress') activeDates.add(match.fixedDate);
                    }
                    if (activeDates.size === 0) activeDates.add(getTRDate(0));
                    targetDatesForLive = Array.from(activeDates);
                }

                const footResult = await updateFootball(targetDatesForLive); 
                sportUpdateStatus.lastQuickUpdate = now;
                sportUpdateStatus.hasLiveMatch = footResult.hasLiveMatch;
                sportUpdateStatus.nextMatchTime = footResult.nextMatchTimestamp;
            }


            let sleepTime = HOUR_MS; 
            if (isFootballActive) {
                sleepTime = TEN_MIN_MS;
                console.log("⚡ Futbol canlı maç var, kota koruması için 4 dakika sonra kontrol...");
            } else if (sportUpdateStatus.nextMatchTime) {
                let timeToNextFoot = sportUpdateStatus.nextMatchTime - now - TEN_MIN_MS;
                if (timeToNextFoot > 0 && timeToNextFoot < HOUR_MS) sleepTime = timeToNextFoot;
                if (sleepTime < TEN_MIN_MS) sleepTime = TEN_MIN_MS;
                console.log(`⏱️ Dinlenme modu: Sonraki futbol uyandırması ${Math.ceil(sleepTime / 60000)} dakika sonra...`);
            } else {
                console.log("🌙 Bugün için futbol maçı kalmadı. Saatlik rutin bekleniyor...");
            }

            await new Promise(r => setTimeout(r, sleepTime)); iteration++;
        } catch (e) { console.error("🚨 Hata:", e.message); await new Promise(r => setTimeout(r, TEN_MIN_MS)); }
    }
}
main();
