const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const admin = require('firebase-admin');

// =========================================================================
// 🧠 GLOBAL HAFIZA (CACHE) VE DURUM YÖNETİMİ
// =========================================================================
const previousMatchStates = new Map();
const pendingGoalCancel = new Map();

const globalFootballCache = new Map();
const globalBasketballCache = new Map();
const globalTennisCache = new Map();

// 🆕 HER SPORT IÇIN BAĞIMSIZ GÜNCELLEME DURUMU
const sportUpdateStatus = {
    football: {
        lastFullUpdate: 0,
        lastQuickUpdate: 0,
        nextMatchTime: null,
        hasLiveMatch: false,
        isInQuickMode: false
    },
    basketball: {
        lastFullUpdate: 0,
        lastQuickUpdate: 0,
        nextMatchTime: null,
        hasLiveMatch: false,
        isInQuickMode: false
    },
    tennis: {
        lastFullUpdate: 0,
        lastQuickUpdate: 0,
        nextMatchTime: null,
        hasLiveMatch: false,
        isInQuickMode: false
    },
    f1: {
        lastFullUpdate: 0
    }
};

const STATE_FILE = 'match_states.json';

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
            const {home, away, kanal} = matchInfo;
            console.log(`${icon} ${home} vs ${away} | Kanal: ${kanal} [SPOREKRANI]`);
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
            console.log(`📂 [HAFIZA] ${previousMatchStates.size} maç durumu dosyadan yüklendi.`);
        } catch (e) {
            console.error("❌ Hafıza dosyası okunamadı, yeni başlatılıyor.");
        }
    }
}

// =========================================================================
// ⚙️ AYARLAR VE FIREBASE BAĞLANTISI
// =========================================================================
const GITHUB_USER = "elfcrzgr";
const REPO_NAME = "macsaati-backend";
const MINUTE_MS = 60000; 
const FIREBASE_BASE_URL = "https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app/";

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(require('./serviceAccountKey.json')),
        databaseURL: FIREBASE_BASE_URL
    });
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
    
    const toTR = (str) => str.replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase().trim();
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

               
// Nokta, slaş, boşluk fark etmeksizin isimleri kelimelere böler ve kısa harfleri (J., M.) eler
const getCleanWords = (str) => {
    return str.replace(/[^a-z0-9ıüşöğç]/g, ' ')
              .split(' ')
              .map(w => w.trim())
              .filter(w => w.length >= 3); 
};

const hWords = getCleanWords(hName);
const aWords = getCleanWords(aName);

// Kelimelerden herhangi biri Spor Ekranı başlığında geçiyorsa eşleşti sayar
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
                } 
                else if (matchScore === 1 && diff <= 15 && dateKey === dateStr) {
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

const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36"
];

async function fetchData(url) {
    try {
        const randomAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
        const response = await fetch(url, {
            headers: {
                "User-Agent": randomAgent,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
                "Referer": "https://www.sofascore.com/",
                "Connection": "keep-alive",
                "Cache-Control": "no-cache"
            }
        });
        return response.ok ? await response.json() : null;
    } catch (e) {
        return null;
    }
}

const getTRDate = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
};

// =========================================================================
// ⚽ FUTBOL YAPILANDIRMASI
// =========================================================================
const teamTranslations = {
    // Avrupa (UEFA)
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

    // Güney Amerika (CONMEBOL)
    "brazil": "Brezilya", "argentina": "Arjantin", "uruguay": "Uruguay", "colombia": "Kolombiya",
    "chile": "Şili", "peru": "Peru", "venezuela": "Venezuela", "paraguay": "Paraguay",
    "bolivia": "Bolivya", "ecuador": "Ekvador",

    // Kuzey ve Orta Amerika (CONCACAF)
    "usa": "ABD", "united states": "ABD", "mexico": "Meksika", "canada": "Kanada",
    "costa rica": "Kosta Rika", "jamaica": "Jamaika", "panama": "Panama", "honduras": "Honduras",
    "curaçao": "Curaçao", "curacao": "Curaçao", "british virgin islands": "Britanya Virjin Adaları",
    "dominican republic": "Dominik Cumhuriyeti", "el salvador": "El Salvador",
    "cayman islands": "Cayman Adaları", "nicaragua": "Nikaragua", "haiti": "Haiti",

    // Afrika (CAF)
    "senegal": "Senegal", "morocco": "Fas", "egypt": "Mısır", "tunisia": "Tunus", "nigeria": "Nijerya",
    "cameroon": "Kamerun", "ghana": "Gana", "algeria": "Cezayir", "south africa": "Güney Afrika", "mali": "Mali", 
    "cabo verde": "Yeşil Burun Adaları", "cape verde": "Yeşil Burun Adaları", "madagascar": "Madagaskar",
    "dr congo": "Demokratik Kongo", "democratic republic of the congo": "Demokratik Kongo", "guinea": "Gine", 
    "lesotho": "Lesotho", "kenya": "Kenya", "benin": "Benin", "niger": "Nijer",
    "sierra leone": "Sierra Leone", "liberia": "Liberya",
    // Fildişi Sahili varyasyonları
    "ivory coast": "Fildişi Sahili", "cote d'ivoire": "Fildişi Sahili", "côte d'ivoire": "Fildişi Sahili",

    // Asya ve Okyanusya (AFC & OFC)
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
    
    if (teamTranslations[lowerName]) {
        return teamTranslations[lowerName];
    }

    for (const [eng, tr] of Object.entries(teamTranslations)) {
        const regex = new RegExp(`\\b${eng}\\b`, 'i');
        if (regex.test(name)) {
            return name.replace(regex, tr);
        }
    }
    return name;
};


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
        96: "TRT 1 / Tabii", 17: "S Sport Plus", 8: "beIN Sports", 23: "S Sport Plus", 7: "TRT 1 / Tabii", 
        351: "S Sport Plus", 37: "beIN Sports", 10: "Exxen / S Sport+", 13: "TRT 1 / Tabii", 393: "TRT 1 / Tabii", 
        155: "Spor Smart / Exxen", 10618: "Exxen / FIFA+", 4664: "S Sport+ / TV+", 98: "beIN Sports / TRT Spor", 
        97: "TFF YouTube", 11417: "TFF YouTube", 11416: "TFF YouTube", 11415: "TFF YouTube", 15938: "TFF YouTube",
        13363: "USL YouTube", 696: "DAZN / YouTube", 10783: "A Spor", 232: "S Sport Plus / DAZN",
        1: "S Sport Plus", 19: "Exxen", 53: "S Sport Plus", 38: "beIN Sports", 36: "beIN Sports",
        335: "beIN Sports", 955: "S Sport Plus / TV+", 18: "beIN Sports", 325: "Spor Smart / S Sport+"
    };
    if (staticConfigs[utId]) return staticConfigs[utId];
    if (utn.includes("j1 league")) return "YouTube (J.League Int.)";
    if (utn.includes("baller league")) return "Twitch / YouTube (Global)";
    if (utn.includes("primera a") || utn.includes("primera división")) return "TV Yayını Yok (Yerel)";
    if (utn.includes("mls next pro")) return "Apple TV / OneFootball";
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
    
    if (code === 50 || code === 60 || desc.includes("penalt")) {
        return "PEN"; 
    }
    
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

        if (code === 6) {
            return calcMinute > 45 ? "45+" : String(calcMinute) + "'";
        } else if (code === 7) {
            calcMinute += 45;
            return calcMinute > 90 ? "90+" : String(calcMinute) + "'";
        } else if (code === 10 || code === 13 || desc.includes("1st extra")) { 
            calcMinute += 90;
            return calcMinute > 105 ? "105+" : String(calcMinute) + "'";
        } else if (code === 11 || code === 12 || code === 14 || desc.includes("2nd extra")) { 
            calcMinute += 105;
            return calcMinute > 120 ? "120+" : String(calcMinute) + "'";
        }

        return String(calcMinute) + "'";
    }

    return "Canlı";
}

