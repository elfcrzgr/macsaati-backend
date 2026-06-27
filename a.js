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
const globalBasketballCache = new Map(); // 🔥 BASKETBOL İÇİN EKLENDİ
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
// ⚙️ AYARLAR
// =========================================================================
const GITHUB_USER = "elfcrzgr";
const REPO_NAME = "macsaati-backend";

function logMatchesBySport(matchGroups) {
    for (const sportType of Object.keys(matchGroups)) {
        const sporekraniMatches = matchGroups[sportType].filter(
            matchInfo => matchInfo.source === "sporekrani"
        );
        if (sporekraniMatches.length === 0) continue;
        let icon = "🏟️";
        if (sportType === "futbol" || sportType === "football") icon = "⚽";
        if (sportType === "basketbol" || sportType === "basketball") icon = "🏀"; // 🔥 EKLENDİ
        console.log(`\n--------- ${icon} ${sportType.toUpperCase()} SPOREKRANI ---------`);
        for (const matchInfo of sporekraniMatches) {
            const { home, away, kanal } = matchInfo;
            console.log(`${icon} ${home} vs ${away} | Kanal: ${kanal} [SPOREKRANI]`);
            console.log('---------------------------------------------');
        }
    }
}

// =========================================================================
// 🌉 HARİCİ YAYINCI DOSYASI (SPOREKRANI) ENTEGRASYONU
// =========================================================================
let externalBroadcasters = {};

function loadExternalBroadcasters() {
    try {
        if (fs.existsSync('yayinci_bilgisi.json')) {
            const data = fs.readFileSync('yayinci_bilgisi.json', 'utf8');
            externalBroadcasters = JSON.parse(data);
        } else {
            externalBroadcasters = {};
        }
    } catch (e) {
        console.log("⚠️ yayinci_bilgisi.json okunamadı, kendi yayıncı ayarlarımız kullanılacak.");
        externalBroadcasters = {};
    }
}

