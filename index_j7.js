const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// =========================================================================
// ⚙️ AYARLAR VE FIREBASE BAĞLANTISI
// =========================================================================
const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

const MINUTE_MS = 60000; // 1 Dakika
const FULL_UPDATE_INTERVAL_MS = 20 * 60000; // 20 Dakika

// YENİ FIREBASE ADRESİMİZ (Sıfır Gecikme)
const FIREBASE_BASE_URL = "https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app/";

// =========================================================================
// 🌉 YENİ: HARİCİ YAYINCI DOSYASI (SPOREKRANI - BULUTTAN OKUMA)
// =========================================================================
let externalBroadcasters = {};

// 🚀 DÜZELTME: Artık J7 yerel dosyaya bakmıyor, doğrudan GitHub'ın Raw linkinden taze veriyi çekiyor!
async function loadExternalBroadcasters() {
    try {
        const url = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/yayinci_bilgisi.json?_=${Date.now()}`;
        const response = await fetch(url);
        
        if (response.ok) {
            externalBroadcasters = await response.json();
        } else {
            console.log(`   ⚠️ [BULUT] Yayıncı dosyasına ulaşılamadı. (Durum: ${response.status})`);
            externalBroadcasters = {};
        }
    } catch (e) {
        console.log("   ⚠️ [BULUT] Ağ hatası: Yayıncı ayarlarımız kullanılacak.");
        externalBroadcasters = {};
    }
}

// Sporekrani dosyasında maç varsa oradan alır, yoksa senin 'fallback' değerini kullanır
function getBroadcasterWithFallback(sportCategory, dateStr, timeStr, homeName, awayName, fallback) {
    const hName = (homeName || "").toLowerCase();
    const aName = (awayName || "").toLowerCase();

    // Takım isimlerindeki 'fc', 'spor', 'united' gibi jenerik kelimeleri ve kısa harfleri yoksay
    const ignoreList = ['spor', 'club', 'team', 'united', 'city', 'real', 'fc', 'fk', 'sk', 'bk', 'de', 'la'];
    const getWords = (name) => name.replace(/[^\w\sğüşıöç]/gi, ' ').split(/\s+/).filter(w => w.length > 2 && !ignoreList.includes(w));
    
    const hWords = getWords(hName);
    const aWords = getWords(aName);

    // Tarihe takılma! Sporekranı dosyasındaki TÜM günleri ara (UTC kaymasını yok eder)
    for (const dateKey in externalBroadcasters) {
        const dayData = externalBroadcasters[dateKey];
        if (!dayData || !dayData.matches) continue;

        for (const m of dayData.matches) {
            if (m.spor && m.spor.toLowerCase() === sportCategory.toLowerCase()) {
                const mTitle = (m.mac || "").toLowerCase();

                // Takımın belirgin kelimelerinden HERHANGİ BİRİ geçiyorsa kabul et
                let hMatch = hWords.length > 0 ? hWords.some(w => mTitle.includes(w)) : mTitle.includes(hName);
                let aMatch = aWords.length > 0 ? aWords.some(w => mTitle.includes(w)) : mTitle.includes(aName);

                // Eğer iki takımın da belirgin bir kelimesi başlıkta varsa, saat ve tarihe bakmadan YAYINCIYI AL!
                if (hMatch && aMatch) {
                    console.log(`   📺 [SPOREKRANI] EŞLEŞTİ -> ${homeName} vs ${awayName} | Kanal: ${m.yayin}`);
                    return m.yayin; 
                }
            }
        }
    }

    return fallback; // Hiçbir günde bulunamadıysa senin eski koda dön!
}

// =========================================================================
// 🛠️ YARDIMCI FONKSİYONLAR VE BUKELEMUN HEADER (ANTİ-BAN)
// =========================================================================

// Firebase'e anında veri gönderen fonksiyon
async function uploadToFirebase(sportName, data) {
    try {
        const url = `${FIREBASE_BASE_URL}matches_${sportName}.json`;
        
        const response = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            console.log(`✅ [FIREBASE] ${sportName.toUpperCase()} başarıyla güncellendi!`);
        } else {
            console.error(`⚠️ [FIREBASE] Hata: ${response.statusText}`);
        }
    } catch (error) {
        console.error(`⚠️ [FIREBASE] Bağlantı Hatası:`, error.message);
    }
}

// Gerçek tarayıcı kimlikleri
const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
];

async function fetchData(url) {
    try {
        const randomAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
        
        const response = await fetch(url, {
            headers: { 
                "User-Agent": randomAgent,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
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
// ⚽ FUTBOL
// =========================================================================
const teamTranslations = {
    "turkey": "Türkiye", "germany": "Almanya", "france": "Fransa", "england": "İngiltere",
    "spain": "İspanya", "italy": "İtalya", "portugal": "Portekiz", "netherlands": "Hollanda",
    "belgium": "Belçika", "switzerland": "İsviçre", "austria": "Avusturya", "croatia": "Hırvatistan",
    "denmark": "Danimarka", "scotland": "İskoçya", "hungary": "Macaristan", "serbia": "Sırbistan",
    "poland": "Polonya", "czechia": "Çekya", "romania": "Romanya", "slovakia": "Slovakya",
    "slovenia": "Slovenya", "georgia": "Gürcistan", "albania": "Arnavutluk", "norway": "Norveç",
    "sweden": "İsveç", "ukraine": "Ukrayna", "greece": "Yunanistan", "wales": "Galler",
    "finland": "Finlandiya", "ireland": "İrlanda", "northernireland": "Kuzey İrlanda",
    "iceland": "İzlanda", "israel": "İsrail", "bulgaria": "Bulgaristan", "kazakhstan": "Kazakistan",
    "azerbaijan": "Azerbaycan", "armenia": "Ermenistan", "kosovo": "Kosova", "montenegro": "Karadağ",
    "estonia": "Estonya", "latvia": "Letonya", "lithuania": "Litvanya", "belarus": "Belarus",
    "moldova": "Moldova", "luxembourg": "Lüksemburg", "faroeislands": "Faroe Adaları",
    "malta": "Malta", "andorra": "Andorra", "sanmarino": "San Marino", "gibraltar": "Cebelitarık",
    "liechtenstein": "Liechtenstein", "northmacedonia": "K. Makedonya", "cyprus": "Güney Kıbrıs",
    "brazil": "Brezilya", "argentina": "Arjantin", "uruguay": "Uruguay", "colombia": "Kolombiya",
    "chile": "Şili", "peru": "Peru", "ecuador": "Ekvador", "paraguay": "Paraguay",
    "venezuela": "Venezuela", "bolivia": "Bolivya", "usa": "ABD", "mexico": "Meksika", 
    "canada": "Kanada", "japan": "Japonya", "southkorea": "Güney Kore", "australia": "Avustralya"
};

const translateTeam = (name) => {
    if (!name) return name;
    let translatedName = name;
    const cleanSearch = name.replace(/[^a-zA-Z]/g, '').toLowerCase();
    for (const [eng, tr] of Object.entries(teamTranslations)) {
        if (cleanSearch.includes(eng)) {
            translatedName = name.replace(new RegExp(eng, 'i'), tr);
            if (cleanSearch === eng) return tr;
            return translatedName;
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
        17: "S Sport Plus", 8: "beIN Sports", 23: "S Sport Plus", 7: "TRT 1 / Tabii", 351: "S Sport Plus", 
        37: "beIN Sports", 10: "Exxen / S Sport+", 13: "TRT 1 / Tabii", 393: "TRT 1 / Tabii", 155: "Spor Smart / Exxen", 
        10618: "Exxen / FIFA+", 4664: "S Sport+ / TV+", 98: "beIN Sports / TRT Spor", 97: "TFF YouTube", 
        13363: "USL YouTube", 
        11417: "TFF YouTube", 11416: "TFF YouTube", 11415: "TFF YouTube", 15938: "TFF YouTube", 
        696: "DAZN / YouTube", 
        10783: "A Spor", 96: "A Spor", 
        232: "S Sport Plus / DAZN", 1: "S Sport Plus", 19: "Exxen", 53: "beIN Sports"
    };

    if (staticConfigs[utId]) return staticConfigs[utId];
    if (utn.includes("j1 league")) return "YouTube (J.League Int.)";
    if (utn.includes("baller league")) return "Twitch / YouTube (Global)";
    if (utn.includes("primera a") || utn.includes("primera división")) return "TV Yayını Yok (Yerel)";
    if (utn.includes("mls next pro")) return "Apple TV / OneFootball";
    return "Resmi Yayıncı / Canlı Skor";
};

const ELITE_FOOT_IDS = [17, 8, 35, 23, 34, 52, 37, 238, 38, 36, 19, 97, 98, 7, 679, 17015, 16, 1, 133, 270, 53, 13363, 10783, 96];
const REGULAR_FOOT_IDS = [299, 6516, 325, 155, 242, 11415, 11416, 11417, 15938];
const ALL_FOOT_TARGETS = [...ELITE_FOOT_IDS, ...REGULAR_FOOT_IDS];

const footballLeagues = {
    17: "İngiltere Premier Lig", 8: "İspanya La Liga", 35: "Almanya Bundesliga",
    23: "İtalya Serie A", 34: "Fransa Ligue 1", 52: "Türkiye Süper Lig", 
    98: "Trendyol 1. Lig", 97: "TFF 2. Lig", 53: "İtalya Serie B",
    37: "Hollanda Eredivisie", 238: "Portekiz Primeira Liga", 38: "Belçika Pro League", 
    36: "İskoçya Premiership", 19: "FA Cup", 
    938: "Türkiye Kupası", 10783: "Türkiye Kupası", 96: "Türkiye Kupası", 
    11417: "TFF 3. Lig 1. Grup", 11416: "TFF 3. Lig 2. Grup",
    11415: "TFF 3. Lig 3. Grup", 15938: "TFF 3. Lig 4. Grup",
    7: "UEFA Şampiyonlar Ligi", 679: "UEFA Avrupa Ligi", 17015: "UEFA Konferans Ligi", 
    16: "FIFA Dünya Kupası", 1: "UEFA EURO", 133: "Copa America", 
    270: "Afrika Uluslar Kupası", 299: "Uluslararası Hazırlık Maçları", 
    6516: "Kulüp Hazırlık Maçları", 325: "Brezilya Serie A", 
    155: "Arjantin Liga Profesional", 242: "MLS", 13363: "USL Championship"
};

function calculateLiveMinute(eventData) {
    if (!eventData) return "";
    const status = eventData.status;
    const time = eventData.time;

    if (time?.currentMinute !== undefined && time.currentMinute !== null) {
        return String(time.currentMinute) + "'";
    }
    if (status?.code === 31 || status?.description === "Halftime") {
        return "İY";
    }
    if (time?.currentPeriodStartTimestamp) {
        const now = Math.floor(Date.now() / 1000);
        const elapsed = now - time.currentPeriodStartTimestamp;
        let calcMinute = Math.floor(elapsed / 60);
        if (calcMinute < 0) calcMinute = 0;
        if (status?.code === 7) { 
            calcMinute += 45;
            return calcMinute > 90 ? "90+" : String(calcMinute) + "'";
        } else if (status?.code === 6) { 
            return calcMinute > 45 ? "45+" : String(calcMinute) + "'";
        }
        return String(calcMinute) + "'";
    }
    return "Canlı";
}

async function updateFootball() {
    console.log(`⚽ Futbol güncelleniyor (Play-off ve Tarih Fix)...`);
    let allEvents = [];
    
    for (const date of [getTRDate(0), getTRDate(1), getTRDate(2)]) {
        const data = await fetchData(`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${date}?_=${Date.now()}`);
        if (data?.events) {
            allEvents.push(...data.events.filter(e => {
                const utId = e.tournament?.uniqueTournament?.id;
                const utName = (e.tournament?.uniqueTournament?.name || "").toLowerCase();
                const tourName = (e.tournament?.name || "").toLowerCase();
                
                const isTargetLeague = ALL_FOOT_TARGETS.includes(utId) || 
                                     utName.includes("3. lig") || 
                                     tourName.includes("3. lig") ||
                                     (utName.includes("play-off") && (e.homeTeam.name.toLowerCase().includes("spor") || e.awayTeam.name.toLowerCase().includes("spor")));

                return isTargetLeague;
            }));
        }
    }

    const duplicateTracker = new Map();
    const leagueCount = {};

    allEvents.forEach(e => {
        if (duplicateTracker.has(e.id)) return;

        const status = e.status.type;
        const isLive = status === 'inprogress';
        const leagueId = e.tournament?.uniqueTournament?.id;
        
        leagueCount[leagueId] = (leagueCount[leagueId] || 0) + 1;
        
        const hName = e.homeTeam.name || "";
        const aName = e.awayTeam.name || "";
        const utName = e.tournament?.uniqueTournament?.name || "";
        
        const cleanTournamentName = footballLeagues[leagueId] || e.tournament?.name || utName;

        const dateTR = new Date(e.startTimestamp * 1000);
        const dayTR = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        const timeString = dateTR.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

        const fallbackBroadcaster = getFootBroadcaster(leagueId, hName, aName, "", utName);
        const finalBroadcaster = getBroadcasterWithFallback("futbol", dayTR, timeString, hName, aName, fallbackBroadcaster);

        const isEliteMatch = ELITE_FOOT_IDS.includes(leagueId) || utName.includes("3. lig") || utName.includes("play");

        duplicateTracker.set(e.id, {
            id: e.id,
            isElite: isEliteMatch, 
            status: status,
            liveMinute: isLive ? calculateLiveMinute(e) : "",
            fixedDate: dayTR,
            fixedTime: timeString,
            timestamp: e.startTimestamp * 1000,
            broadcaster: finalBroadcaster,
            homeTeam: { name: translateTeam(hName), logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.homeTeam.id}.png` },
            awayTeam: { name: translateTeam(aName), logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.awayTeam.id}.png` },
            tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/${leagueId}.png`,
            homeScore: (isLive || status === 'finished') ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: (isLive || status === 'finished') ? String(e.awayScore?.display ?? "0") : "-",
            tournament: cleanTournamentName
        });
    });

    const matches = Array.from(duplicateTracker.values()).sort((a, b) => a.timestamp - b.timestamp);

    await uploadToFirebase("football", { success: true, lastUpdate: new Date().toLocaleTimeString('tr-TR'), matches });
    
    const hasLiveMatch = matches.some(m => m.status === 'inprogress');
    const upcomingMatches = matches.filter(m => m.status === 'notstarted' || m.status === 'delayed');
    const nextMatchTimestamp = upcomingMatches.length > 0 ? upcomingMatches[0].timestamp : null;

    console.log(`  ✅ Toplam ${matches.length} futbol maçı Firebase'e gönderildi.`);
    return { hasLiveMatch, nextMatchTimestamp };
}

