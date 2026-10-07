const fs = require('fs');
const admin = require('firebase-admin');
const apn = require('apn');
const xml2js = require('xml2js');

require('events').EventEmitter.defaultMaxListeners = 100;

// =========================================================================
// 🔥 AYARLAR
// =========================================================================
const IS_PRODUCTION = true;
const STATE_FILE = 'futbol_states.json';
const GITHUB_USER = "elfcrzgr";
const REPO_NAME = "macsaati-backend";
const MINUTE_MS = 60000;

// 🚨 Telegram bilgilerini koda gömme: ortam değişkeninden oku
// Termux'ta: export TELEGRAM_BOT_TOKEN="..." ; export TELEGRAM_CHAT_ID="..."
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

// 🕐 FotMob XML'indeki saatler (time ve gs) TR saatinden 1 saat geride geliyor.
// Azerbaycan-Litvanya maçıyla doğrulandı: XML 15:00 / gs 15:01:29 dedi, gerçek başlangıç 16:01 (TR).
// Bir gün FotMob düzelirse bunu 0 yapın.
const FOTMOB_TIME_OFFSET_MS = 60 * 60 * 1000;

// 👶 U21 milli takım/lig maçları listeye alınmaz (takım adı veya lig adında "U21" / "Under 21" geçenler)
const EXCLUDE_U21 = true;
const U21_RE = /\bU[-\s]?21\b|\bunder[-\s]?21\b/i;

// 🚫 FotMob iptal edilen bazı maçlara "bitti" (F) statüsü ve 0-0 skor veriyor.
// true: bitti görünüp başlama kaydı (gs) olmayan 0-0 maçlar iptal sayılır ve listeye girmez.
// Gerçek bir 0-0 maç yanlışlıkla kaybolursa bunu false yapın.
const HIDE_FINISHED_WITHOUT_START = true;

// 👶 Genç takım maçları listeye alınmaz (lig adında ya da takım adında geçerse).
// Başka yaş grupları da çıksın isterseniz örneğin (U19|U20|U21|U23) yazın.
const EXCLUDE_YOUTH_REGEX = /\b(U[-\s]?21|under[-\s]?21)\b/i;

// 🔎 Hata ayıklama: true iken bilinmeyen statü değerlerini ve gelen yeni ligleri loglar
const DEBUG_UNKNOWN = true;

// =========================================================================
// 🔥 FIREBASE & APNs
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
// 🧠 GLOBAL HAFIZA
// =========================================================================
const previousMatchStates = new Map();
const pendingGoalCancel = new Map();
const globalFootballCache = new Map();
const dateIndex = new Map(); // tarih -> o tarihte taranan maç id'leri
const triggeredMatches = new Set();
const seenUnknownStatuses = new Set();
const seenUnknownLeagues = new Set();
let lastLiveRawLog = 0;
const suspectLogged = new Set();
let fotmobBlockedUntil = 0; // 403/429 sonrası geçici bekleme

const sportUpdateStatus = {
    lastQuickUpdate: 0,
    nextMatchTime: null,
    hasLiveMatch: false
};

function saveState() {
    fs.writeFileSync(STATE_FILE, JSON.stringify(Object.fromEntries(previousMatchStates)));
}

function loadState() {
    if (!fs.existsSync(STATE_FILE)) return;
    try {
        const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        for (const [key, val] of Object.entries(data)) previousMatchStates.set(key, val);
        console.log(`📂 [HAFIZA-FUTBOL] ${previousMatchStates.size} maç durumu dosyadan yüklendi.`);
    } catch (e) {
        console.error("❌ Hafıza dosyası okunamadı, yeni başlatılıyor.");
    }
}

// =========================================================================
// 🌉 HARİCİ YAYINCI DOSYASI (SPOREKRANI)
// =========================================================================
let externalBroadcasters = {};