function getBroadcasterWithFallback(sportCategory, dateStr, timeStr, homeName, awayName, fallback) {
    const cleanTime = (timeStr || "").replace(/\n?CANLI/, "").replace(/\n?MS/, "").replace('.', ':').trim();
    const [cH, cM] = cleanTime.split(':').map(Number);

    const toTR = (str) => str
        .replace(/İ/g, 'i')
        .replace(/I/g, 'i')
        .replace(/ı/g, 'i')
        .toLowerCase()
        .trim();

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

    const safeDates = getSafeDates(dateStr);

    for (const dateKey of safeDates) {
        const dayData = externalBroadcasters[dateKey];
        if (!dayData || !dayData.matches) continue;

        for (const m of dayData.matches) {
            if (m.spor && toTR(m.spor) === toTR(sportCategory)) {
                const mTime = (m.saat || "").replace('.', ':').trim();
                const [mH, mM] = mTime.split(':').map(Number);
                const mTitle = toTR(m.mac || "");

                const getCleanWords = (str) => {
                    return str
                        .replace(/İ/g, 'i').replace(/I/g, 'i')
                        .replace(/Ğ/g, 'g').replace(/ğ/g, 'g')
                        .replace(/Ü/g, 'u').replace(/ü/g, 'u')
                        .replace(/Ş/g, 's').replace(/ş/g, 's')
                        .replace(/Ö/g, 'o').replace(/ö/g, 'o')
                        .replace(/Ç/g, 'c').replace(/ç/g, 'c')
                        .replace(/ı/g, 'i')
                        .toLowerCase()
                        .replace(/[^a-z0-9]/g, ' ')
                        .split(' ')
                        .map(w => w.trim())
                        .filter(w => w.length >= 3);
                };

                const hWords = getCleanWords(hName);
                const aWords = getCleanWords(aName);

                const matchHome = hWords.length === 0 || hWords.some(w => mTitle.includes(w));
                const matchAway = aWords.length === 0 || aWords.some(w => mTitle.includes(w));

                const matchScore = (matchHome ? 1 : 0) + (matchAway ? 1 : 0);

                let diff = 9999;
                if (mTime === cleanTime) {
                    diff = 0;
                } else if (!isNaN(mH) && !isNaN(cH) && !isNaN(mM) && !isNaN(cM)) {
                    diff = Math.abs((mH * 60 + mM) - (cH * 60 + cM));
                    if (diff > 1000) diff = Math.abs(diff - 1440);
                }

                if (matchScore === 2 && diff <= 120) {
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
// 🛠️ YARDIMCI FONKSİYONLAR VE API BAĞLANTISI
// =========================================================================
async function uploadToFirebase(sportName, data) {
    try {
        const db = admin.database();
        const ref = db.ref(`matches_${sportName}`);
        await ref.set(data);
        console.log(`✅ [FIREBASE] ${sportName.toUpperCase()} başarıyla güncellendi!`);
    } catch (error) {
        console.error(`❌ [FIREBASE] ${sportName} Hata:`, error.message);
    }
}

// 🔥 FUTBOL İÇİN FETCH FONKSİYONU
async function fetchData(url) {
    try {
        const directUrl = url.replace('api-football-v1.p.rapidapi.com/v3', 'v3.football.api-sports.io');
        const API_SPORTS_KEY = '870e5a7510c80ee4e84491d6c891bfe7'; 

        const response = await axios.get(directUrl, {
            headers: {
                'x-apisports-key': API_SPORTS_KEY
            },
            timeout: 10000 
        });

        if (response.data && response.data.response) {
            return response.data.response;
        }
        return [];
    } catch (e) {
        const status = e.response ? e.response.status : null;
        if (status === 403) {
            console.error(`❌ API-Football Hatası: HTTP 403`);
        } else if (status === 429) {
            console.error(`❌ API-Football Hatası: HTTP 429`);
        } else {
            console.error(`❌ API-Football Hatası: HTTP ${status || e.message}`);
        }
        return null;
    }
}

// 🔥 BASKETBOL İÇİN ÖZEL FETCH FONKSİYONU
async function fetchBasketballData(url) {
    try {
        const API_SPORTS_KEY = '870e5a7510c80ee4e84491d6c891bfe7'; 
        const response = await axios.get(url, {
            headers: {
                'x-apisports-key': API_SPORTS_KEY
            },
            timeout: 10000 
        });
        if (response.data && response.data.response) {
            return response.data.response;
        }
        return [];
    } catch (e) {
        console.error(`❌ API-Basketball Hatası: HTTP ${e.response ? e.response.status : e.message}`);
        return null;
    }
}

const getTRDate = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
};

// =========================================================================
// ⚽ TRANSLATION (ÇEVİRİ) YAPILANDIRMASI (SENİN ORİJİNAL KODUN)
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
    "curaçao": "Curaçao", "curacao": "Curaçao", "british virgin islands": "Britanya Virjin Adaları",
    "dominican republic": "Dominik Cumhuriyeti", "el salvador": "El Salvador",
    "cayman islands": "Cayman Adaları", "nicaragua": "Nikaragua", "haiti": "Haiti",
    "senegal": "Senegal", "morocco": "Fas", "egypt": "Mısır", "tunisia": "Tunus", "nigeria": "Nijerya",
    "cameroon": "Kamerun", "ghana": "Gana", "algeria": "Cezayir", "south africa": "Güney Afrika", "mali": "Mali",
    "cabo verde": "Yeşil Burun Adaları", "cape verde": "Yeşil Burun Adaları", "madagascar": "Madagaskar",
    "dr congo": "Demokratik Kongo", "democratic republic of the congo": "Demokratik Kongo", "guinea": "Gine",
    "lesotho": "Lesotho", "kenya": "Kenya", "benin": "Benin", "niger": "Nijer",
    "sierra leone": "Sierra Leone", "liberia": "Liberya",
    "ivory coast": "Fildişi Sahili", "cote d'ivoire": "Fildişi Sahili", "côte d'ivoire": "Fildişi Sahili",
    "south korea": "Güney Kore", "japan": "Japonya", "iran": "İran", "saudi arabia": "Suudi Arabistan",
    "qatar": "Katar", "australia": "Avustralya", "new zealand": "Yeni Zelanda", "china": "Çin",
    "india": "Hindistan", "united arab emirates": "BAE", "uae": "BAE", "iraq": "Irak", "uzbekistan": "Özbekistan",
    "jordan": "Ürdün", "maldives": "Maldivler", "afghanistan": "Afganistan", "philippines": "Filipinler",
    "guam": "Guam", "bangladesh": "Bangladeş", "pakistan": "Pakistan", "cambodia": "Kamboçya",
    "bhutan": "Butan", "indonesia": "Endonezya", "oman": "Umman", "tajikistan": "Tacikistan",
    "syria": "Suriye", "bahrain": "Bahreyn", "hong kong": "Hong Kong", "mongolia": "Moğolistan",
    "thailand": "Tayland", "kuwait": "Kuveyt", "myanmar": "Myanmar"
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

// ⚠️ YENİ API-FOOTBALL LİG ID'LERİ
const ELITE_FOOT_IDS = [39, 140, 78, 135, 61, 203, 2, 3, 848, 1, 4, 9, 15, 66, 137, 71]; 
const REGULAR_FOOT_IDS = [204, 205, 206, 40, 41, 141, 136, 62, 79, 72, 119, 144, 253, 283];
const NATIONAL_LEAGUES = [1, 4, 9];
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
    39: 17,    // İngiltere Premier Lig
    140: 8,    // İspanya La Liga
    78: 35,    // Almanya Bundesliga
    135: 23,   // İtalya Serie A
    61: 34,    // Fransa Ligue 1
    203: 52,   // Türkiye Süper Lig
    204: 98,   // Trendyol 1. Lig
    205: 97,   // TFF 2. Lig
    206: 938,  // Türkiye Kupası
    2: 7,      // Şampiyonlar Ligi
    3: 679,    // Avrupa Ligi
    848: 17015,// Konferans Ligi
    1: 16,     // Dünya Kupası
    4: 1,      // UEFA EURO
    9: 133     // Copa America
};

const getFootBroadcaster = (leagueId, hName, aName) => {
    const hn = (hName || "").toLowerCase();
    const an = (aName || "").toLowerCase();
    const isTurkey = hn.includes("türkiye") || an.includes("türkiye") || hn.includes("turkey") || an.includes("turkey");

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
            notification: {
                title: title,
                body: body
            },
            data: {
                matchId: String(id),
                type: "match_update",
                title: String(title),
                body: String(body),
                imageUrl: imageUrl || ""
            },
            apns: {
                headers: {
                    "apns-push-type": "alert",
                    "apns-priority": "10"
                },
                payload: {
                    aps: {
                        alert: { title: title, body: body },
                        "mutable-content": 1,
                        sound: "default",
                        category: "MATCH_UPDATE"
                    },
                    matchId: String(id),
                    type: "match_update"
                }
            }
        };

        if (matchData) {
            const hName = String(matchData.homeTeam?.name || "Ev Sahibi");
            const aName = String(matchData.awayTeam?.name || "Deplasman");

            payload.data.homeName = hName;
            payload.data.awayName = aName;
            payload.data.homeScore = String(matchData.homeScore || "-");
            payload.data.awayScore = String(matchData.awayScore || "-");
            payload.data.homeLogo = String(matchData.homeTeam?.logo || "");
            payload.data.awayLogo = String(matchData.awayTeam?.logo || "");
            payload.data.status = String(matchData.status || "inprogress");
            payload.data.timeOrMinute = String(matchData.liveMinute || "");

            payload.apns.payload.homeName = hName;
            payload.apns.payload.awayName = aName;
            payload.apns.payload.homeLogo = String(matchData.homeTeam?.logo || '');
            payload.apns.payload.awayLogo = String(matchData.awayTeam?.logo || '');
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
            } else {
                console.log(`✅ [START BAŞARILI] Sinyal Apple'a ulaştı!`);
            }
        } catch (e) {
            console.error("❌ İletim Hatası:", e);
        }
    }
}

