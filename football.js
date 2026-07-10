const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const apn = require('apn');

// =========================================================================
// 🔥 AYARLAR VE ÇALIŞMA ORTAMI
// =========================================================================
const IS_PRODUCTION = false; 
const STATE_FILE = 'futbol_states.json'; // ⚠️ BAĞIMSIZ HAFIZA
const GITHUB_USER = "elfcrzgr";
const REPO_NAME = "macsaati-backend";
const MINUTE_MS = 60000;

// O gün maçı KESİN OLMAYAN futbol ligleri (Akıllı Tarama Kara Listesi)
const emptyLeaguesCache = new Map();

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

function logMatchesBySport(matchGroups) {
    for (const sportType of Object.keys(matchGroups)) {
        const sporekraniMatches = matchGroups[sportType].filter(matchInfo => matchInfo.source === "sporekrani");
        if (sporekraniMatches.length === 0) continue;
        console.log(`\n--------- ⚽ FUTBOL SPOREKRANI ---------`);
        for (const matchInfo of sporekraniMatches) {
            const { home, away, kanal } = matchInfo;
            console.log(`⚽ ${home} vs ${away} | Kanal: ${kanal} [SPOREKRANI]`);
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
            if (m.spor && normalizeStr(m.spor) === normalizeStr(sportCategory)) {
                const mTime = (m.saat || "").replace('.', ':').trim();
                const [mH, mM] = mTime.split(':').map(Number);
                const mTitleClean = normalizeStr(m.mac);

                // 🚀 HATA ÇÖZÜMÜ: FC, SV gibi kısa kelimeler sıfırlandıysa eşleşme sayma
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
// 🛠️ YARDIMCI FONKSİYONLAR
// =========================================================================
async function uploadToFirebase(data) {
    try {
        const db = firebaseApp.database();
        const ref = db.ref(`matches_football`);
        await ref.set(data);
    } catch (error) {
        console.error(`❌ [FIREBASE-FUTBOL] Hata:`, error.message);
    }
}

async function fetchData(url) {
    try {
        const delay = Math.floor(Math.random() * 1000) + 300;
        await new Promise(r => setTimeout(r, delay));

        const mobileUrl = url.replace('www.sofascore.com', 'api.sofascore.com');

        const response = await fetch(mobileUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "tr-TR,tr;q=0.9",
                "Referer": "https://www.sofascore.com/",
                "Origin": "https://www.sofascore.com",
                "Connection": "keep-alive"
            }
        });

        if (!response.ok) {
            // 🚀 GELİŞMİŞ 404 KONTROLÜ (Kara liste için)
            if (response.status === 404) return { is404: true }; 
            
            console.log(`⚠️ API Reddi (HTTP ${response.status}) -> URL: ${url}`);
            return null;
        }

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
// ⚽ FUTBOL YAPILANDIRMASI
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

// 🚀 HATA ÇÖZÜMÜ: Şampiyonlar Ligi TRT'den Çıkarıldı
const getFootBroadcaster = (utId, hName, aName, tName, utName) => {
    const hn = (hName || "").toLowerCase();
    const an = (aName || "").toLowerCase();
    const tn = (tName || "").toLowerCase();
    const utn = (utName || "").toLowerCase();
    const isTurkey = hn.includes("turkey") || an.includes("turkey") || hn.includes("türkiye") || an.includes("türkiye");
    const isPlayoff = tn.includes("play-off") || tn.includes("playoff") || utn.includes("play-off") || utn.includes("playoff");

    if (utId === 748 || utId === 750) return isTurkey ? "TRT Spor / Tabii" : "Exxen";
    if (utId === 11 || utn.includes("world cup qual") || utn.includes("dünya kupası eleme")) {
        if (isTurkey) return isPlayoff ? "TV8" : "TRT 1 / Tabii";
        return isPlayoff ? "Exxen" : "S Sport Plus";
    }

    const staticConfigs = {
        34: "beIN Sports", 52: "beIN Sports", 238: "TRT Spor / Tabii", 242: "TRT Spor / Tabii", 938: "TRT 1 / Tabii",
        96: "TRT 1 / Tabii", 17: "S Sport Plus", 8: "beIN Sports", 23: "S Sport Plus", 
        // 7 numaralı Şampiyonlar Ligi çıkarıldı!
        351: "S Sport Plus", 37: "beIN Sports", 10: "Exxen / S Sport+", 13: "TRT 1 / Tabii", 393: "TRT 1 / Tabii",
        155: "Spor Smart / Exxen", 10618: "Exxen / FIFA+", 4664: "S Sport+ / TV+", 98: "beIN Sports / TRT Spor",
        97: "TFF YouTube", 11417: "TFF YouTube", 11416: "TFF YouTube", 11415: "TFF YouTube", 15938: "TFF YouTube",
        13363: "USL YouTube", 696: "DAZN / YouTube", 10783: "A Spor", 232: "S Sport Plus / DAZN",
        1: "S Sport Plus", 19: "Exxen", 53: "S Sport Plus", 38: "beIN Sports", 36: "beIN Sports",
        335: "beIN Sports", 955: "S Sport Plus / TV+", 18: "beIN Sports", 325: "Spor Smart / S Sport+", 16: "TRT 1"
    };
    if (staticConfigs[utId]) return staticConfigs[utId];
    if (utn.includes("j1 league")) return "YouTube (J.League Int.)";
    if (utn.includes("baller league")) return "Twitch / YouTube (Global)";
    if (utn.includes("primera a") || utn.includes("primera división")) return "TV Yayını Yok (Yerel)";
    if (utn.includes("mls next pro")) return "Apple TV / OneFootball";
    
    // YENİ VARSAYILAN:
    return "Resmi Yayıncı / Canlı Skor";
};

const ELITE_FOOT_IDS = [17, 8, 35, 23, 34, 52, 37, 38, 238, 36, 19, 96, 97, 98, 7, 679, 17015, 16, 1, 133, 270, 53, 335, 13363];
const REGULAR_FOOT_IDS = [299, 155, 325, 955, 18, 6516, 242, 11415, 11416, 11417, 15938, 851];
const NATIONAL_LEAGUES = [16, 1, 133, 270, 299, 851];
const ALL_FOOT_TARGETS = [...ELITE_FOOT_IDS, ...REGULAR_FOOT_IDS];

const footballLeagues = {
    17: "İngiltere Premier Lig", 8: "İspanya La Liga", 35: "Almanya Bundesliga",
    23: "İtalya Serie A", 34: "Fransa Ligue 1", 52: "Türkiye Süper Lig",
    98: "Trendyol 1. Lig", 97: "TFF 2. Lig",
    11417: "TFF 3. Lig Grup 1", 11416: "TFF 3. Lig Grup 2", 11415: "TFF 3. Lig Grup 3", 15938: "TFF 3. Lig Grup 4",
    53: "İtalya Serie B", 37: "Hollanda Eredivisie", 238: "Portekiz Primeira Liga", 38: "Belçika Pro League",
    36: "İskoçya Premiership", 19: "FA Cup", 938: "Türkiye Kupası", 96: "Türkiye Kupası",
    7: "UEFA Şampiyonlar Ligi", 679: "UEFA Avrupa Ligi", 17015: "UEFA Konferans Ligi",
    16: "FIFA Dünya Kupası", 1: "UEFA EURO", 133: "Copa America",
    270: "Afrika Uluslar Kupası", 299: "Uluslararası Hazırlık Maçları",
    6516: "Kulüp Hazırlık Maçları", 325: "Brezilya Serie A",
    155: "Arjantin Liga Profesional", 242: "MLS", 13363: "USL Championship",
    335: "Fransa Kupası", 955: "Suudi Arabistan Pro Lig", 18: "İngiltere Championship",
    851: "Uluslararası Hazırlık Maçları"
};

const nationalTeamCodes = {
    "turkey": "tr", "türkiye": "tr", "germany": "de", "france": "fr", "england": "en",
    "spain": "es", "italy": "it", "portugal": "pt", "netherlands": "nl", "belgium": "be",
    "switzerland": "ch", "austria": "at", "croatia": "hr", "brazil": "br", "argentina": "ar",
    "usa": "us", "mexico": "mx", "ecuador": "ec", "south korea": "kr", "japan": "jp",
    "uruguay": "uy", "colombia": "co", "chile": "cl", "peru": "pe", "venezuela": "ve",
    "paraguay": "py", "bolivia": "bo", "canada": "ca", "costa rica": "cr", "jamaica": "jm",
    "senegal": "sn", "morocco": "ma", "egypt": "eg", "tunisia": "tn", "nigeria": "ng",
    "cameroon": "cm", "ghana": "gh", "ivory coast": "ci", "algeria": "dz", "australia": "au",
    "iran": "ir", "saudi arabia": "sa", "qatar": "qa", "denmark": "dk", "sweden": "se",
    "norway": "no", "poland": "pl", "ukraine": "ua", "czech republic": "cz", "serbia": "rs",
    "hungary": "hu", "romania": "ro", "greece": "gr", "slovakia": "sk", "wales": "wa",
    "scotland": "sc", "ireland": "ie", "albania": "al", "north macedonia": "mk", "georgia": "ge",
    "slovenia": "si", "iceland": "is", "finland": "fi", "bosnia & herzegovina": "ba",
    "bosnia and herzegovina": "ba", "new zealand": "nz"
};

function calculateLiveMinute(eventData) {
    if (!eventData) return "";
    const status = eventData.status;
    const time = eventData.time;
    const code = status?.code;
    const desc = (status?.description || "").toLowerCase();

    if (code === 31 || desc === "halftime") return "İY";
    if (desc.includes("extra time halftime")) return "UZ İY";
    if (code === 50 || code === 60 || desc.includes("penalt")) return "PEN";
    if (code === 34 || desc.includes("awaiting extra time")) return "90+";

    if (time?.currentMinute !== undefined && time.currentMinute !== null) {
        let min = time.currentMinute;
        if (time.addedTime && min === 90) return "90+";
        if (time.addedTime && min === 45) return "45+";
        if (time.addedTime && min === 105) return "105+";
        if (time.addedTime && min === 120) return "120+";

        if (code === 6 && min > 45) return "45+";
        if (code === 7 && min > 90) return "90+";
        if ((code === 10 || code === 13 || desc.includes("1st extra")) && min > 105) return "105+";
        if ((code === 11 || code === 12 || code === 14 || desc.includes("2nd extra")) && min > 120) return "120+";

        return String(min) + "'";
    }

    if (time?.currentPeriodStartTimestamp) {
        const now = Math.floor(Date.now() / 1000);
        const elapsed = now - time.currentPeriodStartTimestamp;
        let calcMinute = Math.floor(elapsed / 60);

        if (calcMinute < 0) calcMinute = 0;

        if (code === 6) { return calcMinute > 45 ? "45+" : String(calcMinute) + "'"; } 
        else if (code === 7) { calcMinute += 45; return calcMinute > 90 ? "90+" : String(calcMinute) + "'"; } 
        else if (code === 10 || code === 13 || desc.includes("1st extra")) { calcMinute += 90; return calcMinute > 105 ? "105+" : String(calcMinute) + "'"; } 
        else if (code === 11 || code === 12 || code === 14 || desc.includes("2nd extra")) { calcMinute += 105; return calcMinute > 120 ? "120+" : String(calcMinute) + "'"; }

        return String(calcMinute) + "'";
    }

    return "Canlı";
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

        if (imageUrl) {
            payload.apns.fcmOptions = { imageUrl: imageUrl };
            payload.android = { notification: { imageUrl: imageUrl } };
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
        const prev = previousMatchStates.get(matchIdStr) || {
            status: null, homeScore: 0, awayScore: 0, hasNotifiedStart: false, hasNotifiedHT: false, hasNotifiedSH: false, hasNotifiedFinished: false,
            hasNotifiedInjuryTime1: false, hasNotifiedInjuryTime2: false, hasNotifiedETWait: false, hasNotifiedETHT: false, hasNotifiedETSH: false, hasNotifiedPenalties: false, lastMinute: 0, liveMinuteStr: ""
        };

        let currH = parseInt(match.homeScore) || 0;
        let currA = parseInt(match.awayScore) || 0;
        const notifAwayScore = String(match.awayScore).replace('\n', ' ');
        const liveMin = match.liveMinute || "";
        const tObj = match.timeObj || {};
        let currentMinNum = tObj.currentMinute || 0;

        if (match.status === 'inprogress' && currentMinNum > 0 && prev.lastMinute > 0 && currentMinNum < prev.lastMinute) {
            currH = prev.homeScore; currA = prev.awayScore; match.homeScore = String(currH); match.awayScore = String(currA); currentMinNum = prev.lastMinute;
        }

        const statusType = match.status;
        const isLive = statusType === 'inprogress';
        const isFinished = ['finished', 'ended', 'closed'].includes(statusType);
        const minuteChanged = liveMin !== prev.liveMinuteStr;
        const scoreChanged = currH !== prev.homeScore || currA !== prev.awayScore;
        const statusChanged = statusType !== prev.status;

        // 🚀 LIVE ACTIVITY SESSİZ PUSH (Seni sen yapan o hile buraya eklendi!)
        if ((isLive || isFinished) && (minuteChanged || scoreChanged || statusChanged)) {
            const tokensRef = firebaseApp.database().ref(`live_activity_tokens/${matchIdStr}`);
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

                    // Apple Headers Hilesi
                    if (typeof notification.headers === 'function') {
                        const originalHeadersFn = notification.headers.bind(notification);
                        notification.headers = function() { let h = originalHeadersFn(); h["apns-push-type"] = "liveactivity"; return h; };
                    }
            
                    try {
                        const result = await apnProvider.send(notification, deviceToken);
                        if (result.failed.length > 0) {
                            const err = result.failed[0];
                            const errorReason = err.response ? err.response.reason : err.error;
                            if (errorReason === 'BadDeviceToken' || errorReason === 'Unregistered') {
                                await firebaseApp.database().ref(`live_activity_tokens/${matchIdStr}/${deviceToken}`).remove();
                            }
                        }
                    } catch (e) {}
                });
                await Promise.all(promises);
            }
        }

        const appTitle = "Maç Saati";
        const whistleIconUrl = "https://img.icons8.com/color/96/whistle.png";
        const substitutionBoardUrl = "https://img.icons8.com/color/96/stopwatch--v1.png";
        const desc = (match.statusDesc || match.status?.description || "").toLowerCase();

        if (match.status === 'inprogress' && !prev.hasNotifiedStart) {
            await sendPush(matchIdStr, appTitle, `⚽ Maç Başladı!\n${match.homeTeam.name} - ${match.awayTeam.name}`, null, match);
            prev.hasNotifiedStart = true;
        } else if (match.status === 'inprogress' && match.statusCode === 6 && tObj.injuryTime1 && !prev.hasNotifiedInjuryTime1) {
            await sendPush(matchIdStr, `İlk yarı ilave süre: +${tObj.injuryTime1}'`, `${match.homeTeam.name} - ${match.awayTeam.name}`, substitutionBoardUrl, match);
            prev.hasNotifiedInjuryTime1 = true;
        } else if (match.status === 'inprogress' && (liveMin === "İY" || match.statusCode === 31) && !prev.hasNotifiedHT) {
            await sendPush(matchIdStr, appTitle, `⏱️ İlk Yarı Sonucu\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`, whistleIconUrl, match);
            prev.hasNotifiedHT = true;
        } else if (match.status === 'inprogress' && prev.hasNotifiedHT && (liveMin !== "İY" && match.statusCode !== 31) && !prev.hasNotifiedSH && match.statusCode === 7) {
            await sendPush(matchIdStr, appTitle, `▶️ İkinci Yarı Başladı\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`, whistleIconUrl, match);
            prev.hasNotifiedSH = true;
        } else if (match.status === 'inprogress' && match.statusCode === 7 && tObj.injuryTime2 && !prev.hasNotifiedInjuryTime2 && liveMin !== "İY") {
            await sendPush(matchIdStr, `İkinci yarı ilave süre: +${tObj.injuryTime2}'`, `${match.homeTeam.name} - ${match.awayTeam.name}`, substitutionBoardUrl, match);
            prev.hasNotifiedInjuryTime2 = true;
        } else if (match.status === 'inprogress' && (match.statusCode === 50 || match.statusCode === 60 || desc.includes("awaiting penalties") || liveMin === "PEN") && !prev.hasNotifiedPenalties) {
            await sendPush(matchIdStr, appTitle, `🎯 Eşitlik Bozulmadı! Maç Penaltılara Gitti\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`, whistleIconUrl, match);
            prev.hasNotifiedPenalties = true;
        } else if (match.status === 'inprogress' && (match.statusCode === 34 || match.statusCode === 10 || desc.includes("awaiting extra time")) && !prev.hasNotifiedETWait && !prev.hasNotifiedPenalties) {
            await sendPush(matchIdStr, appTitle, `⏱️ Maç Uzatmalara Gitti!\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`, whistleIconUrl, match);
            prev.hasNotifiedETWait = true;
        } else if (match.status === 'inprogress' && (match.statusCode === 40 || liveMin === "UZ İY") && !prev.hasNotifiedETHT) {
            await sendPush(matchIdStr, appTitle, `⏱️ Uzatma İlk Yarı Sonucu\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`, whistleIconUrl, match);
            prev.hasNotifiedETHT = true;
        } else if (match.status === 'inprogress' && (match.statusCode === 11 || match.statusCode === 12 || match.statusCode === 14 || (currentMinNum > 105 && prev.hasNotifiedETWait)) && !prev.hasNotifiedETSH) {
            await sendPush(matchIdStr, appTitle, `▶️ Uzatma İkinci Yarı Başladı\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`, whistleIconUrl, match);
            prev.hasNotifiedETSH = true;
        } else if (['finished', 'ended', 'closed'].includes(match.status) && !prev.hasNotifiedFinished) {
            if (prev.status === 'inprogress') {
                let bodyText = `🏁 Maç Bitti\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`;
                if (prev.hasNotifiedPenalties) bodyText = `🏁 Maç Sonucu (Penaltılarla)\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`;
                else if (prev.hasNotifiedETWait) bodyText = `🏁 Maç Sonucu (Uzatmalarla)\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`;
                await sendPush(matchIdStr, appTitle, bodyText, null, match);
            }
            prev.hasNotifiedFinished = true;
        }

        if (match.status === 'inprogress' && prev.status !== null) {
            if (prev.homeScore !== currH || prev.awayScore !== currA) {
                const isGoal = (currH + currA) > (prev.homeScore + prev.awayScore);
                if (isGoal) {
                    let scorerName = match.homeTeam.name;
                    try {
                        const incidentsData = await fetchData(`https://www.sofascore.com/api/v1/event/${match.id}/incidents`);
                        if (incidentsData && incidentsData.incidents) {
                            const goals = incidentsData.incidents.filter(inc => inc.incidentType === 'goal');
                            if (goals.length > 0) {
                                const lastGoal = goals.sort((a, b) => (b.time + (b.addedTime || 0)) - (a.time + (a.addedTime || 0)))[0];
                                if (lastGoal && lastGoal.player && lastGoal.player.name) scorerName = lastGoal.player.name;
                            }
                        }
                    } catch (e) { }

                    const homeScored = currH > prev.homeScore;
                    const scoringTeamLogo = homeScored ? match.homeTeam.logo : match.awayTeam.logo;
                    await sendPush(matchIdStr, appTitle, `⚽ Gol - ${scorerName} (${liveMin})\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`, scoringTeamLogo, match);
                    pendingGoalCancel.delete(matchIdStr);
                } else {
                    const pending = pendingGoalCancel.get(matchIdStr);
                    if (!pending) {
                        pendingGoalCancel.set(matchIdStr, { homeScore: currH, awayScore: currA, firstSeen: Date.now() });
                        currH = prev.homeScore; currA = prev.awayScore; match.homeScore = String(currH); match.awayScore = String(currA);
                    } else {
                        if (pending.homeScore === currH && pending.awayScore === currA) {
                            const elapsed = Date.now() - pending.firstSeen;
                            if (elapsed >= 120000) { pendingGoalCancel.delete(matchIdStr); match.homeScore = String(currH); match.awayScore = String(currA); } 
                            else { currH = prev.homeScore; currA = prev.awayScore; match.homeScore = String(currH); match.awayScore = String(currA); }
                        } else {
                            pendingGoalCancel.delete(matchIdStr); currH = prev.homeScore; currA = prev.awayScore; match.homeScore = String(currH); match.awayScore = String(currA);
                        }
                    }
                }
            }
        }

        previousMatchStates.set(matchIdStr, {
            status: match.status, homeScore: currH, awayScore: currA, hasNotifiedStart: prev.hasNotifiedStart, hasNotifiedHT: prev.hasNotifiedHT, hasNotifiedSH: prev.hasNotifiedSH, hasNotifiedFinished: prev.hasNotifiedFinished,
            hasNotifiedInjuryTime1: prev.hasNotifiedInjuryTime1, hasNotifiedInjuryTime2: prev.hasNotifiedInjuryTime2, hasNotifiedETWait: prev.hasNotifiedETWait, hasNotifiedETHT: prev.hasNotifiedETHT, hasNotifiedETSH: prev.hasNotifiedETSH, hasNotifiedPenalties: prev.hasNotifiedPenalties,
            lastMinute: Math.max(currentMinNum, prev.lastMinute || 0), liveMinuteStr: liveMin, date: match.fixedDate || getTRDate(0)
        });
    }
    saveState();
}

async function triggerPushToStart(matchId) {
    const match = globalFootballCache.get(matchId);
    if (!match) return;

    let tokensToAlert = [];
    const normalTokens = (await firebaseApp.database().ref(`push_to_start_tokens/${matchId}`).once('value')).val();
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
                "attributes": { "matchId": String(match.id), "homeTeamName": String(match.homeTeam.name), "awayTeamName": String(match.awayTeam.name), "leagueName": String(match.tournament || "Futbol"), "homeTeamId": match.homeTeam.id ? Number(match.homeTeam.id) : 0, "awayTeamId": match.awayTeam.id ? Number(match.awayTeam.id) : 0, "homeLogoFile": `logo_home_${match.id}.png`, "awayLogoFile": `logo_away_${match.id}.png` },
                "content-state": { "homeScore": Number(cleanHomeScore), "awayScore": Number(cleanAwayScore), "matchMinute": String(cleanMinute) },
                "alert": { "title": "Maç Saati", "body": `${match.homeTeam.name} - ${match.awayTeam.name} canlı takibi başladı!` }
            }
        };

        notification.topic = "com.elfcrzgr.macsaati.push-type.liveactivity"; notification.priority = 10; notification.pushType = "liveactivity";

        if (typeof notification.headers === 'function') {
            const originalHeadersFn = notification.headers.bind(notification);
            notification.headers = function() { let h = originalHeadersFn(); h["apns-push-type"] = "liveactivity"; return h; };
        }

        try { await apnProvider.send(notification, token); } catch (e) {}
    }
}