async function loadExternalBroadcasters() {
    try {
        const url = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/yayinci_bilgisi.json?t=${Date.now()}`;
        const response = await fetch(url, { signal: timeoutSignal(10000) });
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

                if (matchScore === 2 && diff <= 300) return { kanal: m.yayin, source: "sporekrani" };
                if (matchScore === 1 && diff <= 15 && dateKey === dateStr) return { kanal: m.yayin, source: "sporekrani" };
            }
        }
    }
    return { kanal: fallback, source: "fallback" };
}

// =========================================================================
// 🛠️ YARDIMCI FONKSİYONLAR
// =========================================================================
let lastBanAlertTime = 0;

// ⏱️ Zaman aşımı yardımcıları: tek bir takılan ağ isteği tüm döngüyü dondurmasın
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

async function sendTelegram(text) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.log("⚠️ [TELEGRAM] Token veya Chat ID boş. start.sh ile çalıştırın.");
        return false;
    }
    try {
        const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
            signal: timeoutSignal(10000)
        });
        const data = await res.json().catch(() => null);
        if (data && data.ok) return true;
        console.error("❌ [TELEGRAM] Hata:", data ? data.description : `HTTP ${res.status}`);
    } catch (e) {
        console.error("❌ [TELEGRAM] Bağlantı hatası:", e.message);
    }
    return false;
}

async function notifyAdminForBan(reason) {
    const now = Date.now();
    if (now - lastBanAlertTime < 1800000) return; // en fazla 30 dakikada bir mesaj
    const ok = await sendTelegram(`🚨 Maç Saati Sunucu Uyarısı\nFotMob sorunu: ${reason}`);
    if (ok) lastBanAlertTime = now;
}

async function uploadToFirebase(data) {
    try {
        await withTimeout(firebaseApp.database().ref(`matches_football`).set(data), 15000, 'Firebase yazma');
    } catch (error) {
        console.error(`❌ [FIREBASE-FUTBOL] Hata:`, error.message);
    }
}

const getTRDate = (offset = 0) => {
    const istStr = new Date().toLocaleString('en-US', { timeZone: 'Europe/Istanbul' });
    const ist = new Date(istStr);
    ist.setDate(ist.getDate() + offset);
    return `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-${String(ist.getDate()).padStart(2, '0')}`;
};

function getIstanbulNow() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }));
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
// ⚽ LİG YAPILANDIRMASI (FOTMOB ID'LERİ!)
// =========================================================================
// ⚠️ FotMob lig ID'leri Sofascore'dan FARKLIDIR. Aşağıdaki liste başlangıç içindir;
// DEBUG_UNKNOWN açıkken konsolda "yeni lig" olarak görünen lig ID'lerini buraya ekleyin.
// Emin olmadığım ID'lerin yanına (?) koydum, loglardan doğrulayın.
const footballLeagues = {
    47: "İngiltere Premier Lig",
    87: "İspanya La Liga",
    54: "Almanya Bundesliga",
    55: "İtalya Serie A",
    53: "Fransa Ligue 1",
    71: "Türkiye Süper Lig",
    57: "Hollanda Eredivisie",
    61: "Portekiz Primeira Liga",
    40: "Belçika Pro League",
    42: "UEFA Şampiyonlar Ligi",
    73: "UEFA Avrupa Ligi",
    10216: "UEFA Konferans Ligi",
    77: "FIFA Dünya Kupası",
    50: "UEFA EURO",
    44: "Copa America",
    289: "Afrika Uluslar Kupası",
    9806: "UEFA Uluslar Ligi",
    114: "Uluslararası Hazırlık Maçları", // (?)
    130: "MLS",
    538: "Pro League",
    268: "Série A",
    112: "Liga Profesional"
};

// Hangi ligler listede gösterilsin? Boş bırakırsanız (ALLOWED_LEAGUES.size === 0) TÜM ligler gelir.
const ALLOWED_LEAGUES = new Set(Object.keys(footballLeagues).map(Number));
// Bu ülke kodlarındaki (FotMob "ccode") tüm ligler ayrıca kabul edilir (ör. tüm Türkiye ligleri)
const ALLOWED_COUNTRY_CODES = new Set(["TUR"]);

const ELITE_FOOT_IDS = new Set([47, 87, 54, 55, 53, 71, 57, 61, 40, 42, 73, 10216, 77, 50, 44, 289, 9806]);
// Milli takım ligleri: bayraklar repodaki tennis/logos/<kod>.png'den gelir
const NATIONAL_LEAGUES = new Set([77, 50, 44, 289, 9806, 114]);

// FotMob grup/aşama bazlı ayrı ID'ler kullanır (ör. Uluslar Ligi A Grup 3 = 920743).
// Bu yüzden milli takım turnuvalarını ID yerine isimden yakalıyoruz.


const LEAGUE_NAME_RULES = [
    { re: /uefa nations league/i,            tr: "UEFA Uluslar Ligi",             logoId: 9806, national: true, elite: true },
    { re: /world cup/i,                      tr: "FIFA Dünya Kupası",             logoId: 77,   national: true, elite: true },
    { re: /^(uefa )?euro(pean championship)?\b/i, tr: "UEFA EURO",              logoId: 50,   national: true, elite: true },
    { re: /africa cup of nations/i,          tr: "Afrika Uluslar Kupası",         logoId: 289,  national: true, elite: true },
    { re: /copa america/i,                   tr: "Copa America",                  logoId: 44,   national: true, elite: true },
    { re: /^friendlies$/i,                   tr: "Uluslararası Hazırlık Maçları", logoId: 114,  national: true, elite: false, intOnly: true },
    { re: /s[eé]rie a/i,                     tr: "Brezilya Série A",              logoId: 268,  elite: true },
    { re: /\bmls\b|major league soccer/i,    tr: "MLS",                           logoId: 130,  elite: true },
    { re: /liga profesional/i,               tr: "Arjantin Liga Profesional",     logoId: 112,  elite: true },
    { re: /saudi.*league|roshn.*league/i,    tr: "Suudi Arabistan Pro Lig",       logoId: 538,  elite: true }
];


// 🚫 Listelenmeyecek maçlar: (1) "U" + sayı içeren her takım/lig (U17, U19, U21, U23, Under-20...), (2) tüm kadın maçları
const YOUTH_RE = /\bU[- ]?\d{2}\b|\bunder[- ]?\d{2}\b/i;
const WOMEN_RE = /\(W\)|\bwomen'?s?\b|\bfemin|\bfemen|\bfemmin|\bkvinner\b|\bfrauen\b|\bdamen\b|\bladies\b|\bvrouwen\b|\bkad[ıi]nlar?\b|\bNWSL\b|\bWSL\b|toppserien|damallsvenskan|\bliga f\b/i;
function isExcludedMatch(homeName, awayName, leagueName) {
    const names = [homeName, awayName, leagueName].map(n => String(n || ''));
    return names.some(n => YOUTH_RE.test(n) || WOMEN_RE.test(n));
}

function matchLeagueRule(name, ccode) {
    const isInt = String(ccode || "").toUpperCase() === 'INT';
    for (const r of LEAGUE_NAME_RULES) {
        if (r.intOnly && !isInt) continue;
        if (r.re.test(String(name || "").trim())) return r;
    }
    return null;
}

function isAllowedLeague(leagueId, ccode, leagueName) {
    if (ALLOWED_LEAGUES.size === 0) return true;
    if (matchLeagueRule(leagueName, ccode)) return true;
    if (ALLOWED_LEAGUES.has(leagueId)) return true;
    if (ccode && ALLOWED_COUNTRY_CODES.has(String(ccode).toUpperCase())) return true;
    return false;
}

const getFootBroadcaster = (leagueId, hName, aName, leagueName) => {
    const hn = (hName || "").toLowerCase();
    const an = (aName || "").toLowerCase();
    const ln = (leagueName || "").toLowerCase();
    const isTurkey = hn.includes("turkey") || an.includes("turkey") || hn.includes("türkiye") || an.includes("türkiye");
    const isPlayoff = ln.includes("play-off") || ln.includes("playoff");

    if (leagueId === 77 || ln.includes("world cup qual") || ln.includes("dünya kupası eleme")) {
        if (isTurkey) return isPlayoff ? "TV8" : "TRT 1 / Tabii";
        return isPlayoff ? "Exxen" : "S Sport Plus";
    }

    const staticConfigs = {
        47: "S Sport Plus", 87: "beIN Sports", 55: "S Sport Plus", 53: "beIN Sports",
        71: "beIN Sports", 57: "beIN Sports", 40: "beIN Sports", 50: "S Sport Plus"
    };
    if (staticConfigs[leagueId]) return staticConfigs[leagueId];
    return "Resmi Yayıncı / Canlı Skor";
};

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
    "thailand": "Tayland", "kuwait": "Kuveyt", "myanmar": "Myanmar", "lithuania": "Litvanya" , "Latvia": "Letonya", 
    "Rwanda": "Ruanda", "Faroe Islands": "Forea Adaları", "Estonia": "Estonya", "san marino": "San Marino",
    "moldova": "Moldova","kosovo": "Kosova", "republic of ireland": "İrlanda", "trinidad and tobago": "Trinidad ve Tobago",
    "guatemala": "Guatemala", "cuba": "Küba", "suriname": "Sürinam", "burkina faso": "Burkina Faso", "equatorial guinea": "Ekvator Ginesi", "gambia": "Gambiya",
    "mauritania": "Moritanya", "guinea-bissau": "Gine-Bissau", "angola": "Angola", "tanzania": "Tanzanya", "uganda": "Uganda", "zambia": "Zambiya",
    "singapore": "Singapur", "malaysia": "Malezya", "vietnam": "Vietnam", "turkmenistan": "Türkmenistan", "kyrgyzstan": "Kırgızistan",
    "palestine": "Filistin", "lebanon": "Lübnan"
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

const nationalTeamCodes = {
    "turkey": "tr", "türkiye": "tr", "germany": "de", "france": "fr", "england": "en",
    "spain": "es", "italy": "it", "portugal": "pt", "netherlands": "nl", "belgium": "be",
    "switzerland": "ch", "austria": "at", "croatia": "hr", "brazil": "br", "argentina": "ar",
    "usa": "us", "united states": "us", "mexico": "mx", "ecuador": "ec", "south korea": "kr", "japan": "jp",
    "uruguay": "uy", "colombia": "co", "chile": "cl", "peru": "pe", "venezuela": "ve",
    "paraguay": "py", "bolivia": "bo", "canada": "ca", "costa rica": "cr", "jamaica": "jm",
    "senegal": "sn", "morocco": "ma", "egypt": "eg", "tunisia": "tn", "nigeria": "ng",
    "cameroon": "cm", "ghana": "gh", "ivory coast": "ci", "algeria": "dz", "australia": "au",
    "iran": "ir", "saudi arabia": "sa", "qatar": "qa", "denmark": "dk", "sweden": "se",
    "norway": "no", "poland": "pl", "ukraine": "ua", "czech republic": "cz", "czechia": "cz", "serbia": "rs",
    "hungary": "hu", "romania": "ro", "greece": "gr", "slovakia": "sk", "wales": "wa",
    "scotland": "sc", "ireland": "ie", "albania": "al", "north macedonia": "mk", "georgia": "ge",
    "slovenia": "si", "iceland": "is", "finland": "fi", "bosnia & herzegovina": "ba",
    "bosnia and herzegovina": "ba", "new zealand": "nz"
};

// =========================================================================
// 🔥 FOTMOB: LOGO, DURUM, DAKİKA
// =========================================================================
const fotmobTeamLogo = (id) => `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`;
const fotmobLeagueLogo = (id) => `https://images.fotmob.com/image_resources/logo/leaguelogo/${id}.png`;
const flagLogo = (code) => `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/${code}.png`;

// "04.10.2026 20:45" | "20:45" -> { date: "2026-10-04", time: "20:45" }
function parseFotMobTime(rawTime, fallbackDate) {
    let date = fallbackDate;
    let time = "00:00";
    const str = String(rawTime || "").trim();

    const dm = str.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (dm) date = `${dm[3]}-${dm[2]}-${dm[1]}`;

    const tm = str.match(/(\d{1,2})[:.](\d{2})(?!.*\d{1,2}[:.]\d{2})/);
    if (tm) time = `${tm[1].padStart(2, '0')}:${tm[2]}`;

    return { date, time };
}

// Eski Sofascore'daki statusCode değerleri: 6 = 1. yarı, 7 = 2. yarı, 31 = devre arası
function estimateMinute(elapsedMin) {
    const e = Math.max(0, elapsedMin);
    if (e <= 50) return { code: 6, min: e + 1, label: `${e + 1}'` };
    if (e <= 63) return { code: 31, min: 45, label: "İY" };
    const m = Math.max(46, e - 17);
    if (m <= 90) return { code: 7, min: m, label: `${m}'` };
    return { code: 7, min: 90, label: "90+'" };
}

// "04.10.2026 15:01:29" (İstanbul saati) -> ms. FotMob'un 'gs' alanı maçın GERÇEK başlama zamanıdır.
function parseGameStart(gs) {
    const m = String(gs || "").match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    const ms = new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4].padStart(2, '0')}:${m[5]}:${m[6] || '00'}+03:00`).getTime();
    return isNaN(ms) ? null : ms + FOTMOB_TIME_OFFSET_MS;
}

const actualStartById = new Map(); // maç id -> gerçek başlama zamanı (ms)

function normalizeStatus(attr, startMs) {
    const raw = String(attr.Status ?? attr.status ?? '').trim().toUpperCase();
    const hasScore = attr.hScore !== undefined && attr.hScore !== '' && attr.aScore !== undefined && attr.aScore !== '';
    const gsMs = parseGameStart(attr.gs);
    const sinceScheduled = Math.floor((Date.now() - startMs) / 60000);
    // Dakika hesabı planlanan saatten değil, maçın gerçek başlama zamanından (gs) yapılır
    const elapsedMin = Math.floor((Date.now() - (gsMs || startMs)) / 60000);

    const KNOWN_STATUSES = ['', 'NS', 'S', 'HT', 'F', 'FT', 'AET', 'PEN', 'AP', 'C', 'CANC', 'CANCELED', 'CANCELLED', 'CAN', 'A', 'ABD', 'AB', 'ABAN', 'P', 'PP', 'POSTP', 'POSTPONED'];
    if (DEBUG_UNKNOWN && !KNOWN_STATUSES.includes(raw) && !seenUnknownStatuses.has(`x/${raw}`)) {
        seenUnknownStatuses.add(`x/${raw}`);
        console.log(`🔎 [STATÜ] Bilinmeyen Status "${raw}" | attrs: ${JSON.stringify(attr)}`);
    }

    if (['F', 'FT', 'AET', 'PEN', 'AP'].includes(raw)) {
        // İptal edilen maç "bitti" olarak gelebilir: oynanmışsa başlama zamanı (gs) olur.
        const zeroZero = String(attr.hScore) === '0' && String(attr.aScore) === '0';
        const finishedBeforeKickoff = !gsMs && sinceScheduled < -5;      // planlanan saatten önce "bitti" olamaz
        const noStartRecorded = !gsMs && zeroZero;                         // hiç başlamamış 0-0
        if (finishedBeforeKickoff || (HIDE_FINISHED_WITHOUT_START && noStartRecorded)) {
            if (!suspectLogged.has(attr.id)) {
                suspectLogged.add(attr.id);
                console.log(`🚫 [İPTAL?] ${attr.hTeam} - ${attr.aTeam} "bitti" görünüyor ama başlama kaydı yok, listeden çıkarıldı | attrs: ${JSON.stringify(attr)}`);
            }
            return { status: 'canceled', code: 0, label: '', min: 0 };
        }
        return { status: 'finished', code: 100, label: 'MS', min: 90 };
    }
    if (['C', 'CANC', 'CANCELED', 'CANCELLED', 'CAN', 'A', 'ABD', 'AB', 'ABAN'].includes(raw)) return { status: 'canceled', code: 0, label: '', min: 0 };
    if (['P', 'PP', 'POSTP', 'POSTPONED'].includes(raw)) return { status: 'postponed', code: 0, label: '', min: 0 };

    if (raw === 'HT') return { status: 'inprogress', code: 31, label: 'İY', min: 45 };

    // Başlamamış maç
    if (raw === 'NS' || raw === '' && !hasScore || !hasScore || (!gsMs && sinceScheduled < -2)) {
        return { status: 'notstarted', code: 0, label: '', min: 0 };
    }

    // Güvenlik: 4 saatten uzun "canlı" görünen maç aslında bitmiştir
    if (elapsedMin > 240) return { status: 'finished', code: 100, label: 'MS', min: 90 };

    if (DEBUG_UNKNOWN) {
        const key = `${raw}/${attr.stage ?? ''}/${attr.sId ?? ''}${attr.shs ? '/shs' : ''}`;
        if (!seenUnknownStatuses.has(key)) {
            seenUnknownStatuses.add(key);
            console.log(`🔎 [STATÜ] Yeni Status/stage: "${key}" | geçen: ${elapsedMin} dk | attrs: ${JSON.stringify(attr)}`);
        }
    }

    // FotMob dakikayı doğrudan veriyorsa onu kullan (alan adı bilinmiyor, olası adayları dene)
    for (const key of ['min', 'minute', 'liveTime', 'timeStr']) {
        const v = attr[key];
        if (v !== undefined && /^\d{1,3}(\+\d+)?$/.test(String(v).trim())) {
            const n = parseInt(v, 10);
            return { status: 'inprogress', code: n > 45 ? 7 : 6, label: `${String(v).trim()}'`, min: n };
        }
    }

    // 🎯 FotMob'un verdiği yarı başlangıçları: shs = 2. yarı başlangıcı, gs = maç başlangıcı
    const shsMs = parseGameStart(attr.shs);
    // 'ijt' = "ilkYarıİlave,ikinciYarıİlave" (ör. "1" -> sadece ilk yarı, "1,4" -> ikinci yarı +4)
    const ijtParts = String(attr.ijt ?? '').split(',').map(x => parseInt(x, 10) || 0);
    const inj1 = ijtParts[0] || 0;
    const inj2 = ijtParts[1] || 0;
    if (shsMs) {
        // Devam eden dakika gösterilir: 2. yarının ilk dakikası 46'
        const m = 46 + Math.max(0, Math.floor((Date.now() - shsMs) / 60000));
        return { status: 'inprogress', code: 7, label: `${m}'`, min: m, inj1, inj2 };
    }
    // sId: 2 = ilk yarı, 10 = devre arası, 3 = ikinci yarı (Kosova-Avusturya ve Azerbaycan-Litvanya maçlarında gözlendi)
    if (String(attr.sId) === '10') return { status: 'inprogress', code: 31, label: 'İY', min: 45 };

    if (gsMs) {
        const e = Math.max(0, elapsedMin);
        // Devam eden dakika gösterilir: 0:00-0:59 -> 1', 47:15 -> 48'
        if (e <= 55) return { status: 'inprogress', code: 6, label: `${e + 1}'`, min: e + 1, inj1 };
        // sId gelmemiş ve 55 dk geçmişse yine de devre arasıdır
        return { status: 'inprogress', code: 31, label: 'İY', min: 45 };
    }

    const est = estimateMinute(elapsedMin);
    return { status: 'inprogress', code: est.code, label: est.label, min: est.min };
}