async function checkAndSendNotifications(newMatches) {
    for (const match of newMatches) {
        const matchIdStr = String(match.id);

        const prev = previousMatchStates.get(matchIdStr) || {
            status: null, homeScore: 0, awayScore: 0,
            hasNotifiedStart: false, hasNotifiedHT: false, hasNotifiedSH: false, hasNotifiedFinished: false,
            hasNotifiedInjuryTime1: false, hasNotifiedInjuryTime2: false,
            hasNotifiedETWait: false, hasNotifiedETHT: false, hasNotifiedETSH: false, hasNotifiedPenalties: false,
            lastMinute: 0,
            liveMinuteStr: ""
        };

        let currH = parseInt(match.homeScore) || 0;
        let currA = parseInt(match.awayScore) || 0;

        const notifAwayScore = String(match.awayScore).replace('\n', ' ');
        const liveMin = match.liveMinute || "";
        const tObj = match.timeObj || {};
        let currentMinNum = tObj.currentMinute || 0;

        if (match.status === 'inprogress' && currentMinNum > 0 && prev.lastMinute > 0 && currentMinNum < prev.lastMinute) {
            console.log(`🛡️ CDN HATASI ENGELLENDİ: ${match.homeTeam.name} dakikası geriye gitti. Eski veri reddedildi.`);
            currH = prev.homeScore;
            currA = prev.awayScore;
            match.homeScore = String(currH);
            match.awayScore = String(currA);
            currentMinNum = prev.lastMinute;
        }

        // =========================================================
        // 🚀 LIVE ACTIVITY SESSİZ PUSH
        // =========================================================
        const statusType = match.status;
        const isLive = statusType === 'inprogress';
        const isFinished = ['finished', 'ended', 'closed'].includes(statusType);

        const minuteChanged = liveMin !== prev.liveMinuteStr;
        const scoreChanged = currH !== prev.homeScore || currA !== prev.awayScore;
        const statusChanged = statusType !== prev.status;

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
                            "content-state": {
                                homeScore: currH,
                                awayScore: currA,
                                matchMinute: isFinished ? "MS" : String(liveMin)
                            }
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
                            const err = result.failed[0];
                            const errorReason = err.response ? err.response.reason : err.error;
                            
                            if (errorReason === 'BadDeviceToken' || errorReason === 'Unregistered') {
                                await admin.database().ref(`live_activity_tokens/${matchIdStr}/${deviceToken}`).remove();
                                console.log(`🗑️ Geçersiz kilit ekranı token'ı temizlendi.`);
                            }
                        }
                    } catch (e) {
                        console.error("APNs Bağlantı Hatası:", e);
                    }
                });

                await Promise.all(promises);
                console.log(`📲 [LIVE ACTIVITY APPLE APNS] ${match.homeTeam?.name} | Dk: ${liveMin} | ${tokenList.length} aktif kilit ekranı işlem gördü.`);
            }
        }

        // =========================================================
        // GOL VE NORMAL MAÇ BİLDİRİM KONTROLLERİ
        // =========================================================
        const appTitle = "Maç Saati";
        const whistleIconUrl = "https://img.icons8.com/color/96/whistle.png";
        
        if (match.status === 'inprogress' && !prev.hasNotifiedStart) {
            const bodyText = `⚽ Maç Başladı!\n${match.homeTeam.name} - ${match.awayTeam.name}`;
            await sendPush(matchIdStr, appTitle, bodyText, null, match);
            prev.hasNotifiedStart = true;
        } else if (match.status === 'inprogress' && (liveMin === "İY" || match.statusCode === 31) && !prev.hasNotifiedHT) {
            const bodyText = `⏱️ İlk Yarı Sonucu\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`;
            await sendPush(matchIdStr, appTitle, bodyText, whistleIconUrl, match);
            prev.hasNotifiedHT = true;
        } else if (match.status === 'inprogress' && prev.hasNotifiedHT && (liveMin !== "İY" && match.statusCode !== 31) && !prev.hasNotifiedSH && match.statusCode === 7) {
            const bodyText = `▶️ İkinci Yarı Başladı\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`;
            await sendPush(matchIdStr, appTitle, bodyText, whistleIconUrl, match);
            prev.hasNotifiedSH = true;
        } else if (['finished', 'ended', 'closed'].includes(match.status) && !prev.hasNotifiedFinished) {
            if (prev.status === 'inprogress') {
                let bodyText = `🏁 Maç Bitti\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`;
                await sendPush(matchIdStr, appTitle, bodyText, null, match);
            }
            prev.hasNotifiedFinished = true;
        }

        if (match.status === 'inprogress' && prev.status !== null) {
            if (prev.homeScore !== currH || prev.awayScore !== currA) {
                const isGoal = (currH + currA) > (prev.homeScore + prev.awayScore);

                if (isGoal) {
                    const homeScored = currH > prev.homeScore;
                    const scoringTeamLogo = homeScored ? match.homeTeam.logo : match.awayTeam.logo;
                    const bodyText = `⚽ Gol! (${liveMin})\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`;

                    await sendPush(matchIdStr, appTitle, bodyText, scoringTeamLogo, match);
                    pendingGoalCancel.delete(matchIdStr);
                }
            }
        }

        previousMatchStates.set(matchIdStr, {
            status: match.status, homeScore: currH, awayScore: currA,
            hasNotifiedStart: prev.hasNotifiedStart,
            hasNotifiedHT: prev.hasNotifiedHT,
            hasNotifiedSH: prev.hasNotifiedSH,
            hasNotifiedFinished: prev.hasNotifiedFinished,
            lastMinute: Math.max(currentMinNum, prev.lastMinute || 0),
            liveMinuteStr: liveMin,
            date: match.fixedDate || getTRDate(0)
        });
    }

    saveState();
}

