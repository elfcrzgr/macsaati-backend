const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const admin = require('firebase-admin');


// 1. HAFIZA İÇİN MAP
const previousMatchStates = new Map();

// Gol iptali şüphelerini geçici tutar
const pendingGoalCancel = new Map();

// 2. ADIMDA EKLEDİĞİMİZ YARDIMCI FONKSİYONLAR (Buraya yapıştır)
const STATE_FILE = 'match_states.json';

function logMatchesBySport(matchGroups) {
    for (const sportType of Object.keys(matchGroups)) {
        let icon = "🏟️";
        if (sportType === "futbol" || sportType === "football") icon = "⚽";
        if (sportType === "basketbol" || sportType === "basketball") icon = "🏀";
        if (sportType === "tenis" || sportType === "tennis") icon = "🎾";
        console.log(`\n--------- ${icon} ${sportType.toUpperCase()} ---------`);
        for (const matchInfo of matchGroups[sportType]) {
            const {home, away, kanal, source} = matchInfo;
            const sourceTag = source === "sporekrani" ? "[SPOREKRANI]" : "[FALLBACK]";
            console.log(`${icon} ${home} vs ${away} | Kanal: ${kanal} ${sourceTag}`);
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
const MINUTE_MS = 60000; // 1 Dakika
const FULL_UPDATE_INTERVAL_MS = 20 * 60000; // 20 Dakika
const FIREBASE_BASE_URL = "https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app/";

// =========================================================================
// 🔔 FIREBASE ADMIN BAŞLATMA (BİLDİRİM İÇİN)
// =========================================================================
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(require('./serviceAccountKey.json')),
        databaseURL: FIREBASE_BASE_URL
    });
}