// 🔥 FOTMOB XML VERİ ÇEKME. Hata olursa null, gerçekten boşsa [] döner.
async function fetchFotMobMatches(dateStr) {
    if (Date.now() < fotmobBlockedUntil) return null;
    try {
        await new Promise(r => setTimeout(r, Math.floor(Math.random() * 500) + 200));

        const formattedDate = dateStr.replace(/-/g, '');
        const url = `https://api3.fotmob.com/matches?date=${formattedDate}&tz=10800000&tzone=Europe%2FIstanbul`;

        const response = await fetch(url, {
            signal: timeoutSignal(15000),
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
            console.log(`⚠️ FotMob reddi (HTTP ${response.status}) -> ${dateStr}`);
            if (response.status === 403 || response.status === 429) {
                fotmobBlockedUntil = Date.now() + 10 * MINUTE_MS;
                console.log("⛔ FotMob istekleri 10 dakika durduruldu.");
            }
            notifyAdminForBan(`HTTP ${response.status}`);
            return null;
        }

        const xmlText = await response.text();

        return await new Promise((resolve) => {
            xml2js.parseString(xmlText, { explicitArray: false }, (err, result) => {
                if (err || !result || !result.live || !result.live.exmatches) return resolve([]);

                let leagues = result.live.exmatches.league;
                if (!leagues) return resolve([]);
                if (!Array.isArray(leagues)) leagues = [leagues];

                const parsed = [];

                leagues.forEach(league => {
                    const lAttr = league.$ || {};
                    const leagueId = Number(lAttr.id);
                    const ccode = lAttr.ccode || lAttr.country || "";

                    let matches = league.match;
                    if (!matches) return;
                    if (!Array.isArray(matches)) matches = [matches];

                    if (EXCLUDE_U21 && U21_RE.test(String(lAttr.name || ''))) return;
                    const rule = matchLeagueRule(lAttr.name, ccode);
                    if (!isAllowedLeague(leagueId, ccode, lAttr.name)) {
                        if (DEBUG_UNKNOWN && !seenUnknownLeagues.has(leagueId)) {
                            seenUnknownLeagues.add(leagueId);
                            console.log(`🔎 [LİG] Filtrelendi: id=${leagueId} | ${lAttr.name} | ccode=${ccode}`);
                        }
                        return;
                    }

                    if (EXCLUDE_YOUTH_REGEX.test(String(lAttr.name || ''))) return;

                    matches.forEach(m => {
                        const attr = m.$ || {};
                        if (isExcludedMatch(attr.hTeam, attr.aTeam, lAttr.name)) return;
                        if (EXCLUDE_YOUTH_REGEX.test(String(attr.hTeam || '')) || EXCLUDE_YOUTH_REGEX.test(String(attr.aTeam || ''))) return;
                        if (EXCLUDE_U21 && (U21_RE.test(String(attr.hTeam || '')) || U21_RE.test(String(attr.aTeam || '')))) return;
                        const parsedT = parseFotMobTime(attr.time, dateStr);
                        const rawStartMs = new Date(`${parsedT.date}T${parsedT.time}:00+03:00`).getTime();
                        if (isNaN(rawStartMs)) return;
                        const startMs = rawStartMs + FOTMOB_TIME_OFFSET_MS;
                        // Uygulamada ve yayıncı eşleştirmesinde görünen tarih/saat düzeltilmiş (TR) saattir
                        const sd = new Date(startMs);
                        const date = sd.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
                        const time = sd.toLocaleTimeString('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

                        const st = normalizeStatus(attr, startMs);
                        if (st.status === 'canceled' || st.status === 'postponed') return;

                        if (DEBUG_UNKNOWN && st.status === 'inprogress' && Date.now() - lastLiveRawLog > 55000) {
                            lastLiveRawLog = Date.now();
                            console.log(`🔎 [CANLI-HAM] ${attr.hTeam} - ${attr.aTeam} | ${JSON.stringify(attr)} | hesaplanan: ${st.label}`);
                        }

                        parsed.push({
                            id: Number(attr.id),
                            leagueId,
                            rule,
                            leagueName: lAttr.name || "Futbol",
                            ccode,
                            home: { id: Number(attr.hId), name: attr.hTeam || "" },
                            away: { id: Number(attr.aId), name: attr.aTeam || "" },
                            hScoreRaw: attr.hScore,
                            aScoreRaw: attr.aScore,
                            st,
                            actualStartMs: parseGameStart(attr.shs) || parseGameStart(attr.gs),
                            date, time, startMs
                        });
                    });
                });

                console.log(`📊 [${dateStr}] FotMob: ${leagues.length} lig geldi, ${parsed.length} maç kabul edildi.`);
                resolve(parsed);
            });
        });
        } catch (e) {
        console.error("❌ FotMob çekme hatası:", e.message);
        notifyAdminForBan(`Bağlantı hatası: ${e.message}`);
        return null;
    }
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

        await withTimeout(firebaseApp.messaging().send(payload), 10000, 'FCM gönderimi');
        lastNotificationTime.set(id, now);
        console.log(`✅ [BİLDİRİM] ${title}: ${body}`);
    } catch (e) {
        console.error("❌ Bildirim Hatası:", e.message);
    }
}

// ⚽ Gol atan oyuncu: gol anında 1 ek istek (maç detayı). Alınamazsa null döner, bildirimde takım adı kullanılır.
// ⚠️ Bu uç noktanın biçimi doğrulanmadı: ilk denemede konsola ne geldiğini yazar.
const goalWarned = new Set();
function goalWarn(msg) {
    const k = msg.slice(0, 40);
    if (goalWarned.has(k)) return; // aynı uyarıyı tekrar tekrar basma
    goalWarned.add(k);
    console.log(`⚠️ [GOL-DETAY] ${msg}`);
}

// 1) Mobil API
async function fetchEventsFromMobileApi(matchId) {
    const res = await fetch(`https://api3.fotmob.com/matchDetails?matchId=${matchId}`, {
        signal: timeoutSignal(5000),
        headers: {
            "Host": "api3.fotmob.com",
            "fotmob-version": "1243.0",
            "Accept": "application/json, application/xml, */*",
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FotMob",
            "Accept-Language": "tr-TR,tr;q=0.9"
        }
    });
    const text = await res.text();
    if (!res.ok) { goalWarn(`mobil API HTTP ${res.status} | ${text.slice(0, 150)}`); return null; }
    let data = null;
    try { data = JSON.parse(text); } catch (e) {}
    if (!data) { goalWarn(`mobil API JSON değil, ilk 200 karakter: ${text.slice(0, 200)}`); return null; }
    const ev = data?.content?.matchFacts?.events?.events || data?.events;
    if (!Array.isArray(ev)) { goalWarn(`mobil API'de olay listesi yok. Anahtarlar: ${Object.keys(data).join(', ')}`); return null; }
    return ev;
}

// 2) Yedek: sitenin maç sayfasındaki gömülü JSON (__NEXT_DATA__).
// Not: FotMob'un kullanım şartları otomatik erişimi yasaklıyor, gol başına tek istekle sınırlı tutuldu.
async function fetchEventsFromWebPage(matchId) {
    const res = await fetch(`https://www.fotmob.com/match/${matchId}`, {
        signal: timeoutSignal(5000),
        headers: {
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "tr-TR,tr;q=0.9"
        }
    });
    const html = await res.text();
    if (!res.ok) { goalWarn(`web sayfası HTTP ${res.status}`); return null; }
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) { goalWarn("web sayfasında __NEXT_DATA__ bulunamadı"); return null; }
    let d = null;
    try { d = JSON.parse(m[1]); } catch (e) { goalWarn("__NEXT_DATA__ JSON okunamadı"); return null; }
    const content = d?.props?.pageProps?.content;
    const ev = content?.matchFacts?.events?.events;
    if (!Array.isArray(ev)) { goalWarn(`web sayfasında olay listesi yok. content anahtarları: ${Object.keys(content || {}).join(', ')}`); return null; }
    return ev;
}