// =========================================================================
// ⚽ FUTBOL GÜNCELLEME (API-FOOTBALL UYUMLU)
// =========================================================================
async function updateFootball(targetDates) {
    console.log(`⚽ Futbol verisi API-Football'dan çekiliyor... (Gün sayısı: ${targetDates.length})`);

    let allFixtures = [];
    let apiSuccessCount = 0;

    for (const date of targetDates) {
        const url = `https://api-football-v1.p.rapidapi.com/v3/fixtures?date=${date}`;
        const fixtures = await fetchData(url);
        
        if (fixtures !== null) {
            allFixtures.push(...fixtures.filter(f => ALL_FOOT_TARGETS.includes(f.league.id)));
            apiSuccessCount++;
        }

        await new Promise(r => setTimeout(r, 2000));
    }

    if (apiSuccessCount === 0) {
        console.log("⚠️ API'den hiçbir veri alınamadı! (Hata veya Kota aşımı). Mevcut liste korunuyor...");
        return; 
    }

    const validDates = [getTRDate(-2), getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2), getTRDate(3)];
    for (const [id, state] of previousMatchStates.entries()) {
        if (state.date && !validDates.includes(state.date)) {
            if (state.status !== 'inprogress') {
                previousMatchStates.delete(id);
            }
        }
    }
    saveState();

    for (const [id, match] of globalFootballCache.entries()) {
        if (!validDates.includes(match.fixedDate)) {
            globalFootballCache.delete(id);
        }
    }

    let futbolMatchesLog = [];

    allFixtures.forEach(e => {
        // 🔥 ID YAKALAMA SATIRLARI
        console.log(`🔍 MAÇ: ${e.teams.home.name} vs ${e.teams.away.name} | MAÇ ID: ${e.fixture.id} | HOME ID: ${e.teams.home.id} | AWAY ID: ${e.teams.away.id}`);

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

        // 🔥 LOGO KÖPRÜSÜ (MAPPER) DEVREDE:
        const repoLogoId = tournamentLogoMapper[leagueId];
        const finalTournamentLogo = repoLogoId 
            ? `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/${repoLogoId}.png`
            : e.league.logo;

        // TAKIM LOGO MAPPER'I EKSİKTİ, GİTHUB YOLU İÇİN GERİ EKLENDİ
        const mappedHomeId = teamIdMapper ? (teamIdMapper[e.teams.home.id] || e.teams.home.id) : e.teams.home.id;
        const mappedAwayId = teamIdMapper ? (teamIdMapper[e.teams.away.id] || e.teams.away.id) : e.teams.away.id;

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
            homeTeam: { name: hName, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${mappedHomeId}.png`, id: e.teams.home.id },
            awayTeam: { name: aName, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${mappedAwayId}.png`, id: e.teams.away.id },
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
}

// =========================================================================
// 🏀 BASKETBOL GÜNCELLEME (API-BASKETBALL UYUMLU) 🔥 YENİ EKLENDİ
// =========================================================================
const TARGET_BASKET_LEAGUES = [12, 120]; // 12: NBA, 120: Euroleague
const baskTeamIdMapper = {};

async function updateBasketball(targetDates) {
    console.log(`🏀 Basketbol API-Sports'tan çekiliyor... (Gün sayısı: ${targetDates.length})`);
    
    let allGames = [];
    let successfulDates = [];

    for (const date of targetDates) {
        const url = `https://v1.basketball.api-sports.io/games?date=${date}`;
        const games = await fetchBasketballData(url);
        
        if (games !== null && games.length > 0) {
            allGames.push(...games);
            successfulDates.push(date);
        }
        await new Promise(r => setTimeout(r, 2000));
    }

    if (successfulDates.length === 0) {
        console.log("⚠️ Basketbol API'den veri alınamadı. Mevcut liste korunuyor...");
        return;
    }

    const validDates = [getTRDate(-2), getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2), getTRDate(3)];
    for (const [id, match] of globalBasketballCache.entries()) {
        if (!validDates.includes(match.fixedDate)) {
            globalBasketballCache.delete(id);
        }
    }

    let basketbolMatchesLog = [];
    
    allGames.forEach(g => {
        if (targetDates.includes(getTRDate(0))) {
            console.log(`🏀 LİG: ${g.league.name} (ID: ${g.league.id}) | MAÇ: ${g.teams.home.name} vs ${g.teams.away.name} | API ID: ${g.teams.home.id}`);
        }
    });

    for (const g of allGames) {
        // Şimdilik filtre kapalı, istediklerini yakalayınca burayı açabilirsin:
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

        // Çeviri uygulanıyor
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
}

// =========================================================================
// 🆕 AKILLI DÖNGÜ (SMART POLLING) - KOTA KORUYUCU
// =========================================================================
async function main() {
    if (!apnProvider) {
        console.error("⚠️ KRİTİK HATA: APNs Sağlayıcı başlatılamadı!");
        return;
    }

    loadState();
    console.log("============================================================");
    console.log("🟢 J7 AKILLI SUNUCU BAŞLADI (API-SPORTS - FUTBOL & BASKETBOL)");
    console.log("============================================================");

    while (true) {
        try {
            loadExternalBroadcasters();
            const todayStr = getTRDate(0);

            // Futbol ve Basketbol önbellek kontrolü
            let hasTodayFootball = false;
            for (const match of globalFootballCache.values()) {
                if (match.fixedDate === todayStr) { hasTodayFootball = true; break; }
            }
            
            let hasTodayBasketball = false;
            for (const match of globalBasketballCache.values()) {
                if (match.fixedDate === todayStr) { hasTodayBasketball = true; break; }
            }

            if (!hasTodayFootball || !hasTodayBasketball) {
                console.log(`⏰ Günlük program eksik. 4 günlük ana fikstür çekiliyor...`);
                await updateFootball([getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)]);
                await updateBasketball([getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)]);
            }

            let hasLive = false;
            let nextMatchTimestamp = null;
            const now = Date.now();

            // Futbol Zaman Hesaplaması
            for (const match of globalFootballCache.values()) {
                if (match.status === 'inprogress') hasLive = true;
                if (match.status === 'notstarted' && match.timestamp > now) {
                    if (!nextMatchTimestamp || match.timestamp < nextMatchTimestamp) {
                        nextMatchTimestamp = match.timestamp;
                    }
                }
            }
            
            // Basketbol Zaman Hesaplaması
            for (const match of globalBasketballCache.values()) {
                if (match.status === 'inprogress') hasLive = true;
                if (match.status === 'notstarted' && match.timestamp > now) {
                    if (!nextMatchTimestamp || match.timestamp < nextMatchTimestamp) {
                        nextMatchTimestamp = match.timestamp;
                    }
                }
            }

            if (hasLive) {
                console.log(`🔥 Canlı maç var! 10 dakika sonra sadece bugünün skorları yenilenecek...`);
                await new Promise(r => setTimeout(r, 10 * 60000));
                await updateFootball([todayStr]); 
                await updateBasketball([todayStr]);
            } else {
                if (nextMatchTimestamp) {
                    let msUntilNextMatch = nextMatchTimestamp - Date.now() - (10 * 60000); 
                    
                    if (msUntilNextMatch > 0) {
                        if (msUntilNextMatch > 6 * 60 * 60000) msUntilNextMatch = 6 * 60 * 60000;
                        console.log(`💤 Hiç maç yok. Sistem ${Math.round(msUntilNextMatch / 60000)} dakika uykuya geçiyor...`);
                        await new Promise(r => setTimeout(r, msUntilNextMatch));
                    } else {
                        console.log(`⏳ Sıradaki maç başlamak üzere, 1 dakika bekleniyor...`);
                        await new Promise(r => setTimeout(r, 60000));
                        await updateFootball([todayStr]);
                        await updateBasketball([todayStr]);
                    }
                } else {
                    console.log(`🌙 Gece modu. Bugün/Yarın maç kalmadı. 6 saat uyunuyor...`);
                    globalFootballCache.clear(); 
                    globalBasketballCache.clear();
                    await new Promise(r => setTimeout(r, 6 * 60 * 60000));
                }
            }
        } catch (e) {
            console.error("🚨 Ana Döngü Hatası:", e.message);
            await new Promise(r => setTimeout(r, 60000)); 
        }
    }
}