// =========================================================================
// ⚽ FUTBOL GÜNCELLEME (GERÇEK AKILLI TARAMA)
// =========================================================================
async function updateFootball(targetDates = [getTRDate(0)], isQuickScan = false) {
    console.log(`⚽ Futbol: (Mod: ${isQuickScan ? '🚀 HIZLI' : '🐢 DETAYLI'})`);

    const validDates = [getTRDate(-2), getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2), getTRDate(3)];
    for (const [id, state] of previousMatchStates.entries()) {
        if (state.date && !validDates.includes(state.date) && state.status !== 'inprogress') previousMatchStates.delete(id);
    }
    saveState();

    let allEvents = [];
    let successfulDates = [];

    for (const date of targetDates) {
        let dateHasMatches = false;
        
        if (!emptyLeaguesCache.has(date)) emptyLeaguesCache.set(date, new Set());
        const knownEmptyLeagues = emptyLeaguesCache.get(date);
        
        let leaguesToFetch = [];

        if (isQuickScan) {
            const activeLeagues = new Set();
            for (const match of globalFootballCache.values()) {
                if (match.fixedDate === date) {
                    const lId = match.tournamentLogo.split('/').pop().replace('.png', '');
                    activeLeagues.add(Number(lId));
                }
            }
            leaguesToFetch = Array.from(activeLeagues);
        } else {
            leaguesToFetch = ALL_FOOT_TARGETS.filter(id => !knownEmptyLeagues.has(id));
        }

        if (leaguesToFetch.length > 0 && !isQuickScan) {
            console.log(`🔍 [${date}] için sorgulanacak lig sayısı: ${leaguesToFetch.length}`);
        }

        for (const leagueId of leaguesToFetch) {
            const url = `https://www.sofascore.com/api/v1/unique-tournament/${leagueId}/scheduled-events/${date}`;
            const data = await fetchData(url);
            
            if (data?.events && data.events.length > 0) {
                allEvents.push(...data.events);
                dateHasMatches = true;
            } else if (data?.is404) {
                knownEmptyLeagues.add(leagueId);
            }
        }
        if (dateHasMatches) successfulDates.push(date);
    }

    if (successfulDates.length === 0) return { hasLiveMatch: sportUpdateStatus.hasLiveMatch, nextMatchTimestamp: sportUpdateStatus.nextMatchTime, hasAnyMatches: globalFootballCache.size > 0 };

    for (const [id, match] of globalFootballCache.entries()) {
        if (!validDates.includes(match.fixedDate)) globalFootballCache.delete(id);
    }

    let futbolMatchesLog = [];

    allEvents.forEach(e => {
        const statusType = e.status?.type || ""; const statusDesc = e.status?.description || "";
        if (statusType === 'canceled' || statusType === 'postponed' || statusDesc.toLowerCase() === 'canceled' || statusDesc.toLowerCase() === 'postponed') return;

        const status = e.status.type;
        const isLive = status === 'inprogress';
        const isSuspended = status === 'suspended' || status === 'interrupted' || status === 'abandoned';
        const leagueId = e.tournament?.uniqueTournament?.id;
        const hName = e.homeTeam.name || ""; const aName = e.awayTeam.name || "";
        const tName = e.tournament?.name || ""; const utName = e.tournament?.uniqueTournament?.name || "";
        let cleanTournamentName = footballLeagues[leagueId] || e.tournament?.name || utName;

        if (leagueId === 97) {
            const tId = e.tournament?.id;
            if (tId === 1993) cleanTournamentName = "TFF 2. Lig (Beyaz Grup)";
            else if (tId === 1994) cleanTournamentName = "TFF 2. Lig (Kırmızı Grup)";
            else cleanTournamentName = "TFF 2. Lig";
        }

        const dateTR = new Date(e.startTimestamp * 1000);
        const dayTR = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        if (!targetDates.includes(dayTR)) return;

        const timeString = dateTR.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        const fallbackBroadcaster = getFootBroadcaster(leagueId, hName, aName, tName, utName);
        const translatedHome = translateTeam(hName); const translatedAway = translateTeam(aName);
        const result = getBroadcasterWithFallback("futbol", dayTR, timeString, translatedHome, translatedAway, fallbackBroadcaster);
        const finalBroadcaster = result.kanal;

        if(!isQuickScan) futbolMatchesLog.push({ home: translatedHome, away: translatedAway, kanal: finalBroadcaster, source: result.source });

        let finalHomeScore = (isLive || status === 'finished' || isSuspended) ? String(e.homeScore?.display ?? "0") : "-";
        let finalAwayScore = (isLive || status === 'finished' || isSuspended) ? String(e.awayScore?.display ?? "0") : "-";
        let matchSets = [];
        if (e.homeScore?.penalties !== undefined && e.awayScore?.penalties !== undefined) matchSets.push(`PEN ${e.homeScore.penalties}-${e.awayScore.penalties}`);

        let homeLogoUrl = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.homeTeam.id}.png`;
        let awayLogoUrl = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.awayTeam.id}.png`;

        if (NATIONAL_LEAGUES.includes(leagueId) || e.homeTeam.national === true || e.awayTeam.national === true) {
            const hNameLower = (e.homeTeam.name || "").toLowerCase(); const aNameLower = (e.awayTeam.name || "").toLowerCase();
            const hCode = e.homeTeam?.country?.alpha2?.toLowerCase() || nationalTeamCodes[hNameLower]; const aCode = e.awayTeam?.country?.alpha2?.toLowerCase() || nationalTeamCodes[aNameLower];
            if (hCode) homeLogoUrl = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/${hCode}.png`;
            if (aCode) awayLogoUrl = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/${aCode}.png`;
        }

        globalFootballCache.set(e.id, {
            id: e.id, isElite: ELITE_FOOT_IDS.includes(leagueId), status: status, statusCode: e.status?.code, liveMinute: isLive ? calculateLiveMinute(e) : (isSuspended ? "Durduruldu" : ""),
            fixedDate: dayTR, fixedTime: timeString, timestamp: e.startTimestamp * 1000, broadcaster: finalBroadcaster,
            homeTeam: { name: translatedHome, logo: homeLogoUrl, id: e.homeTeam.id }, awayTeam: { name: translatedAway, logo: awayLogoUrl, id: e.awayTeam.id },
            tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/${leagueId}.png`, homeScore: finalHomeScore, awayScore: finalAwayScore,
            setScores: matchSets, tournament: cleanTournamentName, timeObj: e.time
        });
    });

    const matches = Array.from(globalFootballCache.values()).sort((a, b) => a.timestamp - b.timestamp);
    await checkAndSendNotifications(matches);
    await uploadToFirebase({ success: true, lastUpdate: new Date().toLocaleTimeString('tr-TR'), matches });

    const hasLiveMatch = matches.some(m => m.status === 'inprogress');
    const nextMatchTimestamp = findNextMatchTime(globalFootballCache);

    if(!isQuickScan && futbolMatchesLog.length < 30) logMatchesBySport({ futbol: futbolMatchesLog });
    
    const forcedSnapshot = await firebaseApp.database().ref('forced_matches').once('value');
    const forcedMatches = forcedSnapshot.val() || {};
    for (const [id, match] of globalFootballCache.entries()) {
        if (forcedMatches[String(id)] === true && !triggeredMatches.has(String(id))) {
            await triggerPushToStart(id); triggeredMatches.add(String(id));
        }
    }
    return { hasLiveMatch, nextMatchTimestamp, hasAnyMatches: matches.length > 0 };
}


// =========================================================================
// 🆕 ANA DÖNGÜ (SADECE FUTBOL)
// =========================================================================
async function main() {
    loadState();
    console.log("============================================================");
    console.log("🟢 [FUTBOL] BAĞIMSIZ SERVİS BAŞLADI");
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
                const result = await updateFootball(days4, false);
                sportUpdateStatus.nextMatchTime = result.nextMatchTimestamp; sportUpdateStatus.hasLiveMatch = result.hasLiveMatch;
                lastPeriodicUpdate = now;
            }

            const todayOnly = [getTRDate(0)]; 
            const quickScanDates = [getTRDate(-1), getTRDate(0), getTRDate(1)]; 

            if (sportUpdateStatus.hasLiveMatch) {
                if (now - sportUpdateStatus.lastQuickUpdate >= MINUTE_MS) {
                    console.log("\n⚽ [HIZLI DÖNGÜ] Canlı futbol maçı var!");
                    const result = await updateFootball(todayOnly, true); 
                    sportUpdateStatus.lastQuickUpdate = now; sportUpdateStatus.hasLiveMatch = result.hasLiveMatch; sportUpdateStatus.nextMatchTime = result.nextMatchTimestamp;
                }
            } else if (sportUpdateStatus.nextMatchTime && now >= (sportUpdateStatus.nextMatchTime - MINUTE_MS * 1.1)) {
                if (now - sportUpdateStatus.lastQuickUpdate >= MINUTE_MS) {
                    console.log("\n⏰ [FUTBOL YAKLAŞAN] Yaklaşan maç vakti!");
                    const result = await updateFootball(quickScanDates, true); 
                    sportUpdateStatus.lastQuickUpdate = now; sportUpdateStatus.hasLiveMatch = result.hasLiveMatch; sportUpdateStatus.nextMatchTime = result.nextMatchTimestamp;
                }
            }

            let sleepTime = 10 * MINUTE_MS;
            const isActive = sportUpdateStatus.hasLiveMatch || (sportUpdateStatus.nextMatchTime && now >= (sportUpdateStatus.nextMatchTime - MINUTE_MS * 12));
            
            if (isActive) {
                sleepTime = MINUTE_MS;
                console.log(`\n⚡ [FUTBOL] Aktif/Yaklaşan maç var. Terminal ${Math.ceil(sleepTime / 60000)} dakika uykuya yatıyor...`);
            } else {
                console.log("\n💤 [FUTBOL] Şu an hareket yok. Terminal 10 dakika derin uyku modunda...");
            }

            await new Promise(r => setTimeout(r, sleepTime));
            
        } catch (e) { console.error("🚨 Hata:", e.message); await new Promise(r => setTimeout(r, MINUTE_MS)); }
    }
}
main();