// =========================================================================
// 🏀 BASKETBOL
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

async function updateBasketball() {
    console.log(`🏀 Basketbol güncelleniyor...`);
    let allEvents = [];
    
    for (const date of [getTRDate(-1), getTRDate(0), getTRDate(1)]) {
        const data = await fetchData(`https://www.sofascore.com/api/v1/sport/basketball/scheduled-events/${date}`);
        if (data?.events) {
            allEvents.push(...data.events.filter(e => targetBaskIds.includes(e.tournament?.uniqueTournament?.id)));
        }
    }

    const finalMatches = [];
    const duplicateTracker = new Set();
    const trToday = getTRDate(0);
    const trTomorrow = getTRDate(1);

    for (const e of allEvents) {
        const utId = e.tournament?.uniqueTournament?.id;
        const utName = e.tournament?.uniqueTournament?.name || "";
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        
        if (dayStr !== trToday && dayStr !== trTomorrow) continue;

        const isNBA = (utId === 3547 || utName.toUpperCase() === "NBA");
        const matchKey = `${dayStr}_${e.homeTeam.name}_${e.awayTeam.name}_${utId}`;
        if (duplicateTracker.has(matchKey)) continue;

        const statusType = e.status?.type; 
        const isFinished = statusType === 'finished';
        const isInProgress = statusType === 'inprogress';

        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        if (isInProgress) timeString = `${timeString}\nCANLI`; 
        const hasScore = isFinished || isInProgress;

        const cleanTournamentName = basketballLeagues[utId] || (isNBA ? "NBA" : utName);

        const fallbackBroadcaster = leagueConfigs[utId] || "Resmi Yayıncı";
        const finalBroadcaster = getBroadcasterWithFallback("basketbol", dayStr, timeString, e.homeTeam.name, e.awayTeam.name, fallbackBroadcaster);

        finalMatches.push({
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
        duplicateTracker.add(matchKey);
    }

    finalMatches.sort((a, b) => a.timestamp - b.timestamp);
    await uploadToFirebase("basketball", { success: true, matches: finalMatches });
    console.log(`  ✅ Toplam ${finalMatches.length} basketbol maçı`);
}

// =========================================================================
// 🎾 TENİS
// =========================================================================
const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/`;
const TENNIS_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/tournament_logos/`;

const isGarbage = (tourName, catName) => {
    const t = (tourName || "").toUpperCase();
    const c = (catName || "").toUpperCase();
    return t.includes("ITF") || t.includes("CHALLENGER") || t.includes("UTR") ||
           c.includes("ITF") || c.includes("CHALLENGER") || c.includes("UTR");
};

const ELITE_KEYWORDS = ["WIMBLEDON", "US OPEN", "AUSTRALIAN OPEN", "ROLAND GARROS", "FRENCH OPEN", "OLYMPIC", "ATP FINALS", "WTA FINALS", "MONTE CARLO", "INDIAN WELLS", "MIAMI", "MADRID", "ROME", "CINCINNATI", "MONTREAL", "TORONTO", "SHANGHAI", "PARIS", "MASTERS", "ATP 1000", "WTA 1000", "ATP 500", "WTA 500"];

const checkIsEliteMatch = (tournamentName) => {
    if (!tournamentName) return false;
    const nameUpper = tournamentName.toUpperCase();
    if (nameUpper.includes("QUALIFYING") || nameUpper.includes("QUALIFIERS")) return false;
    return ELITE_KEYWORDS.some(keyword => nameUpper.includes(keyword));
};

async function updateTennis() {
    console.log(`🎾 Tenis güncelleniyor...`);
    let rawEvents = [];
    const targetDates = [getTRDate(0), getTRDate(1)];
    const seenEventIds = new Set();

    for (const date of targetDates) {
        try {
            const data = await fetchData(`https://www.sofascore.com/api/v1/sport/tennis/scheduled-events/${date}`);
            if (data?.events) {
                const filtered = data.events.filter(e => {
                    const tourName = e.tournament?.name;
                    const catName = e.tournament?.category?.name;
                    if (isGarbage(tourName, catName)) return false;
                    if (seenEventIds.has(e.id)) return false; 
                    seenEventIds.add(e.id);
                    return true;
                });
                rawEvents.push(...filtered);
            }
        } catch (error) { continue; }
    }

    const finalMatches = [];
    const detailPromises = rawEvents.map(e => 
        fetchData(`https://www.sofascore.com/api/v1/event/${e.id}`)
            .then(data => ({ eventId: e.id, data }))
            .catch(() => ({ eventId: e.id, data: null }))
    );

    const detailsResults = await Promise.all(detailPromises);
    const detailsMap = {};
    detailsResults.forEach(r => detailsMap[r.eventId] = r.data);

    for (const e of rawEvents) {
        try {
            const startTimestamp = e.startTimestamp * 1000;
            const dateTR = new Date(startTimestamp);
            const fixedDate = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
            if (!targetDates.includes(fixedDate)) continue;

            const tourName = e.tournament?.name || "";
            let homeLogos = []; let awayLogos = [];
            let hRank = null; let aRank = null;
            const detailData = detailsMap[e.id];
            
            if (detailData?.event) {
                const ev = detailData.event;
                if (ev.homeTeam?.ranking !== undefined && ev.homeTeam.ranking !== null) hRank = ev.homeTeam.ranking;
                if (ev.awayTeam?.ranking !== undefined && ev.awayTeam.ranking !== null) aRank = ev.awayTeam.ranking;

                const getCodes = (team) => {
                    if (team.subTeams && team.subTeams.length > 0) return team.subTeams.map(p => p.country?.alpha2?.toLowerCase()).filter(Boolean);
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
                    if (hScore !== undefined && aScore !== undefined) sets.push(`${hScore}-${aScore}`);
                }
            }

            const fallbackBroadcaster = "S Sport / beIN Sports";
            const finalBroadcaster = getBroadcasterWithFallback("tenis", fixedDate, timeString, e.homeTeam.name, e.awayTeam.name, fallbackBroadcaster);

            finalMatches.push({
                id: e.id,
                isElite: checkIsEliteMatch(tourName),
                status: statusType,
                fixedDate: fixedDate,
                fixedTime: timeString,
                timestamp: startTimestamp,
                
                broadcaster: finalBroadcaster,
                
                homeTeam: { name: e.homeTeam.name || "Belli Değil", ranking: hRank, logos: homeLogos },
                awayTeam: { name: e.awayTeam.name || "Belli Değil", ranking: aRank, logos: awayLogos },
                tournamentLogo: TENNIS_TOURNAMENT_BASE + (e.tournament?.uniqueTournament?.id || e.tournament?.category?.id) + ".png",
                homeScore: !hasScore ? "-" : String(e.homeScore?.display ?? "0"),
                awayScore: !hasScore ? "-" : String(e.awayScore?.display ?? "0"),
                setScores: sets,
                tournament: tourName
            });
        } catch (error) { continue; }
    }

    finalMatches.sort((a, b) => a.timestamp - b.timestamp);
    await uploadToFirebase("tennis", { success: true, matches: finalMatches });
    console.log(`  ✅ Toplam ${finalMatches.length} tenis maçı kaydedildi`);
}

// =========================================================================
// 🏎️ FORMULA 1
// =========================================================================
const F1_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/tournament_logos/`;
const F1_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/logos/`;

async function updateF1() {
    console.log(`🏎️ Formula 1 güncelleniyor...`);
    try {
        const response = await fetchData('https://api.jolpi.ca/ergast/f1/current.json');
        if (!response) return;

        const races = response.MRData?.RaceTable?.Races || [];
        const finalEvents = [];
        
        const countryToCode = { "Bahrain": "bh", "Saudi Arabia": "sa", "Australia": "au", "Japan": "jp", "China": "cn", "USA": "us", "United States": "us", "Italy": "it", "Monaco": "mc", "Canada": "ca", "Spain": "es", "Austria": "at", "UK": "gb", "Hungary": "hu", "Belgium": "be", "Netherlands": "nl", "Azerbaijan": "az", "Singapore": "sg", "Mexico": "mx", "Brazil": "br", "Qatar": "qa", "UAE": "ae" };

        races.forEach(race => {
            const circuitId = race.Circuit.circuitId;
            const countryName = race.Circuit.Location.country;
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
        console.log(`  ✅ Toplam ${finalEvents.length} F1 seanı`);
        
    } catch (error) { console.error(`   ⚠️ F1 hatası: ${error.message}`); }
}

// =========================================================================
// 🔄 ANA DÖNGÜ (OPTİMİZE EDİLMİŞ + BULUTTAN OKUMA)
// =========================================================================
async function main() {
    console.log("============================================================");
    console.log("🟢 J7 CANLI SUNUCU BAŞLADI (FIREBASE + AKILLI ZAMANLAYICI)");
    console.log("============================================================");
    
    let iteration = 1;
    let footballStatus = { hasLiveMatch: false, nextMatchTimestamp: null };
    let timeSinceLastFullUpdate = FULL_UPDATE_INTERVAL_MS; 

    while (true) {
        try {
            console.log(`\n[İterasyon ${iteration}] ${new Date().toLocaleTimeString('tr-TR')}`);
            
            // 🌉 HARİCİ DOSYAYI HER DÖNGÜDE BULUTTAN TAZE OKU
            await loadExternalBroadcasters();

            const now = Date.now();
            const isMatchTime = footballStatus.nextMatchTimestamp && (now >= (footballStatus.nextMatchTimestamp - 60000));
            
            if (timeSinceLastFullUpdate >= FULL_UPDATE_INTERVAL_MS) {
                console.log("🔄 20 Dakikalık Tam Güncelleme Döngüsü Çalışıyor...");
                footballStatus = await updateFootball(); 
                await updateBasketball();
                await updateTennis();
                await updateF1();
                timeSinceLastFullUpdate = 0; 
            } else if (footballStatus.hasLiveMatch || isMatchTime) { 
                if (isMatchTime && !footballStatus.hasLiveMatch) {
                    console.log("⏰ Yeni maç saati geldi! Sadece futbol 1 dakikalık döngüde güncelleniyor...");
                } else {
                    console.log("⚽ Canlı maç var! Sadece futbol 1 dakikalık döngüde güncelleniyor...");
                }
                footballStatus = await updateFootball(); 
            } else {
                const minutesLeft = Math.round((FULL_UPDATE_INTERVAL_MS - timeSinceLastFullUpdate) / 60000);
                if (footballStatus.nextMatchTimestamp && (footballStatus.nextMatchTimestamp - now) < (FULL_UPDATE_INTERVAL_MS - timeSinceLastFullUpdate)) {
                    const matchMins = Math.round((footballStatus.nextMatchTimestamp - now) / 60000);
                    console.log(`💤 Canlı maç yok. Tam güncellemeye ${minutesLeft} dk, ilk maça ${matchMins} dk kaldı.`);
                } else {
                    console.log(`💤 Canlı maç yok. Tam güncellemeye yaklaşık ${minutesLeft} dakika kaldı.`);
                }
            }

        } catch (e) { 
            console.error("🚨 Hata:", e.message); 
        }
        
        console.log(`⏳ ${MINUTE_MS / 1000} saniye bekleniyor...\n`);
        await new Promise(r => setTimeout(r, MINUTE_MS));
        timeSinceLastFullUpdate += MINUTE_MS;
        iteration++;
    }
}

main();