main();    allFixtures.forEach(e => {
        const shortStatus = e.fixture.status.short;
        if (['PST', 'CANC', 'ABD', 'AWD', 'WO'].includes(shortStatus)) return;

        let status = 'notstarted';
        let liveMinute = "";
        let timeObj = {};

        if (['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE'].includes(shortStatus)) {
            status = 'inprogress';
            if (shortStatus === 'HT') liveMinute = "İY";
            else if (shortStatus === 'BT') liveMinute = "UZ İY";
            else if (shortStatus === 'P') liveMinute = "PEN";
            else liveMinute = e.fixture.status.elapsed ? `${e.fixture.status.elapsed}'` : "Canlı";
            timeObj = { currentMinute: e.fixture.status.elapsed || 0 };
        } 
        else if (['FT', 'AET', 'PEN'].includes(shortStatus)) status = 'finished';

        const leagueId = e.league.id;
        const hName = e.teams.home.name;
        const aName = e.teams.away.name;

        const dateTR = new Date(e.fixture.timestamp * 1000);
        const dayTR = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        const timeString = dateTR.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

        const result = getBroadcasterWithFallback("futbol", dayTR, timeString, hName, aName, "Resmi Yayıncı");
        futbolMatchesLog.push({ home: hName, away: aName, kanal: result.kanal, source: result.source });

        const homeId = teamIdMapper[e.teams.home.id] || e.teams.home.id;
        const awayId = teamIdMapper[e.teams.away.id] || e.teams.away.id;
        
        globalFootballCache.set(e.fixture.id, {
            id: e.fixture.id,
            status: status,
            liveMinute: liveMinute,
            fixedDate: dayTR,
            fixedTime: timeString,
            timestamp: e.fixture.timestamp * 1000,
            broadcaster: result.kanal,
            homeTeam: { name: hName, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${homeId}.png`, id: e.teams.home.id },
            awayTeam: { name: aName, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${awayId}.png`, id: e.teams.away.id },
            tournamentLogo: e.league.logo, // Artık API-Sports'un kendi logosu
            homeScore: (status === 'inprogress' || status === 'finished') ? String(e.goals.home ?? "0") : "-",
            awayScore: (status === 'inprogress' || status === 'finished') ? String(e.goals.away ?? "0") : "-",
            tournament: e.league.name,
            timeObj: timeObj
        });
    });

    const matches = Array.from(globalFootballCache.values()).sort((a, b) => a.timestamp - b.timestamp);
    await uploadToFirebase("football", { success: true, lastUpdate: new Date().toLocaleTimeString('tr-TR'), matches });
    
    logMatchesBySport({ futbol: futbolMatchesLog });
    
    const hasLiveMatch = matches.some(m => m.status === 'inprogress');
    return { hasLiveMatch, nextMatchTimestamp: findNextMatchTime(globalFootballCache), hasAnyMatches: matches.length > 0 };
}