async function fetchGoalScorerOnce(matchId, totalGoals) {
    let events = null;
    try { events = await fetchEventsFromMobileApi(matchId); } catch (e) { goalWarn(`mobil API hatası: ${e.message}`); }
    if (!events) {
        try { events = await fetchEventsFromWebPage(matchId); } catch (e) { goalWarn(`web sayfası hatası: ${e.message}`); }
    }
    if (!events) return { name: null, complete: true };

    const goals = events.filter(e => e && String(e.type).toLowerCase() === 'goal');
    if (goals.length === 0) return { name: null, complete: false };

    goals.sort((a, b) => ((a.time || 0) + (a.overloadTime || 0) / 100) - ((b.time || 0) + (b.overloadTime || 0) / 100));
    const last = goals[goals.length - 1];
    let name = last.player?.name || last.nameStr || last.fullName || null;
    // FotMob bazen oyuncu belli olana kadar "<TBD>" gibi yer tutucu verir: bunu isim sayma, tekrar dene
    if (name && (/[<>]/.test(name) || /^\s*(tbd|unknown|n\/a|\?)\s*$/i.test(name))) {
        goalWarn(`Gol atan henüz belli değil (yer tutucu: ${name}), tekrar denenecek`);
        name = null;
    }
    if (!name) return { name: null, complete: false };
    if (last.ownGoal || last.isOwnGoal) name += " (K.K.)";
    return { name, complete: goals.length >= totalGoals };
}

