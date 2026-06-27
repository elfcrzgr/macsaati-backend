const fs = require('fs');
const admin = require('firebase-admin');
const apn = require('apn');
const axios = require('axios');

const IS_PRODUCTION = false; 
const API_SPORTS_KEY = '870e5a7510c80ee4e84491d6c891bfe7'; 
const GITHUB_USER = "elfcrzgr";
const REPO_NAME = "macsaati-backend";
const MINUTE_MS = 60000;

const serviceAccount = JSON.parse(fs.readFileSync('./serviceAccountKey.json', 'utf8'));
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app/"
});

const apnProvider = new apn.Provider({
    token: { key: __dirname + "/AuthKey_9JFB2X7TY9.p8", keyId: "9JFB2X7TY9", teamId: "9MQ7UDX75J" },
    production: IS_PRODUCTION
});

const previousMatchStates = new Map();
const pendingGoalCancel = new Map();
const globalFootballCache = new Map();
const STATE_FILE = 'futbol_states.json';
const triggeredMatches = new Set();

function saveState() { fs.writeFileSync(STATE_FILE, JSON.stringify(Object.fromEntries(previousMatchStates))); }
function loadState() {
    if (fs.existsSync(STATE_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            for (const [key, val] of Object.entries(data)) previousMatchStates.set(key, val);
        } catch (e) {}
    }
}

let externalBroadcasters = {};
function loadExternalBroadcasters() {
    try {
        if (fs.existsSync('yayinci_bilgisi.json')) externalBroadcasters = JSON.parse(fs.readFileSync('yayinci_bilgisi.json', 'utf8'));
    } catch (e) { externalBroadcasters = {}; }
}

function getBroadcasterWithFallback(dateStr, timeStr, homeName, awayName, fallback) {
    const cleanTime = (timeStr || "").replace(/\n?CANLI/, "").replace(/\n?MS/, "").replace('.', ':').trim();
    const [cH, cM] = cleanTime.split(':').map(Number);
    const toTR = (str) => str.replace(/İ/g, 'i').replace(/I/g, 'i').replace(/ı/g, 'i').toLowerCase().trim();
    
    for (const dateKey of [dateStr]) { // Sadeleştirildi
        const dayData = externalBroadcasters[dateKey];
        if (!dayData || !dayData.matches) continue;
        for (const m of dayData.matches) {
            if (m.spor && toTR(m.spor) === "futbol") {
                const mTime = (m.saat || "").replace('.', ':').trim();
                const mTitle = toTR(m.mac || "");
                const hWords = toTR(homeName).split(' ').filter(w => w.length >= 3);
                const aWords = toTR(awayName).split(' ').filter(w => w.length >= 3);
                const matchHome = hWords.length === 0 || hWords.some(w => mTitle.includes(w));
                const matchAway = aWords.length === 0 || aWords.some(w => mTitle.includes(w));
                if (matchHome && matchAway) return { kanal: m.yayin, source: "sporekrani" };
            }
        }
    }
    return { kanal: fallback, source: "fallback" };
}

async function fetchData(url) {
    try {
        const directUrl = url.replace('api-football-v1.p.rapidapi.com/v3', 'v3.football.api-sports.io');
        const response = await axios.get(directUrl, { headers: { 'x-apisports-key': API_SPORTS_KEY }, timeout: 10000 });
        return response.data?.response || [];
    } catch (e) { return null; }
}