// =========================================================================
// 🔔 BİLDİRİM KONTROLÜ VE GÖNDERME
// =========================================================================
// =========================================================================
// 🔔 BİLDİRİM KONTROLÜ VE GÖNDERME
// =========================================================================
async function checkAndSendNotifications(newMatches) {
    for (const match of newMatches) {
        const matchIdStr = String(match.id);
        
        const prev = previousMatchStates.get(matchIdStr) || { 
            status: null, homeScore: 0, awayScore: 0, 
            hasNotifiedStart: false, hasNotifiedHT: false, hasNotifiedSH: false, hasNotifiedFinished: false,
            hasNotifiedInjuryTime1: false, hasNotifiedInjuryTime2: false,
            hasNotifiedETWait: false, hasNotifiedETHT: false, hasNotifiedETSH: false, hasNotifiedPenalties: false,
            lastMinute: 0 
        };
        
        let currH = parseInt(match.homeScore) || 0;
        let currA = parseInt(match.awayScore) || 0;
        
        const notifAwayScore = String(match.awayScore).replace('\n', ' ');
        
        const liveMin = match.liveMinute || ""; 
        const tObj = match.timeObj || {}; 
        let currentMinNum = tObj.currentMinute || 0;
        
        const appTitle = "Maç Saati"; 
        const whistleIconUrl = "https://img.icons8.com/color/96/whistle.png";
        const substitutionBoardUrl = "https://img.icons8.com/color/96/stopwatch--v1.png"; 

        if (match.status === 'inprogress' && currentMinNum > 0 && prev.lastMinute > 0 && currentMinNum < prev.lastMinute) {
            console.log(`🛡️ CDN HATASI ENGELLENDİ: ${match.homeTeam.name} dakikası geriye gitti. Eski veri reddedildi.`);
            currH = prev.homeScore;
            currA = prev.awayScore;
            match.homeScore = String(currH); 
            match.awayScore = String(currA);
        }

        const desc = (match.statusDesc || match.status?.description || "").toLowerCase();

        // 🚀 DİKKAT: Artık tüm sendPush çağrılarına `match` objesini de fırlatıyoruz!
        if (match.status === 'inprogress' && !prev.hasNotifiedStart) {
            const bodyText = `⚽ Maç Başladı!\n${match.homeTeam.name} - ${match.awayTeam.name}`;
            await sendPush(matchIdStr, appTitle, bodyText, null, match);
            prev.hasNotifiedStart = true;
        } 
        else if (match.status === 'inprogress' && match.statusCode === 6 && tObj.injuryTime1 && !prev.hasNotifiedInjuryTime1) {
            const titleText = `İlk yarı ilave süre: +${tObj.injuryTime1}'`;
            const bodyText = `${match.homeTeam.name} - ${match.awayTeam.name}`;
            await sendPush(matchIdStr, titleText, bodyText, substitutionBoardUrl, match);
            prev.hasNotifiedInjuryTime1 = true;
        }
        else if (match.status === 'inprogress' && (liveMin === "İY" || match.statusCode === 31) && !prev.hasNotifiedHT) {
            const bodyText = `⏱️ İlk Yarı Sonucu\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`;
            await sendPush(matchIdStr, appTitle, bodyText, whistleIconUrl, match);
            prev.hasNotifiedHT = true;
        }
        else if (match.status === 'inprogress' && prev.hasNotifiedHT && (liveMin !== "İY" && match.statusCode !== 31) && !prev.hasNotifiedSH && match.statusCode === 7) {
            const bodyText = `▶️ İkinci Yarı Başladı\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`;
            await sendPush(matchIdStr, appTitle, bodyText, whistleIconUrl, match);
            prev.hasNotifiedSH = true;
        }
        else if (match.status === 'inprogress' && match.statusCode === 7 && tObj.injuryTime2 && !prev.hasNotifiedInjuryTime2 && liveMin !== "İY") {
            const titleText = `İkinci yarı ilave süre: +${tObj.injuryTime2}'`;
            const bodyText = `${match.homeTeam.name} - ${match.awayTeam.name}`;
            await sendPush(matchIdStr, titleText, bodyText, substitutionBoardUrl, match);
            prev.hasNotifiedInjuryTime2 = true;
        }
        else if (match.status === 'inprogress' && (match.statusCode === 50 || match.statusCode === 60 || desc.includes("awaiting penalties") || liveMin === "PEN") && !prev.hasNotifiedPenalties) {
            const bodyText = `🎯 Eşitlik Bozulmadı! Maç Penaltılara Gitti\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`;
            await sendPush(matchIdStr, appTitle, bodyText, whistleIconUrl, match);
            prev.hasNotifiedPenalties = true;
        }
        else if (match.status === 'inprogress' && (match.statusCode === 34 || match.statusCode === 10 || desc.includes("awaiting extra time")) && !prev.hasNotifiedETWait && !prev.hasNotifiedPenalties) {
            const bodyText = `⏱️ Maç Uzatmalara Gitti!\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`;
            await sendPush(matchIdStr, appTitle, bodyText, whistleIconUrl, match);
            prev.hasNotifiedETWait = true;
        }
        else if (match.status === 'inprogress' && (match.statusCode === 40 || liveMin === "UZ İY") && !prev.hasNotifiedETHT) {
            const bodyText = `⏱️ Uzatma İlk Yarı Sonucu\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`;
            await sendPush(matchIdStr, appTitle, bodyText, whistleIconUrl, match);
            prev.hasNotifiedETHT = true;
        }
        else if (match.status === 'inprogress' && (match.statusCode === 11 || match.statusCode === 12 || match.statusCode === 14 || (currentMinNum > 105 && prev.hasNotifiedETWait)) && !prev.hasNotifiedETSH) {
            const bodyText = `▶️ Uzatma İkinci Yarı Başladı\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`;
            await sendPush(matchIdStr, appTitle, bodyText, whistleIconUrl, match);
            prev.hasNotifiedETSH = true;
        }
        else if (['finished', 'ended', 'closed'].includes(match.status) && !prev.hasNotifiedFinished) {
            if (prev.status === 'inprogress') {
                let bodyText = `🏁 Maç Bitti\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`;
                if (prev.hasNotifiedPenalties) {
                    bodyText = `🏁 Maç Sonucu (Penaltılarla)\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`;
                } else if (prev.hasNotifiedETWait) {
                    bodyText = `🏁 Maç Sonucu (Uzatmalarla)\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`;
                }
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
                                if (lastGoal && lastGoal.player && lastGoal.player.name) {
                                    scorerName = lastGoal.player.name;
                                }
                            }
                        }
                    } catch (e) { }
                    
                    const homeScored = currH > prev.homeScore;
                    const scoringTeamLogo = homeScored ? match.homeTeam.logo : match.awayTeam.logo;
                    const bodyText = `⚽ Gol - ${scorerName} (${liveMin})\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`;
                    
                    await sendPush(matchIdStr, appTitle, bodyText, scoringTeamLogo, match);
                    pendingGoalCancel.delete(matchIdStr);
                } else {
                    const pending = pendingGoalCancel.get(matchIdStr);
                    if (!pending) {
                        pendingGoalCancel.set(matchIdStr, { homeScore: currH, awayScore: currA, firstSeen: Date.now() });
                        currH = prev.homeScore;
                        currA = prev.awayScore;
                        match.homeScore = String(currH);
                        match.awayScore = String(currA);
                        
                    } else {
                        if (pending.homeScore === currH && pending.awayScore === currA) {
                            const elapsed = Date.now() - pending.firstSeen;
                            
                            if (elapsed >= 120000) { 
                                pendingGoalCancel.delete(matchIdStr);
                                match.homeScore = String(currH);
                                match.awayScore = String(currA);
                            } else {
                                currH = prev.homeScore;
                                currA = prev.awayScore;
                                match.homeScore = String(currH);
                                match.awayScore = String(currA);
                            }
                        } else {
                            pendingGoalCancel.delete(matchIdStr);
                            currH = prev.homeScore;
                            currA = prev.awayScore;
                            match.homeScore = String(currH);
                            match.awayScore = String(currA);
                        }
                    }
                }
            }
        }

        previousMatchStates.set(matchIdStr, {
            status: match.status, homeScore: currH, awayScore: currA, 
            hasNotifiedStart: prev.hasNotifiedStart, 
            hasNotifiedHT: prev.hasNotifiedHT, 
            hasNotifiedSH: prev.hasNotifiedSH, 
            hasNotifiedFinished: prev.hasNotifiedFinished,
            hasNotifiedInjuryTime1: prev.hasNotifiedInjuryTime1, 
            hasNotifiedInjuryTime2: prev.hasNotifiedInjuryTime2,
            hasNotifiedETWait: prev.hasNotifiedETWait,
            hasNotifiedETHT: prev.hasNotifiedETHT,
            hasNotifiedETSH: prev.hasNotifiedETSH,
            hasNotifiedPenalties: prev.hasNotifiedPenalties,
            lastMinute: Math.max(currentMinNum, prev.lastMinute || 0),
            date: match.fixedDate || getTRDate(0) 
        });
    }
    
    saveState();
}