// Önceki maç durumlarını RAM'de tut


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
    if (!externalBroadcasters[dateStr]) return { kanal: fallback, source: "fallback" };
    const dayData = externalBroadcasters[dateStr];
    if (!dayData || !dayData.matches) return { kanal: fallback, source: "fallback" };

    const cleanTime = (timeStr || "").replace(/\n?CANLI/, "").replace(/\n?MS/, "").replace('.', ':').trim();
    const hName = (homeName || "").toLowerCase().trim();
    const aName = (awayName || "").toLowerCase().trim();

    for (const m of dayData.matches) {
        if (m.spor && m.spor.toLowerCase() === sportCategory.toLowerCase()) {
            const mTime = (m.saat || "").replace('.', ':').trim();
            const mTitle = (m.mac || "").toLowerCase();

            const hCheck = hName.length > 4 ? hName.substring(0, 4) : hName;
            const aCheck = aName.length > 4 ? aName.substring(0, 4) : aName;

            const anyHomeWordMatch = hName.split(' ').some(word => word.length > 3 && mTitle.includes(word));
            const anyAwayWordMatch = aName.split(' ').some(word => word.length > 3 && mTitle.includes(word));

            const isNameMatch = mTitle.includes(hCheck) || mTitle.includes(aCheck) || anyHomeWordMatch || anyAwayWordMatch;
            const isTimeMatch = (mTime === cleanTime);
            const isTennis = (sportCategory.toLowerCase() === "tenis");

            if ((isTimeMatch || isTennis) && isNameMatch) {
                // LOGDA "sporekrani" olarak döndür
                return { kanal: m.yayin, source: "sporekrani" };
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
    96: "TRT 1 / Tabii",
    17: "S Sport Plus", 8: "beIN Sports", 23: "S Sport Plus", 7: "TRT 1 / Tabii", 351: "S Sport Plus",
    37: "beIN Sports", 10: "Exxen / S Sport+", 13: "TRT 1 / Tabii", 393: "TRT 1 / Tabii", 155: "Spor Smart / Exxen",
    10618: "Exxen / FIFA+", 4664: "S Sport+ / TV+", 98: "beIN Sports / TRT Spor", 97: "TFF YouTube",
    11417: "TFF YouTube", 11416: "TFF YouTube", 11415: "TFF YouTube", 15938: "TFF YouTube",
    13363: "USL YouTube", 696: "DAZN / YouTube", 10783: "A Spor", 232: "S Sport Plus / DAZN",
    1: "S Sport Plus", 19: "Exxen", 53: "S Sport Plus", 38: "beIN Sports", 36: "beIN Sports",
    335: "beIN Sports",
    955: "S Sport Plus / TV+",
    18: "beIN Sports",
    155: "Spor Smart / S Sport+",
    325: "Spor Smart / S Sport+"
};
if (staticConfigs[utId]) return staticConfigs[utId];
if (utn.includes("j1 league")) return "YouTube (J.League Int.)";
if (utn.includes("baller league")) return "Twitch / YouTube (Global)";
if (utn.includes("primera a") || utn.includes("primera división")) return "TV Yayını Yok (Yerel)";
if (utn.includes("mls next pro")) return "Apple TV / OneFootball";
return "Resmi Yayıncı / Canlı Skor";
};
const ELITE_FOOT_IDS = [17, 8, 35, 23, 34, 52, 37, 38, 238, 36, 19, 96, 97, 98, 7, 679, 17015, 16, 1, 133, 270, 53, 335, 13363];
const REGULAR_FOOT_IDS = [299, 155, 325, 955, 18, 6516, 325, 155, 242, 11415, 11416, 11417, 15938];
const ALL_FOOT_TARGETS = [...ELITE_FOOT_IDS, ...REGULAR_FOOT_IDS];
const TFF2_GROUP_IDS = {
97: "TFF 2. Lig",
1993: "TFF 2. Lig (Beyaz Grup)",
1994: "TFF 2. Lig (Kırmızı Grup)"
};
const footballLeagues = {
17: "İngiltere Premier Lig", 8: "İspanya La Liga", 35: "Almanya Bundesliga",
23: "İtalya Serie A", 34: "Fransa Ligue 1", 52: "Türkiye Süper Lig",
98: "Trendyol 1. Lig", 97: "TFF 2. Lig",
11417: "TFF 3. Lig Grup 1", 11416: "TFF 3. Lig Grup 2", 11415: "TFF 3. Lig Grup 3", 15938: "TFF 3. Lig Grup 4",
53: "İtalya Serie B",
37: "Hollanda Eredivisie", 238: "Portekiz Primeira Liga", 38: "Belçika Pro League",
36: "İskoçya Premiership", 19: "FA Cup", 938: "Türkiye Kupası", 96: "Türkiye Kupası",
7: "UEFA Şampiyonlar Ligi", 679: "UEFA Avrupa Ligi", 17015: "UEFA Konferans Ligi",
16: "FIFA Dünya Kupası", 1: "UEFA EURO", 133: "Copa America",
270: "Afrika Uluslar Kupası", 299: "Uluslararası Hazırlık Maçları",
6516: "Kulüp Hazırlık Maçları", 325: "Brezilya Serie A",
155: "Arjantin Liga Profesional", 242: "MLS", 13363: "USL Championship",
335: "Fransa Kupası",
    155: "Arjantin Liga Profesional",
    325: "Brezilya Serie A",
    955: "Suudi Arabistan Pro Lig",
    18: "İngiltere Championship"
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

// =========================================================================
// 🔔 BİLDİRİM KONTROLÜ VE GÖNDERME
// =========================================================================
// Global Map'i bu şekilde kullanmaya devam et
// previousMatchStates.get(matchIdStr) -> { status, homeScore, awayScore, hasNotifiedStart }

async function checkAndSendNotifications(newMatches) {
    for (const match of newMatches) {
        const matchIdStr = String(match.id);
        
        const prev = previousMatchStates.get(matchIdStr) || { 
            status: null, homeScore: 0, awayScore: 0, 
            hasNotifiedStart: false, hasNotifiedHT: false, hasNotifiedSH: false, hasNotifiedFinished: false,
            hasNotifiedInjuryTime1: false, hasNotifiedInjuryTime2: false,
            lastMinute: 0 // 🚀 YENİ KORUMA: Dakika geriye sararsa sahte veri olduğunu anlayacağız
        };
        
        let currH = Number(match.homeScore) || 0;
        let currA = Number(match.awayScore) || 0;
        const liveMin = match.liveMinute || ""; 
        const tObj = match.timeObj || {}; 
        let currentMinNum = tObj.currentMinute || 0;
        
        const appTitle = "Maç Saati"; 
        const whistleIconUrl = "https://img.icons8.com/color/96/whistle.png";
        const substitutionBoardUrl = "https://img.icons8.com/color/96/stopwatch--v1.png"; 

        // 🚀 DAHİCE ÇÖZÜM: ZAMAN KALKANI (MINUTE SHIELD)
        // Eğer maçın dakikası, hafızamızdaki dakikadan daha geriyse bu kesinlikle Sofascore'un eski bozuk verisidir!
        if (match.status === 'inprogress' && currentMinNum > 0 && prev.lastMinute > 0 && currentMinNum < prev.lastMinute) {
            console.log(`🛡️ CDN HATASI ENGELLENDİ: ${match.homeTeam.name} dakikası geriye gitti (${prev.lastMinute}' -> ${currentMinNum}'). Eski veri reddedildi.`);
            currH = prev.homeScore;
            currA = prev.awayScore;
            match.homeScore = String(currH); // Veritabanına da bozuk veri gitmesin diye koruyoruz
            match.awayScore = String(currA);
            // Dakika geriye gittiği için aşağıdakilerin hiçbiri tetiklenmeyecek!
        }

        // 1. Maç Başladı
        if (match.status === 'inprogress' && !prev.hasNotifiedStart) {
            const bodyText = `⚽ Maç Başladı!\n${match.homeTeam.name} - ${match.awayTeam.name}`;
            await sendPush(matchIdStr, appTitle, bodyText);
            prev.hasNotifiedStart = true;
        } 
        
        // 2. İlk Yarı İlave Süre (Uzatma)
        else if (match.status === 'inprogress' && match.statusCode === 6 && tObj.injuryTime1 && !prev.hasNotifiedInjuryTime1) {
            const titleText = `İlk yarı ilave süre: +${tObj.injuryTime1}'`;
            const bodyText = `${match.homeTeam.name} - ${match.awayTeam.name}`;
            await sendPush(matchIdStr, titleText, bodyText, substitutionBoardUrl);
            prev.hasNotifiedInjuryTime1 = true;
        }

        // 3. İlk Yarı Bitti
        else if (match.status === 'inprogress' && liveMin === "İY" && !prev.hasNotifiedHT) {
            const bodyText = `⏱️ İlk Yarı Sonucu\n${match.homeTeam.name} ${currH} - ${currA} ${match.awayTeam.name}`;
            await sendPush(matchIdStr, appTitle, bodyText, whistleIconUrl);
            prev.hasNotifiedHT = true;
        }

        // 4. İkinci Yarı Başladı
        else if (match.status === 'inprogress' && prev.hasNotifiedHT && liveMin !== "İY" && !prev.hasNotifiedSH) {
            const bodyText = `▶️ İkinci Yarı Başladı\n${match.homeTeam.name} ${currH} - ${currA} ${match.awayTeam.name}`;
            // DÜZELTME: "Maç Saati" yazması için başlık kısmına appTitle verildi.
            await sendPush(matchIdStr, appTitle, bodyText, whistleIconUrl);
            prev.hasNotifiedSH = true;
        }

        // 5. İkinci Yarı İlave Süre (Uzatma)
        else if (match.status === 'inprogress' && match.statusCode === 7 && tObj.injuryTime2 && !prev.hasNotifiedInjuryTime2 && liveMin !== "İY") {
            const titleText = `İkinci yarı ilave süre: +${tObj.injuryTime2}'`;
            const bodyText = `${match.homeTeam.name} - ${match.awayTeam.name}`;
            await sendPush(matchIdStr, titleText, bodyText, substitutionBoardUrl);
            prev.hasNotifiedInjuryTime2 = true;
        }

        // 6. GOL DURUMU VE GOL İPTALİ (Korumalı)
else if (match.status === 'inprogress' && (prev.homeScore !== currH || prev.awayScore !== currA)) {
    const isGoal = (currH + currA) > (prev.homeScore + prev.awayScore);

    if (isGoal) {
        // 🚀 GOL ATAN OYUNCUYU ÇEKME (Aynen eski kodun)
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
        const bodyText = `⚽ Gol - ${scorerName} (${liveMin})\n${match.homeTeam.name} ${currH} - ${currA} ${match.awayTeam.name}`;
        await sendPush(matchIdStr, appTitle, bodyText, scoringTeamLogo);

        // Gol geldi, tüm pending iptali temizle!
        pendingGoalCancel.delete(matchIdStr);

    } else {
        // PENDING GOL İPTALİ MANTIĞI BAŞLIYOR

        const pending = pendingGoalCancel.get(matchIdStr);

        if (!pending) {
            // İlk defa skor düştü; şimdilik sadece pending'e yaz
            pendingGoalCancel.set(matchIdStr, { homeScore: currH, awayScore: currA });
            // Şimdi bildirim gönderme!
        } else {
            // İkinci defa yine skor düşükse kesinleşmiş iptal say!
            if (pending.homeScore === currH && pending.awayScore === currA) {
                // PENDING'i sil, bildirimi gönder!
                pendingGoalCancel.delete(matchIdStr);

                const homeCancelled = currH < prev.homeScore;
                const awayCancelled = currA < prev.awayScore;
                const cancelledTeamName = homeCancelled ? match.homeTeam.name : (awayCancelled ? match.awayTeam.name : "İptal");

                const bodyText = `🚫 GOL İPTALİ! (${cancelledTeamName})\n${match.homeTeam.name} ${currH} - ${currA} ${match.awayTeam.name}`;
                await sendPush(matchIdStr, appTitle, bodyText, whistleIconUrl);
            } else {
                // Skor tekrar değişmiş/gol olmuş vs: pending'i sıfırla
                pendingGoalCancel.delete(matchIdStr);
            }
        }
    }
}
        
        // 7. MAÇ BİTTİ (Spam Korumalı)
        else if (['finished', 'ended', 'closed'].includes(match.status) && !prev.hasNotifiedFinished) {
            if (prev.status === 'inprogress') {
                const bodyText = `🏁 Maç Bitti\n${match.homeTeam.name} ${currH} - ${currA} ${match.awayTeam.name}`;
                await sendPush(matchIdStr, appTitle, bodyText);
            }
            prev.hasNotifiedFinished = true; 
        }

        // 🚀 8. HAFIZAYI GÜNCELLE VE TARİHİ EKLE
        previousMatchStates.set(matchIdStr, {
            status: match.status, homeScore: currH, awayScore: currA,
            hasNotifiedStart: prev.hasNotifiedStart, 
            hasNotifiedHT: prev.hasNotifiedHT, 
            hasNotifiedSH: prev.hasNotifiedSH, 
            hasNotifiedFinished: prev.hasNotifiedFinished,
            hasNotifiedInjuryTime1: prev.hasNotifiedInjuryTime1, 
            hasNotifiedInjuryTime2: prev.hasNotifiedInjuryTime2,
            lastMinute: Math.max(currentMinNum, prev.lastMinute || 0), // 🚀 En yüksek dakikayı korur
            date: match.fixedDate || getTRDate(0) 
        });
    }
    
    saveState();
}





const lastNotificationTime = new Map();
// 🚀 BİLDİRİM GÖNDERME FONKSİYONU (Resim Desteği Düzeltildi)
async function sendPush(id, title, body, imageUrl = null) {
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
                type: "match_update" 
            },
            // 🚀 İŞTE DÜZELTİLEN KISIM: Apple (iOS) İçin
            apns: {
                payload: {
                    aps: {
                        "mutable-content": 1, // iOS'e resim ekleme yetkisi
                        "badge":0
                    }
                }
            }
        };

        // 🚀 İŞTE DÜZELTİLEN KISIM: Resmi iOS ve Android'in beklediği doğru yerlere koyuyoruz
        if (imageUrl) {
            // iOS'in beklediği yer (fcm_options.image)
            payload.apns.fcm_options = { image: imageUrl };
            
            // Eğer Android tarafı da resimli bildirim destekliyorsa, orası için de ekleyelim:
            payload.android = {
                notification: { image: imageUrl }
            };
        }

        await admin.messaging().send(payload);
        lastNotificationTime.set(id, now);
        console.log(`✅ [BİLDİRİM] ${title}: ${body}`);
    } catch (e) { 
        console.error("❌ Bildirim Hatası:", e.message); 
    }
}