// =========================================================================
// 🏀 BASKETBOL GÜNCELLEME (API-BASKETBALL)
// =========================================================================
const TARGET_BASKET_LEAGUES = [12, 120]; // İstediğin Basketbol API-Sports Lig ID'lerini buraya ekle (12: NBA, 120: Euroleague)
const baskTeamIdMapper = {};

async function updateBasketball(targetDates) {
    console.log(`🏀 Basketbol API-Sports'tan çekiliyor...`);
    const validDates = [getTRDate(-2), getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2), getTRDate(3)];

    let allGames = [];
    let successfulDates = [];

    for (const date of targetDates) {
        const url = `https://v1.basketball.api-sports.io/games?date=${date}`;
        const games = await fetchApiSports(url);
        if (games && games.length > 0) {
            allGames.push(...games);
            successfulDates.push(date);
        }
        await new Promise(r => setTimeout(r, 2000));
    }

    if (successfulDates.length === 0) {
        console.log("⚠️ Basketbol API veri döndürmedi.");
        return { nextMatchTimestamp: sportUpdateStatus.basketball.nextMatchTime, hasAnyMatches: globalBasketballCache.size > 0 };
    }

    for (const [id, match] of globalBasketballCache.entries()) {
        if (!validDates.includes(match.fixedDate)) globalBasketballCache.delete(id);
    }

    let basketbolMatchesLog = [];
    
    // 🔥 LOG: Lig ve Takım ID'leri (Gerektiğinde TARGET_BASKET_LEAGUES'i güncellemek için)
    allGames.forEach(g => {
        if (targetDates.includes(getTRDate(0))) {
            console.log(`🏀 LİG: ${g.league.name} (ID: ${g.league.id}) | MAÇ: ${g.teams.home.name} vs ${g.teams.away.name} | API ID: ${g.teams.home.id}`);
        }
    });

    for (const g of allGames) {
        // Şimdilik filtre kapalı, logda gördüğün ligleri TARGET_BASKET_LEAGUES dizisine ekle sonra burayı açarsın:
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

        const result = getBroadcasterWithFallback("basketbol", dayStr, timeString, g.teams.home.name, g.teams.away.name, "Resmi Yayıncı");
        basketbolMatchesLog.push({ home: g.teams.home.name, away: g.teams.away.name, kanal: result.kanal, source: result.source });

        globalBasketballCache.set(g.id, {
            id: g.id,
            isElite: true,
            status: statusType,
            fixedDate: dayStr,
            fixedTime: timeString,
            timestamp: g.timestamp * 1000,
            broadcaster: result.kanal,
            homeTeam: { name: g.teams.home.name, logo: g.teams.home.logo, id: g.teams.home.id }, // Direkt API-Sports'un logosu
            awayTeam: { name: g.teams.away.name, logo: g.teams.away.logo, id: g.teams.away.id }, // Direkt API-Sports'un logosu
            tournamentLogo: g.league.logo, // Direkt API-Sports'un turnuva logosu
            homeScore: (isInProgress || isFinished) ? String(g.scores.home.total ?? "0") : "-",
            awayScore: (isInProgress || isFinished) ? String(g.scores.away.total ?? "0") : "-",
            tournament: g.league.name
        });
    }

    const finalMatches = Array.from(globalBasketballCache.values()).sort((a, b) => a.timestamp - b.timestamp);
    await uploadToFirebase("basketball", { success: true, matches: finalMatches });
    
    logMatchesBySport({ basketbol: basketbolMatchesLog });
    const hasLiveMatch = finalMatches.some(m => m.status === 'inprogress');
    return { hasLiveMatch, nextMatchTimestamp: findNextMatchTime(globalBasketballCache), hasAnyMatches: finalMatches.length > 0 };
}