// 🚀 GÜNCELLENEN sendPush FONKSİYONU - iOS Bildirim Sorunu KESİN Çözümü 
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
            
            // Android ve uygulama içi yönlendirmeler için ana veriler
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

        // 🚀 BÜYÜ BURADA: matchData gönderilmişse tüm detayları FCM data objesine şırınga ediyoruz!
        if (matchData) {
            payload.data.homeName = String(matchData.homeTeam?.name || "Ev Sahibi");
            payload.data.awayName = String(matchData.awayTeam?.name || "Deplasman");
            payload.data.homeScore = String(matchData.homeScore || "-");
            payload.data.awayScore = String(matchData.awayScore || "-");
            payload.data.homeLogo = String(matchData.homeTeam?.logo || "");
            payload.data.awayLogo = String(matchData.awayTeam?.logo || "");
            payload.data.status = String(matchData.status || "inprogress");
            payload.data.timeOrMinute = String(matchData.liveMinute || "");
        }

        // Görsel varsa hem iOS hem Android için evrensel ekleme yapıyoruz
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
// =========================================================================
// 🆕 SONRAKİ MAÇI BULMA FONKSİYONU
// =========================================================================
function findNextMatchTime(cache, now = Date.now()) {
    let nextTime = null;
    
    for (const match of cache.values()) {
        if (match.status === 'notstarted' || match.status === 'delayed') {
            if (match.timestamp <= now) {
                return now; 
            }
            if (!nextTime || match.timestamp < nextTime) {
                nextTime = match.timestamp;
            }
        }
    }
    return nextTime;
}

function hasTodayMatches(cache) {
    const today = getTRDate(0);
    for (const match of cache.values()) {
        if (match.fixedDate === today) {
            return true;
        }
    }
    return false;
}