async function updateFootball() {
    console.log(`⚽ Futbol güncelleniyor...`);
    const today = getTRDate(0);
    for (const [id, state] of previousMatchStates.entries()) {
        if (state.date && state.date !== today) {
            if (state.status !== 'inprogress') {
                previousMatchStates.delete(id);
                console.log(`🧹 [HAFIZA] Eski maç silindi: ${id}`);
            } else {
                state.date = today;
                previousMatchStates.set(id, state);
                console.log(`🛡️ [HAFIZA] Canlı maç tarihi bugüne güncellendi: ${id}`);
            }
        }
    }
    saveState();

    let allEvents = [];
    const targetDates = [getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)];
    for (const date of targetDates) {
        const data = await fetchData(`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${date}?_=${Date.now()}`);
        if (data?.events) {
            allEvents.push(...data.events.filter(e => ALL_FOOT_TARGETS.includes(e.tournament?.uniqueTournament?.id)));
        }
    }
    const tff2Matches = allEvents.filter(e => e.tournament?.uniqueTournament?.id === 97);
    for (const match of tff2Matches) {
        const detailData = await fetchData(`https://www.sofascore.com/api/v1/event/${match.id}`);
        if (detailData?.event?.tournament?.id) {
            match.tournament.id = detailData.event.tournament.id;
            console.log(`🟢 TFF 2. Lig: ${match.homeTeam.name} vs ${match.awayTeam.name} | Grup ID: ${match.tournament.id}`);
        }
    }
    const duplicateTracker = new Map();
    const leagueCount = {};
    // ------------------ LOG için toplama yap -------------------
    let futbolMatchesLog = [];
    // -----------------------------------------------------------
    allEvents.forEach(e => {
        const statusType = e.status?.type || "";
        const statusDesc = e.status?.description || "";

        if (statusType === 'canceled' || statusType === 'postponed' || statusDesc.toLowerCase() === 'canceled' || statusDesc.toLowerCase() === 'postponed') {
            return;
        }
        const status = e.status.type;
        const isLive = status === 'inprogress';
        const leagueId = e.tournament?.uniqueTournament?.id;
        leagueCount[leagueId] = (leagueCount[leagueId] || 0) + 1;
        const hName = e.homeTeam.name || "";
        const aName = e.awayTeam.name || "";
        const tName = e.tournament?.name || "";
        const utName = e.tournament?.uniqueTournament?.name || "";
        let cleanTournamentName = footballLeagues[leagueId] || e.tournament?.name || utName;
        if (leagueId === 97) {
            const tId = e.tournament?.id;
            if (tId === 1993) {
                cleanTournamentName = "TFF 2. Lig (Beyaz Grup)";
            } else if (tId === 1994) {
                cleanTournamentName = "TFF 2. Lig (Kırmızı Grup)";
            } else {
                cleanTournamentName = "TFF 2. Lig";
            }
        }
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayTR = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        if (!targetDates.includes(dayTR)) return;
        const timeString = dateTR.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        const fallbackBroadcaster = getFootBroadcaster(leagueId, hName, aName, tName, utName);
        const result = getBroadcasterWithFallback("futbol", dayTR, timeString, hName, aName, fallbackBroadcaster);
        const finalBroadcaster = result.kanal;
        // -------- LOG Yığını için ekle ----------------
        futbolMatchesLog.push({
            home: translateTeam(hName),
            away: translateTeam(aName),
            kanal: finalBroadcaster,
            source: result.source
        });
        // ------------------------------------------------
        duplicateTracker.set(e.id, {
            id: e.id,
            isElite: ELITE_FOOT_IDS.includes(leagueId),
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
            tournament: cleanTournamentName,
            timeObj: e.time
        });
    });
    const matches = Array.from(duplicateTracker.values()).sort((a, b) => a.timestamp - b.timestamp);

    // 🔔 BİLDİRİM KONTROLÜ (uploadToFirebase'den önce)
    await checkAndSendNotifications(matches);

    await uploadToFirebase("football", { success: true, lastUpdate: new Date().toLocaleTimeString('tr-TR'), matches });
    const hasLiveMatch = matches.some(m => m.status === 'inprogress');
    const upcomingMatches = matches.filter(m => m.status === 'notstarted' || m.status === 'delayed');
    const nextMatchTimestamp = upcomingMatches.length > 0 ? upcomingMatches[0].timestamp : null;
    // ---------- LOG TABLOSU! -------------
    logMatchesBySport({ futbol: futbolMatchesLog });
    // --------------------------------------
    console.log(`  ✅ Toplam ${matches.length} futbol maçı ${hasLiveMatch ? '(🟢 CANLI MAÇ VAR)' : '(⚪ Canlı maç yok)'}`);
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
    for (const date of [getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)]) {
        const data = await fetchData(`https://www.sofascore.com/api/v1/sport/basketball/scheduled-events/${date}`);
        if (data?.events) {
            allEvents.push(...data.events.filter(e => targetBaskIds.includes(e.tournament?.uniqueTournament?.id)));
        }
    }
    const finalMatches = [];
    const duplicateTracker = new Set();
    const trYesterday = getTRDate(-1);
    const trToday = getTRDate(0);
    const trTomorrow = getTRDate(1);
    const trNextDay = getTRDate(2);

    // -------- LOG için toplama başlat ---------
    let basketbolMatchesLog = [];
    // ------------------------------------------
    for (const e of allEvents) {
        const utId = e.tournament?.uniqueTournament?.id;
        const utName = e.tournament?.uniqueTournament?.name || "";
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        if (dayStr !== trYesterday && dayStr !== trToday && dayStr !== trTomorrow && dayStr !== trNextDay) continue;
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
        const result = getBroadcasterWithFallback("basketbol", dayStr, timeString, e.homeTeam.name, e.awayTeam.name, fallbackBroadcaster);
        const finalBroadcaster = result.kanal;
        // -------- LOG Yığını için ekle ----------------
        basketbolMatchesLog.push({
            home: e.homeTeam.name,
            away: e.awayTeam.name,
            kanal: finalBroadcaster,
            source: result.source
        });
        // ------------------------------------------------
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
    // ---------- LOG TABLOSU! -------------
    logMatchesBySport({ basketbol: basketbolMatchesLog });
    // --------------------------------------
    console.log(`  ✅ Toplam ${finalMatches.length} basketbol maçı kaydedildi.`);
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
    const targetDates = [getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)];
    const seenEventIds = new Set();
    // ---- LOG için hazırlık
    let tenisMatchesLog = [];
    // ---------------------
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
            const hName = e.homeTeam?.name || "Belli Değil";
            const aName = e.awayTeam?.name || "Belli Değil";
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
            const fallbackBroadcaster = "Eurosport / S Sport Plus / HBO Max";
            const result = getBroadcasterWithFallback("tenis", fixedDate, timeString, hName, aName, fallbackBroadcaster);
            const finalBroadcaster = result.kanal;
            // -------- LOG Yığını için ekle ----------------
            tenisMatchesLog.push({
                home: hName,
                away: aName,
                kanal: finalBroadcaster,
                source: result.source
            });
            // ------------------------------------------------
            finalMatches.push({
                id: e.id,
                isElite: checkIsEliteMatch(tourName),
                status: statusType,
                fixedDate: fixedDate,
                fixedTime: timeString,
                timestamp: startTimestamp,
                broadcaster: finalBroadcaster,
                homeTeam: { name: hName, ranking: hRank, logos: homeLogos },
                awayTeam: { name: aName, ranking: aRank, logos: awayLogos },
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
    // ---------- LOG TABLOSU! -------------
    logMatchesBySport({ tenis: tenisMatchesLog });
    // --------------------------------------
    console.log(`  ✅ Toplam ${finalMatches.length} tenis maçı kaydedildi.`);
}


// =========================================================================
// 🏎️ FORMULA 1 GÜNCEL VERİLER VE PİST DETAYLARI (HATASIZ VE TAM SÜRÜM)
// =========================================================================
// NOT: GITHUB_USER ve REPO_NAME dosyanın en başında tanımlı olduğu için burada tekrar yazmıyoruz.
const F1_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/tournament_logos/`;
const F1_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/logos/`;
// Pist teknik detayları - Android modelindeki circuitStats yapısına birebir uygun
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
        
        // Uygulamanın Java kodundaki circuitStats hiyerarşisi
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
                // BURASI ÖNEMLİ: Java tarafındaki target.circuitStats.laps için gereken yapı
                circuitStats: {
                    laps: stats.laps,
                    length: stats.length,
                    record: stats.record
                },
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
    await uploadToFirebase("f1", { 
        success: true, 
        lastUpdated: new Date().toISOString(), 
        totalSessions: finalEvents.length, 
        events: finalEvents 
    });
    
    console.log(`  ✅ F1: Değişken hatası giderildi ve uygulama hiyerarşisi (circuitStats) sağlandı.`);
    
} catch (error) { 
    console.error(`   ⚠️ F1 hatası: ${error.message}`); 
}
}
// =========================================================================
// 🔄 ANA DÖNGÜ
// =========================================================================
async function main() {
    
    loadState(); 
console.log("============================================================");
console.log("🟢 J7 CANLI SUNUCU BAŞLADI (FIREBASE + AKILLI ZAMANLAYICI)");
console.log("============================================================");
let iteration = 1;
let footballStatus = { hasLiveMatch: false, nextMatchTimestamp: null };
let timeSinceLastFullUpdate = FULL_UPDATE_INTERVAL_MS; 
while (true) {
    try {
        console.log(`\n[İterasyon ${iteration}] ${new Date().toLocaleTimeString('tr-TR')}`);
        
        loadExternalBroadcasters();
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