// =========================================================================
// 🎾 TENİS GÜNCELLEME (SOFASCORE - ESKİ HALİYLE KORUNDU)
// =========================================================================
async function updateTennis(targetDates) {
    console.log(`🎾 Tenis Sofascore'dan güncelleniyor... (Taranan gün: ${targetDates.length})`);
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
// 🏎️ FORMULA 1 GÜNCELLEME (ERGAST/JOLPI - ESKİ HALİYLE KORUNDU)
// =========================================================================
async function updateF1() {
    console.log(`🏎️ Formula 1 güncelleniyor...`);
    try {
        const response = await fetchSofascore('https://api.jolpi.ca/ergast/f1/current.json');
        if (!response) return;
        const races = response.MRData?.RaceTable?.Races || [];
        const finalEvents = [];

        races.forEach(race => {
            const addSession = (sessionName, dateStr, timeStr) => {
                if (!dateStr || !timeStr) return;
                const dateObj = new Date(`${dateStr}T${timeStr}`);
                finalEvents.push({
                    id: `${race.round}_${sessionName.replace(/\s/g, '')}`,
                    fixedDate: dateObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' }),
                    fixedTime: dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
                    timestamp: dateObj.getTime(),
                    broadcaster: "beIN Sports / F1 TV",
                    grandPrix: race.raceName,
                    sessionName: sessionName
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
        await uploadToFirebase("f1", { success: true, events: finalEvents });
        console.log(`  ✅ F1 güncellemesi tamamlandı.`);
    } catch (error) { console.error(`   ⚠️ F1 hatası: ${error.message}`); }
}


// =========================================================================
// 🆕 ANA DÖNGÜ
// =========================================================================
async function main() {
    if (!apnProvider) {
        console.error("⚠️ KRİTİK HATA: APNs Sağlayıcı başlatılamadı!");
        return;
    }

    loadState();
    console.log("============================================================");
    console.log("🟢 J7 CANLI SUNUCU BAŞLADI (API-SPORTS ENTEGRE, V8)");
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

            // 1. ANA PERİYODİK GÜNCELLEME (Günde 4 kez tüm sporlar 4 günlük veri çeker)
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

            // 2. FUTBOL HIZLI GÜNCELLEME DÖNGÜSÜ
            if (sportUpdateStatus.football.hasLiveMatch) {
                if (now - sportUpdateStatus.football.lastQuickUpdate >= MINUTE_MS) {
                    console.log("⚽ [HIZLI DÖNGÜ] Canlı futbol maçı var - Sadece bugün güncelleniyor...");
                    const footResult = await updateFootball(todayOnly); 
                    sportUpdateStatus.football.lastQuickUpdate = now;
                    sportUpdateStatus.football.hasLiveMatch = footResult.hasLiveMatch;
                    sportUpdateStatus.football.nextMatchTime = footResult.nextMatchTimestamp;
                }
            } else if (sportUpdateStatus.football.nextMatchTime && now >= (sportUpdateStatus.football.nextMatchTime - MINUTE_MS * 1.1)) {
                if (now - sportUpdateStatus.football.lastQuickUpdate >= MINUTE_MS) {
                    const footResult = await updateFootball(quickScanDates); 
                    sportUpdateStatus.football.lastQuickUpdate = now;
                    sportUpdateStatus.football.hasLiveMatch = footResult.hasLiveMatch;
                    sportUpdateStatus.football.nextMatchTime = footResult.nextMatchTimestamp;
                }
            }

            // 3. BASKETBOL HIZLI GÜNCELLEME DÖNGÜSÜ
            const hasUpcomingBasketball = sportUpdateStatus.basketball.nextMatchTime && now >= (sportUpdateStatus.basketball.nextMatchTime - MINUTE_MS * 11);
            if ((sportUpdateStatus.basketball.hasLiveMatch || hasUpcomingBasketball) && now - sportUpdateStatus.basketball.lastQuickUpdate >= TEN_MIN_MS) {
                console.log("🏀 [HIZLI DÖNGÜ] Basketbol verileri güncelleniyor...");
                const basketResult = await updateBasketball(quickScanDates);
                sportUpdateStatus.basketball.lastQuickUpdate = now;
                sportUpdateStatus.basketball.nextMatchTime = basketResult.nextMatchTimestamp;
                sportUpdateStatus.basketball.hasLiveMatch = basketResult.hasLiveMatch;
            }

            // 4. TENİS HIZLI GÜNCELLEME DÖNGÜSÜ
            const hasUpcomingTennis = sportUpdateStatus.tennis.nextMatchTime && now >= (sportUpdateStatus.tennis.nextMatchTime - MINUTE_MS * 11);
            if ((sportUpdateStatus.tennis.hasLiveMatch || hasUpcomingTennis) && now - sportUpdateStatus.tennis.lastQuickUpdate >= TEN_MIN_MS) {
                console.log("🎾 [HIZLI DÖNGÜ] Tenis verileri güncelleniyor...");
                const tennisResult = await updateTennis(quickScanDates);
                sportUpdateStatus.tennis.lastQuickUpdate = now;
                sportUpdateStatus.tennis.nextMatchTime = tennisResult.nextMatchTimestamp;
                sportUpdateStatus.tennis.hasLiveMatch = tennisResult.hasLiveMatch;
            }

            // 5. UYKU HESAPLAMASI
            let sleepTime = TEN_MIN_MS;
            const isFootballActive = sportUpdateStatus.football.hasLiveMatch || (sportUpdateStatus.football.nextMatchTime && now >= (sportUpdateStatus.football.nextMatchTime - MINUTE_MS * 12));

            if (isFootballActive) {
                sleepTime = MINUTE_MS;
                console.log("⚡ Aktif futbol takibi, 1 dakika sonra kontrol...");
            } else if (sportUpdateStatus.basketball.hasLiveMatch || hasUpcomingBasketball || sportUpdateStatus.tennis.hasLiveMatch || hasUpcomingTennis) {
                let timeToNextBask = sportUpdateStatus.basketball.hasLiveMatch || hasUpcomingBasketball ? TEN_MIN_MS - (now - sportUpdateStatus.basketball.lastQuickUpdate) : TEN_MIN_MS;
                let timeToNextTen = sportUpdateStatus.tennis.hasLiveMatch || hasUpcomingTennis ? TEN_MIN_MS - (now - sportUpdateStatus.tennis.lastQuickUpdate) : TEN_MIN_MS;
                
                sleepTime = Math.min(timeToNextBask, timeToNextTen);
                if (sleepTime < MINUTE_MS) sleepTime = MINUTE_MS;
                console.log(`⏱️ Basketbol/Tenis takibi: Sonraki uyandırma ${Math.ceil(sleepTime / 60000)} dakika sonra...`);
            } else {
                console.log("💤 Hiç maç yok, 10 dakika derin uyku modu...");
            }

            await new Promise(r => setTimeout(r, sleepTime));
            iteration++;

        } catch (e) {
            console.error("🚨 Hata:", e.message);
            await new Promise(r => setTimeout(r, MINUTE_MS));
        }
    }
}

main();