// =========================================================================
// ⚽ FUTBOL GÜNCELLEME (GLOBAL CACHE İLE GÜNCELLENDİ)
// =========================================================================
async function updateFootball(targetDates = [getTRDate(0)]) {
    console.log(`⚽ Futbol güncelleniyor... (Taranan gün: ${targetDates.length})`);
    
    const today = getTRDate(0);
    for (const [id, state] of previousMatchStates.entries()) {
        if (state.date && state.date !== today) {
            if (state.status !== 'inprogress') {
                previousMatchStates.delete(id);
            } else {
                state.date = today;
                previousMatchStates.set(id, state);
            }
        }
    }
    saveState();

    let allEvents = [];
    let successfulDates = [];
    
    for (const date of targetDates) {
        const data = await fetchData(`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${date}?_=${Date.now()}`);
        if (data?.events) {
            allEvents.push(...data.events.filter(e => ALL_FOOT_TARGETS.includes(e.tournament?.uniqueTournament?.id)));
            successfulDates.push(date);
        }
    }

    if (successfulDates.length === 0) {
        console.log("⚠️ API yanıt vermedi. Mevcut futbol önbelleği korunuyor.");
        return { 
            hasLiveMatch: sportUpdateStatus.football.hasLiveMatch, 
            nextMatchTimestamp: sportUpdateStatus.football.nextMatchTime, 
            hasAnyMatches: globalFootballCache.size > 0 
        };
    }

    for (const [id, match] of globalFootballCache.entries()) {
        if (successfulDates.includes(match.fixedDate)) {
            globalFootballCache.delete(id);
        }
    }
    
    const tff2Matches = allEvents.filter(e => e.tournament?.uniqueTournament?.id === 97);
    for (const match of tff2Matches) {
        const detailData = await fetchData(`https://www.sofascore.com/api/v1/event/${match.id}`);
        if (detailData?.event?.tournament?.id) {
            match.tournament.id = detailData.event.tournament.id;
        }
    }
    
    let futbolMatchesLog = [];
    
    allEvents.forEach(e => {
        const statusType = e.status?.type || "";
        const statusDesc = e.status?.description || "";

        if (statusType === 'canceled' || statusType === 'postponed' || statusDesc.toLowerCase() === 'canceled' || statusDesc.toLowerCase() === 'postponed') {
            return;
        }
        const status = e.status.type;
        const isLive = status === 'inprogress';
        const isSuspended = status === 'suspended' || status === 'interrupted' || status === 'abandoned';
        const leagueId = e.tournament?.uniqueTournament?.id;
        const hName = e.homeTeam.name || "";
        const aName = e.awayTeam.name || "";
        const tName = e.tournament?.name || "";
        const utName = e.tournament?.uniqueTournament?.name || "";
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

        const translatedHome = translateTeam(hName);
        const translatedAway = translateTeam(aName);

        const result = getBroadcasterWithFallback("futbol", dayTR, timeString, translatedHome, translatedAway, fallbackBroadcaster);
        const finalBroadcaster = result.kanal;
        
        futbolMatchesLog.push({ home: translatedHome, away: translatedAway, kanal: finalBroadcaster, source: result.source });
        
        let finalHomeScore = (isLive || status === 'finished' || isSuspended) ? String(e.homeScore?.display ?? "0") : "-";
        let finalAwayScore = (isLive || status === 'finished' || isSuspended) ? String(e.awayScore?.display ?? "0") : "-";

        let matchSets = [];
        if (e.homeScore?.penalties !== undefined && e.awayScore?.penalties !== undefined) {
            matchSets.push(`PEN ${e.homeScore.penalties}-${e.awayScore.penalties}`);
        }

        let homeLogoUrl = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.homeTeam.id}.png`;
        let awayLogoUrl = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.awayTeam.id}.png`;

        if (NATIONAL_LEAGUES.includes(leagueId) || e.homeTeam.national === true || e.awayTeam.national === true) {
            
            const hNameLower = (e.homeTeam.name || "").toLowerCase();
            const aNameLower = (e.awayTeam.name || "").toLowerCase();
            
            const hCode = e.homeTeam?.country?.alpha2?.toLowerCase() || nationalTeamCodes[hNameLower];
            const aCode = e.awayTeam?.country?.alpha2?.toLowerCase() || nationalTeamCodes[aNameLower];
            
            if (hCode) homeLogoUrl = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/${hCode}.png`;
            if (aCode) awayLogoUrl = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/${aCode}.png`;
        }

        globalFootballCache.set(e.id, {
            id: e.id,
            isElite: ELITE_FOOT_IDS.includes(leagueId),
            status: status,
            statusCode: e.status?.code,
            liveMinute: isLive ? calculateLiveMinute(e) : (isSuspended ? "Durduruldu" : ""),
            fixedDate: dayTR,
            fixedTime: timeString,
            timestamp: e.startTimestamp * 1000,
            broadcaster: finalBroadcaster,
            homeTeam: { name: translatedHome, logo: homeLogoUrl },
            awayTeam: { name: translatedAway, logo: awayLogoUrl },
            tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/${leagueId}.png`,
            homeScore: finalHomeScore,
            awayScore: finalAwayScore,
            setScores: matchSets,
            tournament: cleanTournamentName,
            timeObj: e.time
        });
    });

    const matches = Array.from(globalFootballCache.values()).sort((a, b) => a.timestamp - b.timestamp);

    await checkAndSendNotifications(matches);
    await uploadToFirebase("football", { success: true, lastUpdate: new Date().toLocaleTimeString('tr-TR'), matches });
    
    const hasLiveMatch = matches.some(m => m.status === 'inprogress');
    const nextMatchTimestamp = findNextMatchTime(globalFootballCache);
    
    logMatchesBySport({ futbol: futbolMatchesLog });
    console.log(`  ✅ Toplam ${matches.length} futbol maçı ${hasLiveMatch ? '(🟢 CANLI MAÇ VAR)' : '(⚪ Canlı maç yok)'}`);
    
    return { hasLiveMatch, nextMatchTimestamp, hasAnyMatches: matches.length > 0 };
}

// =========================================================================
// 🏀 BASKETBOL GÜNCELLEME (GLOBAL CACHE İLE GÜNCELLENDİ)
// =========================================================================
const ELITE_LEAGUE_IDS = [132, 138, 141, 9357, 519, 264, 285];
const leagueConfigs = {
    132: "S Sport / NBA TV", 138: "S Sport / S Sport Plus", 141: "TRT Spor / S Sport", 9357: "Tivibu Spor",
    285: "S Sport / TRT Spor", 519: "beIN Sports", 1179: "TRT Spor / beIN Sports", 19844: "TBF TV (YouTube)",
    264: "S Sport Plus", 304: "S Sport Plus", 227: "S Sport Plus", 156: "beIN Sports",
    1524: "S Sport Plus", 235: "S Sport Plus", 1438: "TRT Spor / beIN Sports"
};
const basketballLeagues = {
    132: "NBA", 138: "EuroLeague", 141: "EuroCup", 9357: "Basketbol Şampiyonlar Ligi (BCL)",
    519: "Basketbol Süper Ligi (BSL)", 1179: "Türkiye Erkekler Basketbol Kupası", 19844: "Türkiye Basketbol 2. Ligi (TB2L)",
    264: "İspanya Liga ACB", 304: "Yunanistan Basketbol Ligi", 227: "Almanya BBL", 156: "Fransa LNB Pro A",
    1524: "Avustralya NBL", 235: "Adriyatik Ligi (ABA)", 1438: "VTB Birleşik Ligi", 285: "FIBA EuroBasket"
};
const targetBaskIds = Object.keys(leagueConfigs).map(Number);

async function updateBasketball(targetDates = [getTRDate(0)]) {
    console.log(`🏀 Basketbol güncelleniyor... (Taranan gün: ${targetDates.length})`);
    
    let allEvents = [];
    let successfulDates = []; 

    for (const date of targetDates) {
        const data = await fetchData(`https://www.sofascore.com/api/v1/sport/basketball/scheduled-events/${date}`);
        if (data?.events) {
            allEvents.push(...data.events.filter(e => targetBaskIds.includes(e.tournament?.uniqueTournament?.id)));
            successfulDates.push(date);
        }
    }

    if (successfulDates.length === 0) {
        console.log("⚠️ API yanıt vermedi. Mevcut basketbol önbelleği korunuyor.");
        return { 
            nextMatchTimestamp: sportUpdateStatus.basketball.nextMatchTime, 
            hasAnyMatches: globalBasketballCache.size > 0 
        };
    }

    for (const [id, match] of globalBasketballCache.entries()) {
        if (successfulDates.includes(match.fixedDate)) {
            globalBasketballCache.delete(id);
        }
    }
    
    const seenKeys = new Set();
    let basketbolMatchesLog = [];
    
    for (const e of allEvents) {
        const utId = e.tournament?.uniqueTournament?.id;
        const utName = e.tournament?.uniqueTournament?.name || "";
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        
        if (!targetDates.includes(dayStr)) continue;
        
        const isNBA = (utId === 3547 || utName.toUpperCase() === "NBA");
        const matchKey = `${dayStr}_${e.homeTeam.name}_${e.awayTeam.name}_${utId}`;
        
        if (seenKeys.has(matchKey)) continue;
        seenKeys.add(matchKey);
        
        const statusType = e.status?.type;
        const isFinished = statusType === 'finished';
        const isInProgress = statusType === 'inprogress';
        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        if (isInProgress) timeString = `${timeString}\nCANLI`;
        const hasScore = isFinished || isInProgress;
        const cleanTournamentName = basketballLeagues[utId] || (isNBA ? "NBA" : utName);
        const fallbackBroadcaster = leagueConfigs[utId] || "Resmi Yayıncı";
        const result = getBroadcasterWithFallback("basketbol", dayStr, timeString, e.homeTeam.name, e.awayTeam.name, fallbackBroadcaster);
        const finalBroadcaster = result.kanal;
        
        basketbolMatchesLog.push({ home: e.homeTeam.name, away: e.awayTeam.name, kanal: finalBroadcaster, source: result.source });
        
        globalBasketballCache.set(e.id, {
            id: e.id,
            isElite: ELITE_LEAGUE_IDS.includes(utId),
            status: statusType,
            fixedDate: dayStr,
            fixedTime: timeString,
            timestamp: dateTR.getTime(),
            broadcaster: finalBroadcaster,
            homeTeam: { name: e.homeTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/logos/${isNBA ? "NBA/" : ""}${e.homeTeam.id}.png` },
            awayTeam: { name: e.awayTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/logos/${isNBA ? "NBA/" : ""}${e.awayTeam.id}.png` },
            tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/tournament_logos/${isNBA ? "3547" : utId}.png`,
            homeScore: hasScore ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: hasScore ? String(e.awayScore?.display ?? "0") : "-",
            tournament: cleanTournamentName
        });
    }
    
    const finalMatches = Array.from(globalBasketballCache.values()).sort((a, b) => a.timestamp - b.timestamp);
    await uploadToFirebase("basketball", { success: true, matches: finalMatches });
    
    logMatchesBySport({ basketbol: basketbolMatchesLog });
    const nextMatchTimestamp = findNextMatchTime(globalBasketballCache);
    console.log(`  ✅ Toplam ${finalMatches.length} basketbol maçı kaydedildi.`);
    
    return { nextMatchTimestamp, hasAnyMatches: finalMatches.length > 0 };
}




// =========================================================================
// 🎾 TENİS GÜNCELLEME (GLOBAL CACHE İLE EKLENDİ)
// =========================================================================
const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/`;
const TENNIS_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/tournament_logos/`;

const isGarbage = (tourName, catName) => {
    const t = (tourName || "").toUpperCase();
    const c = (catName || "").toUpperCase();
    
    const garbageWords = ["ITF", "CHALLENGER", "UTR", "QUALIFYING", "QUALIFIERS", "LEGENDS"];
    return garbageWords.some(word => t.includes(word) || c.includes(word));
};

// ✅ ELIT TURNUVALAR - DAIMA GÖSTERİL (Grand Slams + Masters 1000 + Finals)
const ELITE_KEYWORDS = [
    "WIMBLEDON", 
    "US OPEN", 
    "AUSTRALIAN OPEN", 
    "ROLAND GARROS", 
    "FRENCH OPEN", 
    "OLYMPIC",
    "ATP FINALS", 
    "WTA FINALS",
    "ATP MASTERS 1000",
    "WTA 1000",
    "MONTE CARLO MASTERS",
    "INDIAN WELLS MASTERS",
    "MIAMI MASTERS",
    "MADRID MASTERS",
    "ROME MASTERS",
    "CINCINNATI MASTERS",
    "MONTREAL MASTERS",
    "TORONTO MASTERS",
    "SHANGHAI MASTERS",
    "PARIS MASTERS"
];

// ⚠️ ATP 500 TURNUVALARI - GÖSTERİL
const ATP_500_TOURNAMENTS = [
    "BARCELONA",
    "HAMBURG",
    "CANADA",
    "CINCINNATI",
    "WASHINGTON",
    "SEOUL",
    "TOKYO",
    "BASEL",
    "VALENCIA",
    "ANTWERP",
    "SOFIA",
    "UMAG",
    "NEWPORT",
    "HALLE",
    "QUEENS",
    "EASTBOURNE",
    "AMSTERDAM",
    "SWEDEN",
    "VIENNA",
    "STOCKHOLM",
    "BUCHAREST",
    "CASABLANCA",
    "DOHA",
    "ACAPULCO",
    "BUENOS AIRES",
    "RIO",
    "SANTIAGO",
    "HOUSTON",
    "MEMPHIS",
    "OAKLAND",
    "SAN DIEGO",
    "LOS CABOS",
    "KITZBÜHEL",
    "GSTAAD",
    "BÅSTAD",
    "NEWPORT BEACH"
];



const checkIsEliteMatch = (tournamentName) => {
    if (!tournamentName) return false;
    const nameUpper = tournamentName.toUpperCase();
    
    // Qualifying maçlarını hariç tut
    if (nameUpper.includes("QUALIFYING") || nameUpper.includes("QUALIFIERS")) return false;
    
    // Elit turnuvaları kontrol et
    if (ELITE_KEYWORDS.some(keyword => nameUpper.includes(keyword))) return true;
    
    return false;
};

const checkIsValidTournament = (tournamentName) => {
    if (!tournamentName) return false;
    const nameUpper = tournamentName.toUpperCase();
    
    // Qualifying hariç
    if (nameUpper.includes("QUALIFYING") || nameUpper.includes("QUALIFIERS")) return false;
    
    // ITF/Challenger zaten isGarbage'da yakalanıyor
    // Elit + ATP 500 + ATP 250 → hepsini geçir
    return true; // isGarbage filtresi geçtiyse kabul et
};



async function updateTennis(targetDates = [getTRDate(0)]) {
    console.log(`🎾 Tenis güncelleniyor (Paralel Optimizasyon - Taranan gün: ${targetDates.length})...`);
    
    let rawEvents = [];
    let successfulDates = [];
    const seenEventIds = new Set();
    const tournamentCount = {};

    // 1. AŞAMA: Sofascore'dan verileri çek
    for (const date of targetDates) {
        try {
            const data = await fetchData(`https://www.sofascore.com/api/v1/sport/tennis/scheduled-events/${date}`);
            if (data?.events) {
               const filtered = data.events.filter(e => {
    const tourName = e.tournament?.name;
    const catName = e.tournament?.category?.name;
    
    if (isGarbage(tourName, catName)) return false;  // ITF/Challenger/UTR engelle
    if (!checkIsValidTournament(tourName)) return false;
    if (seenEventIds.has(e.id)) return false;
    
    seenEventIds.add(e.id);
    return true;
});

                rawEvents.push(...filtered);
                successfulDates.push(date);
            }
        } catch (error) {
            console.error(`⚠️ Tarih ${date} için veriler çekilemedi:`, error.message);
        }
    }

    if (successfulDates.length === 0) {
        console.log("⚠️ API yanıt vermedi. Mevcut tenis önbelleği korunuyor.");
        return { 
            hasLiveMatch: sportUpdateStatus.tennis.hasLiveMatch, 
            nextMatchTimestamp: sportUpdateStatus.tennis.nextMatchTime, 
            hasAnyMatches: globalTennisCache.size > 0 
        };
    }

    // 2. AŞAMA: Hafızadaki (Cache) eski ve ezilecek verileri temizle
    for (const [id, match] of globalTennisCache.entries()) {
        if (successfulDates.includes(match.fixedDate)) {
            globalTennisCache.delete(id);
        }
    }

    console.log(`  📋 ${rawEvents.length} tekil maç bulundu (Tekrarlar temizlendi)`);

    // 3. AŞAMA: Detay sayfalarından Sıralama ve Ülke bilgilerini çek (Paralel Hızlandırma)
    const detailPromises = rawEvents.map(e => 
        fetchData(`https://www.sofascore.com/api/v1/event/${e.id}`)
            .then(data => ({ eventId: e.id, data }))
            .catch(err => {
                console.warn(`⚠️ Event ${e.id} detayı çekilemedi`);
                return { eventId: e.id, data: null };
            })
    );

    const detailsResults = await Promise.all(detailPromises);
    const detailsMap = {};
    detailsResults.forEach(result => {
        detailsMap[result.eventId] = result.data;
    });
    console.log(`  ✅ Tüm detaylar çekildi`);

    // 4. AŞAMA: Tüm çekilen maçları işle ve hafızaya (Cache) yaz
    for (let idx = 0; idx < rawEvents.length; idx++) {
        const e = rawEvents[idx];
        
        try {
            const startTimestamp = e.startTimestamp * 1000;
            const dateTR = new Date(startTimestamp);
            const fixedDate = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
            
            if (!targetDates.includes(fixedDate)) continue;

            const tourName = e.tournament?.name || "";

            let homeLogos = [];
            let awayLogos = [];
            let hRank = null;
            let aRank = null;

            const detailData = detailsMap[e.id];
            
            if (detailData?.event) {
                const ev = detailData.event;

                if (ev.homeTeam?.ranking !== undefined && ev.homeTeam.ranking !== null) {
                    hRank = ev.homeTeam.ranking;
                }
                if (ev.awayTeam?.ranking !== undefined && ev.awayTeam.ranking !== null) {
                    aRank = ev.awayTeam.ranking;
                }

                if (!hRank && ev.homeTeam?.subTeams?.length > 0) {
                    const ranks = ev.homeTeam.subTeams.map(p => p.ranking).filter(r => r !== undefined && r !== null);
                    if (ranks.length > 0) hRank = Math.min(...ranks);
                }

                if (!aRank && ev.awayTeam?.subTeams?.length > 0) {
                    const ranks = ev.awayTeam.subTeams.map(p => p.ranking).filter(r => r !== undefined && r !== null);
                    if (ranks.length > 0) aRank = Math.min(...ranks);
                }

                const getCodes = (team) => {
                    if (team.subTeams && team.subTeams.length > 0) {
                        return team.subTeams.map(p => p.country?.alpha2?.toLowerCase()).filter(Boolean);
                    }
                    return [team.country?.alpha2?.toLowerCase() || "mc"];
                };

                homeLogos = getCodes(ev.homeTeam).map(c => `${TENNIS_LOGO_BASE}${c}.png`);
                awayLogos = getCodes(ev.awayTeam).map(c => `${TENNIS_LOGO_BASE}${c}.png`);
            } else {
                homeLogos = [e.homeTeam?.country?.alpha2 ? `${TENNIS_LOGO_BASE}${e.homeTeam.country.alpha2.toLowerCase()}.png` : `${TENNIS_LOGO_BASE}mc.png`];
                awayLogos = [e.awayTeam?.country?.alpha2 ? `${TENNIS_LOGO_BASE}${e.awayTeam.country.alpha2.toLowerCase()}.png` : `${TENNIS_LOGO_BASE}mc.png`];
            }

            const statusType = e.status?.type;
            let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
            
            const hasScore = statusType === 'inprogress' || statusType === 'finished';
            if (statusType === 'inprogress') timeString += "\nCANLI";
            else if (statusType === 'finished') timeString += "\nMS";

            let sets = [];
            if (hasScore && e.homeScore && e.awayScore) {
                for (let i = 1; i <= 5; i++) {
                    const hScore = e.homeScore[`period${i}`];
                    const aScore = e.awayScore[`period${i}`];
                    if (hScore !== undefined && aScore !== undefined) {
                        sets.push(`${hScore}-${aScore}`);
                    }
                }
            }

            // 🌟 DEĞİŞİKLİK BURADA BAŞLIYOR: Yayıncı bilgisini dinamik olarak sorguluyoruz
            const fallbackBroadcaster = "S Sport / beIN Sports";
            const result = getBroadcasterWithFallback("tenis", fixedDate, timeString, e.homeTeam.name, e.awayTeam.name, fallbackBroadcaster);
           
            
            // Hafızaya ekle! (En kritik kısım)
            globalTennisCache.set(e.id, {
                id: e.id,
                isElite: checkIsEliteMatch(tourName),
                status: statusType,
                fixedDate: fixedDate,
                fixedTime: timeString,
                timestamp: startTimestamp,
                broadcaster: result.kanal,
                homeTeam: { name: e.homeTeam.name || "Belli Değil", ranking: hRank, logos: homeLogos },
                awayTeam: { name: e.awayTeam.name || "Belli Değil", ranking: aRank, logos: awayLogos },
                tournamentLogo: TENNIS_TOURNAMENT_BASE + (e.tournament?.uniqueTournament?.id || e.tournament?.category?.id) + ".png",
                homeScore: !hasScore ? "-" : String(e.homeScore?.display ?? "0"),
                awayScore: !hasScore ? "-" : String(e.awayScore?.display ?? "0"),
                setScores: sets,
                tournament: tourName
            });
            
            tournamentCount[tourName] = (tournamentCount[tourName] || 0) + 1;
            
            const progress = Math.round(((idx + 1) / rawEvents.length) * 100);
            process.stdout.write(`\r  ⏳ İşleniyor... %${progress} (${idx + 1}/${rawEvents.length})`);
            
        } catch (error) {
            console.error(`\n⚠️ Maç ${e.id} işlenirken hata:`, error.message);
            continue;
        }
    }

    // 5. AŞAMA: Hafızadaki (Cache) tüm verileri topla, sırala ve Firebase'e gönder
    const finalMatches = Array.from(globalTennisCache.values()).sort((a, b) => a.timestamp - b.timestamp);
    await uploadToFirebase("tennis", { success: true, matches: finalMatches });
    
    console.log(`\n  ✅ Toplam ${finalMatches.length} tenis maçı kaydedildi`);
    console.log(`  📊 Turnuvalar: ${Object.keys(tournamentCount).length}`);
    
    const withRanking = finalMatches.filter(m => m.homeTeam.ranking || m.awayTeam.ranking).length;
    console.log(`  🏆 Sıralama verisi olan maçlar: ${withRanking}/${finalMatches.length}`);

    const hasLiveMatch = finalMatches.some(m => m.status === 'inprogress');
    const nextMatchTimestamp = findNextMatchTime(globalTennisCache);

    return { hasLiveMatch, nextMatchTimestamp, hasAnyMatches: finalMatches.length > 0 };
}




// =========================================================================
// 🏎️ FORMULA 1 GÜNCELLEME
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
        const response = await fetchData('https://api.jolpi.ca/ergast/f1/current.json');
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
    } catch (error) { 
        console.error(`   ⚠️ F1 hatası: ${error.message}`); 
    }
}

// =========================================================================
// 🆕 ANA DÖNGÜ (AKILLI SPORT BAZLI GÜNCELLEME)
// =========================================================================
async function main() {
    loadState(); 
    console.log("============================================================");
    console.log("🟢 J7 CANLI SUNUCU BAŞLADI (SMART SPORT-SPECIFIC V5)");
    console.log("============================================================");
    
    let iteration = 1;
    const TEN_MIN_MS = 10 * 60000;     
    const ONE_MIN_MS = 60000;           

    let lastPeriodicUpdate = 0;

    while (true) {
        try {
            const now = Date.now();
            console.log(`\n[İterasyon ${iteration}] ${new Date().toLocaleTimeString('tr-TR')}`);
            loadExternalBroadcasters();
            
            // ---------------------------------------------------------
            // 🔄 YENİ 4 GÜNLÜK PERİYODİK GÜNCELLEME MANTIĞI 
            // Hedef Saatler: 00:10, 06:10, 12:10, 18:10
            // ---------------------------------------------------------
            const d = new Date(now);
            // Günün başlangıç milisaniyesi (Gece 00:00:00)
            const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
            const msSinceMidnight = now - startOfDay;

            // Gün içindeki hedef zaman dilimleri (Milisaniye cinsinden)
            const TARGET_TIMES = [
                10 * 60 * 1000,               // 00:10
                (6 * 60 + 10) * 60 * 1000,    // 06:10
                (12 * 60 + 10) * 60 * 1000,   // 12:10
                (18 * 60 + 10) * 60 * 1000    // 18:10
            ];

            let activeTarget = startOfDay - (5 * 60 + 50) * 60 * 1000; 
            for (let i = TARGET_TIMES.length - 1; i >= 0; i--) {
                if (msSinceMidnight >= TARGET_TIMES[i]) {
                    activeTarget = startOfDay + TARGET_TIMES[i];
                    break;
                }
            }

            if (lastPeriodicUpdate < activeTarget) {
                console.log("🔄 [PERİYODİK GÜNCELLEME] Ana Saat Dilimi (00:10 / 06:10 / 12:10 / 18:10) Tetiklendi!");
                console.log("📅 4 Günlük Veri Taraması Başlıyor...");
                
                const days4 = [getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)];
                
                const footballResult = await updateFootball(days4);
                const basketballResult = await updateBasketball(days4);
                const tennisResult = await updateTennis(days4);
                await updateF1();
                
                sportUpdateStatus.football.nextMatchTime = footballResult.nextMatchTimestamp;
                sportUpdateStatus.basketball.nextMatchTime = basketballResult.nextMatchTimestamp;
                sportUpdateStatus.tennis.nextMatchTime = tennisResult.nextMatchTimestamp;
                
                sportUpdateStatus.football.hasLiveMatch = footballResult.hasLiveMatch;
                
                lastPeriodicUpdate = now;
            }
            // ---------------------------------------------------------
            
            if (sportUpdateStatus.football.hasLiveMatch) {
                if (now - sportUpdateStatus.football.lastQuickUpdate >= ONE_MIN_MS) {
                    console.log("⚽ [HIZLI DÖNGÜ] Canlı futbol maçı var - Bugünün verileri güncelleniyor...");
                    const footResult = await updateFootball([getTRDate(0)]);
                    sportUpdateStatus.football.lastQuickUpdate = now;
                    sportUpdateStatus.football.hasLiveMatch = footResult.hasLiveMatch;
                    sportUpdateStatus.football.nextMatchTime = footResult.nextMatchTimestamp;
                }
            }
            else if (sportUpdateStatus.football.nextMatchTime && 
                     now >= (sportUpdateStatus.football.nextMatchTime - ONE_MIN_MS * 1.1)) {
                if (now - sportUpdateStatus.football.lastQuickUpdate >= ONE_MIN_MS) {
                    console.log("⏰ [FUTBOL YAKLAŞAN] Yaklaşan maç saati yaklaştı - Bugünün verileri güncelleniyor...");
                    const footResult = await updateFootball([getTRDate(0)]);
                    sportUpdateStatus.football.lastQuickUpdate = now;
                    sportUpdateStatus.football.hasLiveMatch = footResult.hasLiveMatch;
                    sportUpdateStatus.football.nextMatchTime = footResult.nextMatchTimestamp;
                }
            }
            
            const hasUpcomingBasketball = sportUpdateStatus.basketball.nextMatchTime && 
                                          now >= (sportUpdateStatus.basketball.nextMatchTime - ONE_MIN_MS * 11);
            
            if ((sportUpdateStatus.basketball.hasLiveMatch || hasUpcomingBasketball) &&
                now - sportUpdateStatus.basketball.lastQuickUpdate >= TEN_MIN_MS) {
                const logMsg = sportUpdateStatus.basketball.hasLiveMatch ? 
                    "🏀 [HIZLI DÖNGÜ] Canlı basketbol maçı var" : 
                    "🏀 [YAKLAŞAN] Yaklaşan basketbol maçı";
                console.log(`${logMsg} - Bugünün verileri güncelleniyor...`);
                const basketResult = await updateBasketball([getTRDate(0)]);
                sportUpdateStatus.basketball.lastQuickUpdate = now;
                sportUpdateStatus.basketball.nextMatchTime = basketResult.nextMatchTimestamp;
            }
            
            const hasUpcomingTennis = sportUpdateStatus.tennis.nextMatchTime && 
                                      now >= (sportUpdateStatus.tennis.nextMatchTime - ONE_MIN_MS * 11);
            
            if ((sportUpdateStatus.tennis.hasLiveMatch || hasUpcomingTennis) &&
                now - sportUpdateStatus.tennis.lastQuickUpdate >= TEN_MIN_MS) {
                const logMsg = sportUpdateStatus.tennis.hasLiveMatch ? 
                    "🎾 [HIZLI DÖNGÜ] Canlı tenis maçı var" : 
                    "🎾 [YAKLAŞAN] Yaklaşan tenis maçı";
                console.log(`${logMsg} - Bugünün verileri güncelleniyor...`);
                const tennisResult = await updateTennis([getTRDate(0)]);
                sportUpdateStatus.tennis.lastQuickUpdate = now;
                sportUpdateStatus.tennis.nextMatchTime = tennisResult.nextMatchTimestamp;
            }
            
            let sleepTime = TEN_MIN_MS; 

            const isFootballActive = sportUpdateStatus.football.hasLiveMatch || 
                (sportUpdateStatus.football.nextMatchTime && now >= (sportUpdateStatus.football.nextMatchTime - ONE_MIN_MS * 12));

            if (isFootballActive) {
                sleepTime = ONE_MIN_MS;
                console.log("⚡ Aktif futbol takibi, 1 dakika sonra kontrol...");
            } 
            else if (sportUpdateStatus.basketball.hasLiveMatch || hasUpcomingBasketball || 
                     sportUpdateStatus.tennis.hasLiveMatch || hasUpcomingTennis) {
                
                let timeToNextBask = TEN_MIN_MS;
                let timeToNextTen = TEN_MIN_MS;

                if (sportUpdateStatus.basketball.hasLiveMatch || hasUpcomingBasketball) {
                    timeToNextBask = TEN_MIN_MS - (now - sportUpdateStatus.basketball.lastQuickUpdate);
                }
                
                if (sportUpdateStatus.tennis.hasLiveMatch || hasUpcomingTennis) {
                    timeToNextTen = TEN_MIN_MS - (now - sportUpdateStatus.tennis.lastQuickUpdate);
                }

                sleepTime = Math.min(timeToNextBask, timeToNextTen);
                if (sleepTime < ONE_MIN_MS) sleepTime = ONE_MIN_MS;

                const sleepMin = Math.ceil(sleepTime / 60000);
                console.log(`⏱️ Basketbol/Tenis takibi: Terminal beklemede, sonraki uyandırma ${sleepMin} dakika sonra...`);
            } 
            else {
                console.log("💤 Hiç maç yok, 10 dakika derin uyku modu...");
            }

            await new Promise(r => setTimeout(r, sleepTime));
            iteration++;

        } catch (e) { 
            console.error("🚨 Hata:", e.message); 
            await new Promise(r => setTimeout(r, ONE_MIN_MS));
        }
    }
}

main();