async function fetchGoalScorer(matchId, totalGoals) {
    try {
        let r = { name: null, complete: false };
        // Gol hemen yayınlanmayabilir ya da oyuncu henüz atanmamış olabilir: en fazla 3 deneme (0, +7, +14 sn)
        for (let attempt = 0; attempt < 3; attempt++) {
            if (attempt > 0) await new Promise(res => setTimeout(res, 7000));
            r = await fetchGoalScorerOnce(matchId, totalGoals);
            if (r.name) { console.log(`🧑 [GOL-DETAY] Gol atan: ${r.name}${attempt > 0 ? ` (${attempt + 1}. denemede)` : ''}`); return r.name; }
            if (r.complete) break; // istek hatası vb.: tekrar denemenin anlamı yok
        }
        console.log("🧑 [GOL-DETAY] Gol atan alınamadı, takım adı kullanılacak");
        return null;
    } catch (e) {
        console.log(`⚠️ [GOL-DETAY] Alınamadı: ${e.message}`);
        return null;
    }
}

function buildLiveActivityNotification(rawPayload) {
    const notification = new apn.Notification();
    notification.rawPayload = rawPayload;
    notification.topic = "com.elfcrzgr.macsaati.push-type.liveactivity";
    notification.pushType = "liveactivity";
    notification.priority = 10;

    if (typeof notification.headers === 'function') {
        const originalHeadersFn = notification.headers.bind(notification);
        notification.headers = function () {
            const h = originalHeadersFn();
            h["apns-push-type"] = "liveactivity";
            h["apns-priority"] = "10";
            return h;
        };
    }
    return notification;
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

        // Skor geri düşerse (veri hatası) eski skoru koru
        if (match.status === 'inprogress' && currentMinNum > 0 && prev.lastMinute > 0 && currentMinNum < prev.lastMinute) {
            currH = prev.homeScore; currA = prev.awayScore; match.homeScore = String(currH); match.awayScore = String(currA); currentMinNum = prev.lastMinute;
        }

        const statusType = match.status;
        const isLive = statusType === 'inprogress';
        const isFinished = ['finished', 'ended', 'closed'].includes(statusType);
        const minuteChanged = liveMin !== prev.liveMinuteStr;
        const scoreChanged = currH !== prev.homeScore || currA !== prev.awayScore;
        const statusChanged = statusType !== prev.status;

        // ---- Live Activity güncellemeleri ----
        if ((isLive || isFinished) && (minuteChanged || scoreChanged || statusChanged)) {
            let tokensObj = null;
            try {
                const snapshot = await withTimeout(firebaseApp.database().ref(`live_activity_tokens/${matchIdStr}`).once('value'), 8000, 'Token okuma');
                tokensObj = snapshot.val();
            } catch (e) {
                console.error(`❌ Live Activity token okunamadı (${matchIdStr}):`, e.message);
            }

            if (tokensObj) {
                const promises = Object.keys(tokensObj).map(async (deviceToken) => {
                    const notification = buildLiveActivityNotification({
                        aps: {
                            timestamp: Math.floor(Date.now() / 1000),
                            event: isFinished ? 'end' : 'update',
                            "content-state": { homeScore: currH, awayScore: currA, matchMinute: isFinished ? "MS" : String(liveMin) }
                        }
                    });

                    try {
                        const result = await withTimeout(apnProvider.send(notification, deviceToken), 8000, 'APNs');
                        if (result.failed.length > 0) {
                            const err = result.failed[0];
                            const errorReason = err.response ? err.response.reason : err.error;
                            console.log(`❌ APNs Hata (${matchIdStr}): Token reddedildi. Sebep: ${errorReason}`);
                            if (errorReason === 'BadDeviceToken' || errorReason === 'Unregistered') {
                                await firebaseApp.database().ref(`live_activity_tokens/${matchIdStr}/${deviceToken}`).remove();
                            }
                        }
                    } catch (e) {
                        console.error(`❌ APNs Sunucu Bağlantı Hatası:`, e.message);
                    }
                });
                await Promise.all(promises);
            }
        }

        // ---- Normal push bildirimleri ----
        const appTitle = "Maç Saati";
        const whistleIconUrl = "https://img.icons8.com/color/96/whistle.png";
        const substitutionBoardUrl = "https://img.icons8.com/color/96/stopwatch--v1.png";

        if (match.status === 'inprogress' && !prev.hasNotifiedStart) {
            // Sunucu yeniden başlayıp maçı ortadan yakalarsa "Maç Başladı" atma
            if (prev.status === 'notstarted' || currentMinNum <= 3) {
                await sendPush(matchIdStr, appTitle, `⚽ Maç Başladı!\n${match.homeTeam.name} - ${match.awayTeam.name}`, null, match);
            }
            prev.hasNotifiedStart = true;
        } else if (match.status === 'inprogress' && match.statusCode === 6 && tObj.injuryTime1 && !prev.hasNotifiedInjuryTime1) {
            await sendPush(matchIdStr, `İlk yarı ilave süre: +${tObj.injuryTime1}'`, `${match.homeTeam.name} - ${match.awayTeam.name}`, substitutionBoardUrl, match);
            prev.hasNotifiedInjuryTime1 = true;
        } else if (match.status === 'inprogress' && (liveMin === "İY" || match.statusCode === 31) && !prev.hasNotifiedHT) {
            await sendPush(matchIdStr, appTitle, `⏱️ İlk Yarı Sonucu\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`, whistleIconUrl, match);
            prev.hasNotifiedHT = true;
        } else if (match.status === 'inprogress' && prev.hasNotifiedHT && liveMin !== "İY" && match.statusCode !== 31 && !prev.hasNotifiedSH && match.statusCode === 7) {
            await sendPush(matchIdStr, appTitle, `▶️ İkinci Yarı Başladı\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`, whistleIconUrl, match);
            prev.hasNotifiedSH = true;
        } else if (match.status === 'inprogress' && match.statusCode === 7 && tObj.injuryTime2 && !prev.hasNotifiedInjuryTime2 && liveMin !== "İY") {
            await sendPush(matchIdStr, `İkinci yarı ilave süre: +${tObj.injuryTime2}'`, `${match.homeTeam.name} - ${match.awayTeam.name}`, substitutionBoardUrl, match);
            prev.hasNotifiedInjuryTime2 = true;
        } else if (isFinished && !prev.hasNotifiedFinished) {
            if (prev.status === 'inprogress') {
                await sendPush(matchIdStr, appTitle, `🏁 Maç Bitti\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`, null, match);
            }
            prev.hasNotifiedFinished = true;
        }

        // ---- Gol bildirimi (VAR iptali için 2 dk bekleme mantığı korundu) ----
        if (match.status === 'inprogress' && prev.status !== null) {
            if (prev.homeScore !== currH || prev.awayScore !== currA) {
                const isGoal = (currH + currA) > (prev.homeScore + prev.awayScore);
                if (isGoal) {
                    // Gol atan oyuncu maç detayından aranır, bulunamazsa golü atan takımın adı yazılır
                    const homeScored = currH > prev.homeScore;
                    const scoringTeam = homeScored ? match.homeTeam : match.awayTeam;
                    const scorerName = (await withTimeout(fetchGoalScorer(match.id, currH + currA), 40000, 'Gol detayı').catch(() => null)) || scoringTeam.name;
                    await sendPush(matchIdStr, appTitle, `⚽ Gol - ${scorerName} (${liveMin})\n${match.homeTeam.name} ${match.homeScore} - ${notifAwayScore} ${match.awayTeam.name}`, scoringTeam.logo, match);
                    pendingGoalCancel.delete(matchIdStr);
                } else {
                    const pending = pendingGoalCancel.get(matchIdStr);
                    if (!pending) {
                        pendingGoalCancel.set(matchIdStr, { homeScore: currH, awayScore: currA, firstSeen: Date.now() });
                        currH = prev.homeScore; currA = prev.awayScore; match.homeScore = String(currH); match.awayScore = String(currA);
                    } else if (pending.homeScore === currH && pending.awayScore === currA) {
                        if (Date.now() - pending.firstSeen >= 120000) {
                            pendingGoalCancel.delete(matchIdStr); match.homeScore = String(currH); match.awayScore = String(currA);
                        } else {
                            currH = prev.homeScore; currA = prev.awayScore; match.homeScore = String(currH); match.awayScore = String(currA);
                        }
                    } else {
                        pendingGoalCancel.delete(matchIdStr); currH = prev.homeScore; currA = prev.awayScore; match.homeScore = String(currH); match.awayScore = String(currA);
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

    const normalTokens = (await withTimeout(firebaseApp.database().ref(`push_to_start_tokens/${matchId}`).once('value'), 8000, 'Push-to-start token okuma')).val();
    const tokensToAlert = normalTokens ? [...new Set(Object.keys(normalTokens))] : [];
    if (tokensToAlert.length === 0) return;

    const cleanHomeScore = match.homeScore && match.homeScore !== "-" ? Number(match.homeScore) : 0;
    const cleanAwayScore = match.awayScore && match.awayScore !== "-" ? Number(match.awayScore) : 0;
    const cleanMinute = match.liveMinute ? String(match.liveMinute).replace("'", "") : "Canlı";

    for (const token of tokensToAlert) {
        const notification = buildLiveActivityNotification({
            aps: {
                timestamp: Math.floor(Date.now() / 1000), event: 'start', "attributes-type": "MacSaatiWidgetAttributes",
                "attributes": { "matchId": String(match.id), "homeTeamName": String(match.homeTeam.name), "awayTeamName": String(match.awayTeam.name), "leagueName": String(match.tournament || "Futbol"), "homeTeamId": match.homeTeam.id ? Number(match.homeTeam.id) : 0, "awayTeamId": match.awayTeam.id ? Number(match.awayTeam.id) : 0, "homeLogoFile": `logo_home_${match.id}.png`, "awayLogoFile": `logo_away_${match.id}.png` },
                "content-state": { "homeScore": cleanHomeScore, "awayScore": cleanAwayScore, "matchMinute": String(cleanMinute) },
                "alert": { "title": "Maç Saati", "body": `${match.homeTeam.name} - ${match.awayTeam.name} canlı takibi başladı!` }
            }
        });
        try { await withTimeout(apnProvider.send(notification, token), 8000, 'APNs'); } catch (e) {}
    }
}

// =========================================================================
// ⚽ FUTBOL GÜNCELLEME
// =========================================================================
async function updateFootball(targetDates = [getTRDate(0)], isQuickScan = false) {
    console.log(`⚽ Futbol (FotMob): (Mod: ${isQuickScan ? '🚀 HIZLI' : '🐢 DETAYLI'}) Tarihler: ${targetDates.join(', ')}`);

    const validDates = [getTRDate(-2), getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2), getTRDate(3)];

    for (const [id, state] of previousMatchStates.entries()) {
        if (state.date && !validDates.includes(state.date) && state.status !== 'inprogress') previousMatchStates.delete(id);
    }

    let anySuccess = false;

    for (const date of targetDates) {
        const events = await fetchFotMobMatches(date);
        if (events === null) continue; // istek başarısız: eski veriyi koru
        anySuccess = true;

        // Bu tarihin eski kayıtlarını temizle (iptal/ertelenen veya listeden düşen maçlar kalmasın)
        for (const oldId of dateIndex.get(date) || []) globalFootballCache.delete(oldId);
        const idSet = new Set();
        dateIndex.set(date, idSet);

        for (const e of events) {
            const hNameRaw = e.home.name;
            const aNameRaw = e.away.name;
            const hName = translateTeam(hNameRaw);
            const aName = translateTeam(aNameRaw);
            const st = e.st;
            const isLive = st.status === 'inprogress';
            const isFinished = st.status === 'finished';

            const fallbackBroadcaster = getFootBroadcaster(e.leagueId, hNameRaw, aNameRaw, e.leagueName);
            const bc = getBroadcasterWithFallback("futbol", e.date, e.time, hName, aName, fallbackBroadcaster);

            const finalHomeScore = (isLive || isFinished) ? String(e.hScoreRaw ?? "0") : "-";
            const finalAwayScore = (isLive || isFinished) ? String(e.aScoreRaw ?? "0") : "-";

            // Logolar: FotMob ID'leri Sofascore ID'lerinden farklı olduğu için FotMob CDN kullanılır.
            let homeLogoUrl = fotmobTeamLogo(e.home.id);
            let awayLogoUrl = fotmobTeamLogo(e.away.id);

            // Milli maçlarda repodaki bayraklar (tennis/logos/<kod>.png)
            const isNationalLeague = !!(e.rule && e.rule.national) || NATIONAL_LEAGUES.has(e.leagueId) || String(e.ccode).toUpperCase() === 'INT';
            if (isNationalLeague) {
                const hCode = nationalTeamCodes[hNameRaw.toLowerCase().trim()];
                const aCode = nationalTeamCodes[aNameRaw.toLowerCase().trim()];
                if (hCode) homeLogoUrl = flagLogo(hCode);
                if (aCode) awayLogoUrl = flagLogo(aCode);
            }

            globalFootballCache.set(e.id, {
                id: e.id,
                isElite: ELITE_FOOT_IDS.has(e.leagueId) || !!(e.rule && e.rule.elite),
                status: st.status,
                statusCode: st.code,
                liveMinute: isLive ? st.label : "",
                fixedDate: e.date,
                fixedTime: e.time,
                timestamp: e.startMs,
                broadcaster: bc.kanal,
                homeTeam: { name: hName, logo: homeLogoUrl, id: e.home.id },
                awayTeam: { name: aName, logo: awayLogoUrl, id: e.away.id },
                homeNameRaw: hNameRaw,
                awayNameRaw: aNameRaw,
                tournamentLogo: fotmobLeagueLogo(e.rule ? e.rule.logoId : e.leagueId),
                homeScore: finalHomeScore,
                awayScore: finalAwayScore,
                setScores: [],
                tournament: (e.rule && e.rule.tr) || footballLeagues[e.leagueId] || e.leagueName,
                timeObj: Object.assign({ currentMinute: st.min }, st.inj1 ? { injuryTime1: st.inj1 } : {}, st.inj2 ? { injuryTime2: st.inj2 } : {})
            });
            if (e.actualStartMs) actualStartById.set(e.id, e.actualStartMs);
            idSet.add(e.id);
        }
    }

    if (!anySuccess) {
        const stillLive = Array.from(globalFootballCache.values()).some(m => m.status === 'inprogress');
        return {
            hasLiveMatch: stillLive || sportUpdateStatus.hasLiveMatch,
            nextMatchTimestamp: sportUpdateStatus.nextMatchTime,
            hasAnyMatches: globalFootballCache.size > 0
        };
    }

    for (const [id, match] of globalFootballCache.entries()) {
        if (!validDates.includes(match.fixedDate)) globalFootballCache.delete(id);
    }

    const matches = Array.from(globalFootballCache.values()).sort((a, b) => a.timestamp - b.timestamp);
    try {
        await withTimeout(checkAndSendNotifications(matches), 60000, 'Bildirim kontrolü');
    } catch (e) {
        console.error("❌ Bildirim kontrolü atlandı:", e.message);
    }
    await uploadToFirebase({ success: true, lastUpdate: new Date().toLocaleTimeString('tr-TR'), matches });

    const hasLiveMatch = matches.some(m => m.status === 'inprogress');
    const nextMatchTimestamp = findNextMatchTime(globalFootballCache);

    try {
        const forcedSnapshot = await withTimeout(firebaseApp.database().ref('forced_matches').once('value'), 8000, 'forced_matches okuma');
        const forcedMatches = forcedSnapshot.val() || {};
        for (const [id] of globalFootballCache.entries()) {
            if (forcedMatches[String(id)] === true && !triggeredMatches.has(String(id))) {
                await triggerPushToStart(id);
                triggeredMatches.add(String(id));
            }
        }
    } catch (e) {
        console.error("❌ Zorunlu maç kontrolü atlandı:", e.message);
    }

    return { hasLiveMatch, nextMatchTimestamp, hasAnyMatches: matches.length > 0 };
}

// =========================================================================
// 🆕 ANA DÖNGÜ: dakikada 1 sorgu, dakika sınırına hizalı
// =========================================================================
// Sorgu, canlı maçın dakika sınırından hemen sonra (PHASE) atılır. Önceki sorgu kaç sn sürerse sürsün,
// bir sonraki sorgu hep aynı saniyeye denk gelir: kayma yok, dakika atlama/tekrar yok.
const LIVE_SCAN_PHASE_MS = 5000;

function computeNextLiveScanAt(scanStart) {
    const liveStarts = Array.from(globalFootballCache.values())
        .filter(m => m.status === 'inprogress')
        .map(m => actualStartById.get(m.id) || m.timestamp);
    if (liveStarts.length === 0) return scanStart + MINUTE_MS;

    const ref = Math.min(...liveStarts);
    let next = scanStart + 30000; // en erken 30 sn sonra
    const offset = (((next - ref) % MINUTE_MS) + MINUTE_MS) % MINUTE_MS;
    next += (LIVE_SCAN_PHASE_MS - offset + MINUTE_MS) % MINUTE_MS;
    return next; // scanStart + 30..90 sn (normalde tam 60 sn)
}

async function main() {
    loadState();
    
    console.log("============================================================");
    console.log("🟢 [FUTBOL - FOTMOB] BAĞIMSIZ SERVİS BAŞLADI");
    console.log("============================================================");

    let lastPeriodicUpdate = 0;
    let lastBroadcastersString = "";
    let expectedWake = 0;
    let nextLiveScanAt = 0;

    const applyResult = (result) => {
        sportUpdateStatus.hasLiveMatch = result.hasLiveMatch;
        sportUpdateStatus.nextMatchTime = result.nextMatchTimestamp;
    };

    while (true) {
        try {
            const now = Date.now();
            if (expectedWake && now - expectedWake > 30000) {
                console.log(`⚠️ Döngü ${Math.round((now - expectedWake) / 1000)} sn geç uyandı: cihaz uykuya geçmiş olabilir (Doze / pil kısıtı / Wi-Fi).`);
            }

            await loadExternalBroadcasters();

            const currentBroadcastersString = JSON.stringify(externalBroadcasters);
            let forceUpdateDueToBroadcasters = false;
            if (lastBroadcastersString !== "" && currentBroadcastersString !== lastBroadcastersString) {
                console.log("📺 [YAYINCI] Yeni yayıncı bilgileri tespit edildi! Firebase anında güncelleniyor...");
                forceUpdateDueToBroadcasters = true;
            }
            lastBroadcastersString = currentBroadcastersString;

            const ist = getIstanbulNow();
            const msSinceMidnight = (ist.getHours() * 3600000) + (ist.getMinutes() * 60000) + (ist.getSeconds() * 1000);
            const startOfDay = now - msSinceMidnight;

            const TARGET_TIMES = [10 * 60 * 1000, 12 * 60 * 60 * 1000]; // 00:10 ve 12:00
            let activeTarget = startOfDay - (5 * 60 + 50) * 60 * 1000;
            for (let i = TARGET_TIMES.length - 1; i >= 0; i--) {
                if (msSinceMidnight >= TARGET_TIMES[i]) { activeTarget = startOfDay + TARGET_TIMES[i]; break; }
            }

            // 🐢 Detaylı tarama: -1 .. +2 gün
            if (lastPeriodicUpdate < activeTarget || forceUpdateDueToBroadcasters) {
                console.log("\n🔄 [PERİYODİK / ZORUNLU] Detaylı Tarama Başlıyor...");
                const days4 = [getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)];
                const result = await withTimeout(updateFootball(days4, false), 150000, 'Detaylı tarama');
                applyResult(result);
                if (!forceUpdateDueToBroadcasters) lastPeriodicUpdate = now;
            }

            // 🚀 Hızlı tarama: sadece bugün (gece 00-04 arası dünü de ekle)
            const currentHour = getIstanbulNow().getHours();
            let quickScanDates = [getTRDate(0)];
            if (currentHour >= 0 && currentHour <= 4) quickScanDates = [getTRDate(-1), getTRDate(0)];

            const isUpcoming = () => sportUpdateStatus.nextMatchTime && Date.now() >= (sportUpdateStatus.nextMatchTime - MINUTE_MS * 1.1);

            if ((sportUpdateStatus.hasLiveMatch || isUpcoming()) && Date.now() >= nextLiveScanAt - 1500) {
                console.log(sportUpdateStatus.hasLiveMatch ? "\n⚽ [HIZLI DÖNGÜ] Canlı futbol maçı var!" : "\n⏰ [FUTBOL YAKLAŞAN] Yaklaşan maç vakti!");
                const scanStart = Date.now();
                const result = await withTimeout(updateFootball(quickScanDates, true), 90000, 'Hızlı tarama');
                sportUpdateStatus.lastQuickUpdate = scanStart;
                applyResult(result);
                nextLiveScanAt = computeNextLiveScanAt(scanStart);
            }

            let sleepTime;
            if (sportUpdateStatus.hasLiveMatch || isUpcoming()) {
                sleepTime = Math.max(1000, nextLiveScanAt - Date.now());
                console.log(`\n⚡ [FUTBOL] Aktif maç var. Sonraki sorgu ${Math.round(sleepTime / 1000)} sn sonra (dakika sınırına hizalı).`);
            } else if (sportUpdateStatus.nextMatchTime && Date.now() >= sportUpdateStatus.nextMatchTime - MINUTE_MS * 12) {
                sleepTime = Math.min(30000, Math.max(1000, sportUpdateStatus.nextMatchTime - MINUTE_MS * 1.1 - Date.now()));
                console.log(`\n⏳ [FUTBOL] Maça az kaldı, ${Math.round(sleepTime / 1000)} sn sonra tekrar bakılacak.`);
            } else {
                sleepTime = 10 * MINUTE_MS;
                console.log("\n💤 [FUTBOL] Şu an hareket yok. 10 dakika derin uyku...");
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


// ===== MAÇ DETAYI (kullanıcı maça tıklayınca) =====
const detailLastFetch = new Map();

async function fetchMatchDetailsRaw(matchId) {
    const res = await fetch(`https://www.fotmob.com/match/${matchId}`, {
        signal: timeoutSignal(10000),
        headers: {
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "tr-TR,tr;q=0.9"
        }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) throw new Error('__NEXT_DATA__ bulunamadı');
    const pageProps = JSON.parse(m[1])?.props?.pageProps;
    if (!pageProps) throw new Error('pageProps yok');
    return pageProps;
}

const fmInt = (v) => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };

// Starters sırası formasyona göre: kaleci, sonra her sıra soldan sağa
function orderStarters(starters, formation) {
    const counts = String(formation || '').split('-').map(Number).filter(n => n > 0);
    const total = 1 + counts.reduce((a, b) => a + b, 0);
    if (starters.length !== total || !starters.every(p => p.verticalLayout)) return starters;
    const sorted = starters.slice().sort((a, b) => a.verticalLayout.y - b.verticalLayout.y);
    const out = [sorted[0]];
    let idx = 1;
    for (const c of counts) {
        const row = sorted.slice(idx, idx + c).sort((a, b) => a.verticalLayout.x - b.verticalLayout.x);
        out.push(...row);
        idx += c;
    }
    return out;
}

function convertDetail(pp) {
    const content = pp.content || {};
    const header = pp.header || {};
    const teams = header.teams || [];
    const st = header.status || {};
    const halfs = st.halfs || {};
    const type = st.finished ? 'finished' : (st.started ? 'inprogress' : 'notstarted');

    // Canlı dakika
    let liveLabel = '', currentMinute = 0;
    if (type === 'inprogress') {
        const now = Date.now();
        const min = (from, base) => base + Math.max(0, Math.floor((now - from) / 60000));
        const e2 = parseGameStart(halfs.secondExtraHalfStarted);
        const e1 = parseGameStart(halfs.firstExtraHalfStarted);
        const sh = parseGameStart(halfs.secondHalfStarted);
        const fh = parseGameStart(halfs.firstHalfStarted);
        if (e2) { currentMinute = min(e2, 106); liveLabel = `${currentMinute}'`; }
        else if (e1) { currentMinute = min(e1, 91); liveLabel = `${currentMinute}'`; }
        else if (sh) { currentMinute = min(sh, 46); liveLabel = currentMinute > 90 ? "90+'" : `${currentMinute}'`; }
        else if (halfs.firstHalfEnded) { currentMinute = 45; liveLabel = 'İY'; }
        else if (fh) { currentMinute = min(fh, 1); liveLabel = currentMinute > 45 ? "45+'" : `${currentMinute}'`; }
        else { liveLabel = 'Canlı'; }
    }

    const event = {
        homeTeam: { name: teams[0]?.name || '', id: teams[0]?.id || 0 },
        awayTeam: { name: teams[1]?.name || '', id: teams[1]?.id || 0 },
        homeScore: { current: teams[0]?.score ?? 0 },
        awayScore: { current: teams[1]?.score ?? 0 },
        status: { type },
        time: { currentMinute },
        liveLabel
    };

    // Kadrolar
    const lu = content.lineup || {};
    const subInIds = new Set();
    for (const key of ['homeTeam', 'awayTeam']) {
        for (const p of [...(lu[key]?.starters || []), ...(lu[key]?.subs || [])]) {
            const evs = p.performance?.substitutionEvents || [];
            if (evs.some(x => x.type === 'subIn')) subInIds.add(fmInt(p.id));
        }
    }

    const convPlayer = (p, sub) => {
        const r = p.performance?.rating;
        const rating = typeof r === 'number' ? r : (parseFloat(r) || null);
        return {
            player: { id: fmInt(p.id), name: p.name || '' },
            shirtNumber: fmInt(p.shirtNumber) || 0,
            substitute: sub,
            statistics: { rating }
        };
    };

    const convTeam = (t) => {
        if (!t) return null;
        const starters = orderStarters(t.starters || [], t.formation);
        return {
            players: [...starters.map(p => convPlayer(p, false)), ...(t.subs || []).map(p => convPlayer(p, true))],
            formation: t.formation || null,
            coach: t.coach ? { id: fmInt(t.coach.id), name: t.coach.name || '' } : null
        };
    };

    const hasLineup = (lu.homeTeam?.starters || []).length > 0 || (lu.awayTeam?.starters || []).length > 0;
    const lineups = hasLineup ? { confirmed: true, home: convTeam(lu.homeTeam), away: convTeam(lu.awayTeam) } : null;

    // Olaylar
    const rawEvents = content.matchFacts?.events?.events || [];
    const incidents = [];
    for (const e of rawEvents) {
        const t = String(e.type || '');
        const time = e.time ?? null;
        const base = { id: e.eventId ?? null, time, isHome: e.isHome ?? null };
        const player = e.player?.id ? { id: fmInt(e.player.id), name: e.player.name || e.nameStr || '' } : null;

        if (t === 'Goal') {
            if (e.isPenaltyShootoutEvent) continue;
            let p = player;
            if (p && e.ownGoal) p = { ...p, name: p.name + ' (K.K.)' };
            incidents.push({ ...base, incidentType: 'goal', player: p, homeScore: e.newScore?.[0] ?? null, awayScore: e.newScore?.[1] ?? null });
        } else if (t === 'Card') {
            if (e.cardDescription?.localizedKey === 'coach') continue; // teknik direktör kartı
            const cls = String(e.card || '').toLowerCase().includes('red') ? 'red' : 'yellow';
            incidents.push({ ...base, incidentType: 'card', incidentClass: cls, player });
        } else if (t === 'Substitution') {
            const sw = e.swap || [];
            if (sw.length < 2) continue;
            // Giren/çıkan sırası kadrodaki subIn bilgisine göre belirlenir
            let pin = sw[0], pout = sw[1];
            if (subInIds.has(fmInt(sw[1].id)) && !subInIds.has(fmInt(sw[0].id))) { pin = sw[1]; pout = sw[0]; }
            incidents.push({
                ...base, incidentType: 'substitution',
                playerIn: { id: fmInt(pin.id), name: pin.name },
                playerOut: { id: fmInt(pout.id), name: pout.name }
            });
        } else if (t === 'Half') {
            const s = e.halfStrShort;
            if (s === 'HT') incidents.push({ id: null, time: 45, incidentType: 'period', text: 'HT' });
            else if (s === 'FT') incidents.push({ id: null, time: 90, incidentType: 'period', text: 'FT' });
        }
    }
    incidents.sort((a, b) => (b.time || 0) - (a.time || 0));

    return { updatedAt: Date.now(), event, incidents, lineups };
}

firebaseApp.database().ref('detail_requests').on('child_added', async (snap) => {
    const matchId = snap.key;
    const token = String(snap.val());
    try {
        const resRef = firebaseApp.database().ref(`match_details/${matchId}`);
        if (Date.now() - (detailLastFetch.get(matchId) || 0) < 10000) {
            await resRef.child('token').set(token); // 10 sn içinde zaten çekildi, tekrar çekme
        } else {
            detailLastFetch.set(matchId, Date.now());
            const out = convertDetail(await fetchMatchDetailsRaw(matchId));
            out.token = token;
            await resRef.set(JSON.parse(JSON.stringify(out)));
            console.log(`📤 [DETAY] ${matchId} yazıldı (${out.incidents.length} olay)`);
        }
    } catch (e) {
        console.log(`❌ [DETAY] ${matchId}: ${e.message}`);
    } finally {
        snap.ref.remove().catch(() => {});
    }
});

// 6 saatten eski detay kayıtlarını temizle
setInterval(async () => {
    try {
        const v = (await firebaseApp.database().ref('match_details').once('value')).val() || {};
        for (const [id, d] of Object.entries(v)) {
            if (!d || !d.updatedAt || Date.now() - d.updatedAt > 6 * 3600 * 1000) {
                await firebaseApp.database().ref(`match_details/${id}`).remove();
            }
        }
    } catch (e) {}
}, 30 * 60 * 1000);
// ===== /MAÇ DETAYI =====
main();