const getTRDate = (offset = 0) => {
    const d = new Date(); d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
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

//const ELITE_FOOT_IDS = [39, 140, 78, 135, 61, 203, 2, 3, 848, 1, 4, 9, 15, 66, 137, 71]; 
const ELITE_FOOT_IDS = [1]; 
//const REGULAR_FOOT_IDS = [204, 205, 206, 40, 41, 141, 136, 62, 79, 72, 119, 144, 253, 283];
const REGULAR_FOOT_IDS = [];
const ALL_FOOT_TARGETS = [...ELITE_FOOT_IDS, ...REGULAR_FOOT_IDS];

const footballLeagues = { 39: "İngiltere Premier Lig", 140: "İspanya La Liga", 78: "Almanya Bundesliga", 135: "İtalya Serie A", 61: "Fransa Ligue 1", 203: "Türkiye Süper Lig", 204: "Trendyol 1. Lig", 205: "TFF 2. Lig", 206: "Türkiye Kupası", 2: "UEFA Şampiyonlar Ligi", 3: "UEFA Avrupa Ligi", 848: "UEFA Konferans Ligi", 1: "FIFA Dünya Kupası", 4: "UEFA EURO", 9: "Copa America" };
const tournamentLogoMapper = { 39: 17, 140: 8, 78: 35, 135: 23, 61: 34, 203: 52, 204: 98, 205: 97, 206: 938, 2: 7, 3: 679, 848: 17015, 1: 16, 4: 1, 9: 133 };

const getFootBroadcaster = (leagueId) => {
    const staticConfigs = { 39: "beIN Sports", 140: "S Sport Plus", 78: "Tivibu Spor", 135: "S Sport Plus", 61: "beIN Sports", 203: "beIN Sports", 204: "TRT Spor", 205: "TFF YouTube", 206: "A Spor", 2: "Tabii / TRT", 3: "Tabii / TRT", 848: "Tabii / TRT" };
    return staticConfigs[leagueId] || "Resmi Yayıncı";
};

// ... (Push Notification Fonksiyonları Aynı Kalıyor - sendPush, triggerPushToStart, checkAndSendNotifications)
async function sendPush(id, title, body, imageUrl = null, matchData = null) {
    const now = Date.now();
    if (now - (lastNotificationTime.get(id) || 0) < 15000) return;
    try {
        const payload = { topic: `match_${id}`, notification: { title, body }, data: { matchId: String(id), type: "match_update", title, body, imageUrl: imageUrl || "" }, apns: { headers: { "apns-push-type": "alert", "apns-priority": "10" }, payload: { aps: { alert: { title, body }, "mutable-content": 1, sound: "default", category: "MATCH_UPDATE" }, matchId: String(id), type: "match_update" } } };
        if (matchData) {
            payload.data.homeName = String(matchData.homeTeam?.name || ""); payload.data.awayName = String(matchData.awayTeam?.name || "");
            payload.apns.payload.homeLogo = String(matchData.homeTeam?.logo || ""); payload.apns.payload.awayLogo = String(matchData.awayTeam?.logo || "");
        }
        await admin.messaging().send(payload);
        lastNotificationTime.set(id, now);
    } catch (e) {}
}

async function checkAndSendNotifications(newMatches) {
    for (const match of newMatches) {
        const matchIdStr = String(match.id);
        const prev = previousMatchStates.get(matchIdStr) || { status: null, homeScore: 0, awayScore: 0, lastMinute: 0, liveMinuteStr: "" };
        let currH = parseInt(match.homeScore) || 0; let currA = parseInt(match.awayScore) || 0;
        const isLive = match.status === 'inprogress'; const isFinished = ['finished', 'ended'].includes(match.status);

        if ((isLive || isFinished) && (match.liveMinute !== prev.liveMinuteStr || currH !== prev.homeScore || currA !== prev.awayScore || match.status !== prev.status)) {
            const tokensObj = (await admin.database().ref(`live_activity_tokens/${matchIdStr}`).once('value')).val();
            if (tokensObj) {
                const promises = Object.keys(tokensObj).map(async (deviceToken) => {
                    let notification = new apn.Notification();
                    notification.rawPayload = { aps: { timestamp: Math.floor(Date.now() / 1000), event: isFinished ? 'end' : 'update', "content-state": { homeScore: currH, awayScore: currA, matchMinute: isFinished ? "MS" : String(match.liveMinute) } } };
                    notification.topic = "com.elfcrzgr.macsaati.push-type.liveactivity"; notification.pushType = "liveactivity"; notification.priority = 10;
                    if (typeof notification.headers === 'function') { const orig = notification.headers.bind(notification); notification.headers = () => ({ ...orig(), "apns-push-type": "liveactivity" }); }
                    try { await apnProvider.send(notification, deviceToken); } catch (e) {}
                });
                await Promise.all(promises);
            }
        }
        previousMatchStates.set(matchIdStr, { status: match.status, homeScore: currH, awayScore: currA, liveMinuteStr: match.liveMinute, date: match.fixedDate || getTRDate(0) });
    }
    saveState();
}

async function updateFootball(targetDates) {
    console.log(`⚽ Futbol verisi çekiliyor... (Gün: ${targetDates.length})`);
    let allFixtures = [];
    for (const date of targetDates) {
        const fixtures = await fetchData(`https://v3.football.api-sports.io/fixtures?date=${date}`);
        if (fixtures) allFixtures.push(...fixtures.filter(f => ALL_FOOT_TARGETS.includes(f.league.id)));
    }
    if (allFixtures.length === 0) return { hasLiveMatch: false, nextMatchTimestamp: null };

    const validDates = [getTRDate(-2), getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)];
    for (const [id, match] of globalFootballCache.entries()) if (!validDates.includes(match.fixedDate)) globalFootballCache.delete(id);

    allFixtures.forEach(e => {
        const shortStatus = e.fixture.status.short;
        if (['PST', 'CANC', 'ABD'].includes(shortStatus)) return;
        let status = 'notstarted'; let liveMinute = "";
        if (['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE'].includes(shortStatus)) {
            status = 'inprogress'; liveMinute = shortStatus === 'HT' ? "İY" : (e.fixture.status.elapsed ? `${e.fixture.status.elapsed}'` : "Canlı");
        } else if (['FT', 'AET', 'PEN'].includes(shortStatus)) status = 'finished';

        const leagueId = e.league.id; const hName = translateTeam(e.teams.home.name); const aName = translateTeam(e.teams.away.name);
        const dateTR = new Date(e.fixture.timestamp * 1000);
        const dayTR = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        const timeString = dateTR.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        const result = getBroadcasterWithFallback(dayTR, timeString, hName, aName, getFootBroadcaster(leagueId));

        globalFootballCache.set(e.fixture.id, {
            id: e.fixture.id, isElite: ELITE_FOOT_IDS.includes(leagueId), status: status, liveMinute: liveMinute, fixedDate: dayTR, fixedTime: timeString, timestamp: e.fixture.timestamp * 1000, broadcaster: result.kanal,
            homeTeam: { name: hName, logo: e.teams.home.logo, id: e.teams.home.id }, awayTeam: { name: aName, logo: e.teams.away.logo, id: e.teams.away.id },
            tournamentLogo: tournamentLogoMapper[leagueId] ? `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/${tournamentLogoMapper[leagueId]}.png` : e.league.logo,
            homeScore: (status === 'inprogress' || status === 'finished') ? String(e.goals.home ?? "0") : "-", awayScore: (status === 'inprogress' || status === 'finished') ? String(e.goals.away ?? "0") : "-", tournament: footballLeagues[leagueId] || e.league.name
        });
    });

    const matches = Array.from(globalFootballCache.values()).sort((a, b) => a.timestamp - b.timestamp);
    await checkAndSendNotifications(matches);
    await admin.database().ref(`matches_football`).set({ success: true, lastUpdate: new Date().toLocaleTimeString('tr-TR'), matches });
    
    let nextMatch = null; let hasLive = false;
    for (const m of matches) {
        if (m.status === 'inprogress') hasLive = true;
        if (m.status === 'notstarted' && m.timestamp > Date.now() && (!nextMatch || m.timestamp < nextMatch)) nextMatch = m.timestamp;
    }
    console.log(`✅ Futbol Tamam. Canlı: ${hasLive ? 'VAR' : 'YOK'}`);
    return { hasLiveMatch: hasLive, nextMatchTimestamp: nextMatch };
}

async function main() {
    loadState();
    console.log("🟢 J7 FUTBOL MİKROSERVİSİ BAŞLADI");
    while (true) {
        try {
            loadExternalBroadcasters();
            const now = Date.now();
            
            let hasToday = false;
            for (const m of globalFootballCache.values()) if (m.fixedDate === getTRDate(0)) { hasToday = true; break; }
            if (!hasToday) await updateFootball([getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)]);

            const res = await updateFootball([getTRDate(0)]);
            let sleepTime = 15 * MINUTE_MS; // Maç yoksa 15 dk uyu
            
            if (res.hasLiveMatch) {
                sleepTime = MINUTE_MS; // Canlı varsa 1 dk
            } else if (res.nextMatchTimestamp && (res.nextMatchTimestamp - now) < (15 * MINUTE_MS)) {
                sleepTime = MINUTE_MS; // Maça az kaldıysa 1 dk
            }

            console.log(`⏱️ Futbol servisi ${sleepTime / 60000} dakika uyuyor...`);
            await new Promise(r => setTimeout(r, sleepTime));
        } catch (e) { await new Promise(r => setTimeout(r, MINUTE_MS)); }
    }
}
main();
