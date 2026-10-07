const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

require('events').EventEmitter.defaultMaxListeners = 100;

// =========================================================================
// 🔥 AYARLAR VE ÇALIŞMA ORTAMI
// =========================================================================
const STATE_FILE = 'tennis_states.json'; 
const GITHUB_USER = "elfcrzgr";
const REPO_NAME = "macsaati-backend";
const MINUTE_MS = 180000; 
const TEN_MIN_MS = 10 * 60000;

const emptyLeaguesCache = new Map();

// =========================================================================
// 🔥 FIREBASE BAŞLATMA
// =========================================================================
const serviceAccount = JSON.parse(fs.readFileSync('./serviceAccountKey.json', 'utf8'));
const firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app/"
}, 'tennis_app');
console.log("🔥 [TENİS] Firebase Admin başlatıldı.");

// =========================================================================
// 🧠 GLOBAL HAFIZA (CACHE) VE DURUM YÖNETİMİ
// =========================================================================
const previousMatchStates = new Map();
const globalTennisCache = new Map();

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
        console.log(`\n--------- 🎾 TENİS SPOREKRANI ---------`);
        for (const matchInfo of sporekraniMatches) {
            const { home, away, kanal } = matchInfo;
            console.log(`🎾 ${home} vs ${away} | Kanal: ${kanal}`);
        }
        console.log('---------------------------------------------');
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
            for (const [key, val] of Object.entries(data)) previousMatchStates.set(key, val);
            console.log(`📂 [HAFIZA-TENİS] ${previousMatchStates.size} maç durumu yüklendi.`);
        } catch (e) { console.error("❌ Hafıza dosyası okunamadı."); }
    }
}

// =========================================================================
// 🌉 HARİCİ YAYINCI DOSYASI (SPOREKRANI) ENTEGRASYONU
// =========================================================================
let externalBroadcasters = {};

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

async function loadExternalBroadcasters() {
    try {
        const url = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/yayinci_bilgisi.json?t=${Date.now()}`;
        const response = await fetch(url, { signal: timeoutSignal(10000) });
        if (response.ok) {
            externalBroadcasters = await response.json();
            fs.writeFileSync('yayinci_bilgisi.json', JSON.stringify(externalBroadcasters, null, 2));
        }
    } catch (e) {
        if (fs.existsSync('yayinci_bilgisi.json')) {
            try { externalBroadcasters = JSON.parse(fs.readFileSync('yayinci_bilgisi.json', 'utf8')); } 
            catch (err) { externalBroadcasters = {}; }
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
        return [0, 1].map(offset => {
            const dateObj = new Date(y, m - 1, d + offset);
            return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
        });
    };

    for (const dateKey of getSafeDates(dateStr)) {
        const dayData = externalBroadcasters[dateKey];
        const matchesArray = Array.isArray(dayData) ? dayData : dayData?.matches;
        if (!matchesArray || !Array.isArray(matchesArray)) continue;

        for (const m of matchesArray) {
            if (m.spor && normalizeStr(m.spor) === normalizeStr(sportCategory)) {
                const mTime = (m.saat || "").replace('.', ':').trim();
                const [mH, mM] = mTime.split(':').map(Number);
                const mTitleClean = normalizeStr(m.mac);

                const matchHome = homeWords.length > 0 && homeWords.some(w => mTitleClean.includes(w));
                const matchAway = awayWords.length > 0 && awayWords.some(w => mTitleClean.includes(w));
                const matchScore = (matchHome ? 1 : 0) + (matchAway ? 1 : 0);

                let diff = 9999;
                if (mTime === cleanTime) diff = 0;
                else if (!isNaN(mH) && !isNaN(cH) && !isNaN(mM) && !isNaN(cM)) {
                    diff = Math.abs((mH * 60 + mM) - (cH * 60 + cM));
                    if (diff > 1000) diff = Math.abs(diff - 1440);
                }

                if (matchScore === 2 && diff <= 300) return { kanal: m.yayin, source: "sporekrani" };
                else if (matchScore === 1 && diff <= 15 && dateKey === dateStr) return { kanal: m.yayin, source: "sporekrani" };
            }
        }
    }
    return { kanal: fallback, source: "fallback" };
}

// =========================================================================
// 🛠️ YARDIMCI FONKSİYONLAR VE FETCH
// =========================================================================
async function uploadToFirebase(data) {
    try {
        await withTimeout(firebaseApp.database().ref(`matches_tennis`).set(data), 15000, 'Firebase yazma');
    } catch (error) { console.error(`❌ [FIREBASE-TENİS] Hata:`, error.message); }
}

const getTRDate = (offset = 0) => {
    const d = new Date(); d.setDate(d.getDate() + offset); 
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
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

// 🔥 MAÇKOLİK TENİS FETCH MOTORU
async function fetchMackolikTennis(dateStr) {
    try {
        const url = `https://api.mackolikfeeds.com/tennis/api/v1/matches/?add_playing=1&application=com.domainname.mackolik&country=tr&date=${dateStr}&extended_period=1&language=tr&migration_status=perform&tz=3`;
        const response = await fetch(url, {
            signal: timeoutSignal(15000),
            headers: {
                "Host": "api.mackolikfeeds.com",

                
                "X-RequestToken": "exp=1791365170~acl=/tennis/api/v1/matches/*~hmac=45FB266FCFA88CB5998260CE6F39C7888853653BEE443ADC34430D317974075F",
                "Connection": "keep-alive",
                "Accept": "*/*",
                "User-Agent": "Mackolik/5.8.7 (iPhone; iOS 27.0.1; Scale/3.00)",
                "X-Authorization": "token true",
                "Accept-Language": "tr-TR;q=1, en-GB;q=0.9"
            }
        });

      if (!response.ok) {
    console.error(`❌ Mackolik ${response.status} döndü (token süresi dolmuş olabilir)`);
    return null;
}
        return await response.json();
    } catch (e) { return null; }
}

const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/`;
const TENNIS_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/tournament_logos/`;

const COUNTRY_MAP = {
    "910661dd-2d4f-c036-3979-8b5bc4bbb9e3": "es", // Alcaraz, Munar
    "6235235d-c0b9-e432-f0fc-ebe4db00fc92": "fr", // K. Jacquet
    "c7a13592-8281-736f-2dba-f6fa53248df1": "ca", // D. Shapovalov
    "eec70fe8-49a2-be7f-aa41-da639f6c307c": "mc", // V. Vacherot (Monako)
    "f187256d-846e-0e87-f70a-51c459d38442": "cz", // J. Lehecka
    "a5b78ac7-bcae-84e0-8f98-68e90db12830": "py", // A. Vallejo
    "18acc5a7-13dd-43cf-a27a-969b547bf9d4": "au", // R. Hijikata
    "8c767174-4aa2-d72f-0193-2446a79ef5c5": "ua", // D. Yastremska
    "3763d9b2-3ef8-ef9a-d97e-14cfdd429958": "by", // A. Sabalenka
    "8956c473-914f-1a5e-6be3-a666b5ce4b0b": "ru", // P. Kudermetova
    "2cff13de-1bf1-e2bc-82a0-5f160b78c8b5": "ch", // V. Golubic
    "af56e826-daa0-e506-891e-2a2ffa544bb9": "jp", // N. Osaka
    "5b5ff3d7-c131-cc39-6470-be9b63fbf6f4": "hr", // D. Vekic
    "b1843503-12f3-ea19-2838-8d93118c7a7e": "pl", // I. Swiatek
    "501dc4bd-8129-8c1b-9873-704cb5165dee": "ar", // F. Cerundolo
    "a8298c84-81df-81cb-8c42-4fcf9b450ddb": "de", // A. Zverev
    "2af84eab-4ede-7445-355d-46bbfb95b0de": "rs", // N. Djokovic
    "ace18d13-1089-7298-3fd4-b790c66cf9ea": "nl", // S. Arends
    "424e06d0-4938-a642-e355-c91ad6bb7111": "kz", // A. Bublik
    "1bf74acb-d76d-f7e7-cb1d-d9409981d57b": "br", // M. Melo
    "b49feb9d-fa10-6942-b54a-22f1060fbb80": "gb", // J. Cash
    "b2c4ea35-a25c-f038-bb55-f826912c4f64": "cn", // Q. Tang
    "b5f65d72-ec19-43d8-5ddb-a6ff45957d02": "ru", // M. Kozyreva
    "1145958c-1496-eef8-913e-822f6302f738": "tr", // Zeynep Sönmez
    "4dbb5d9a-85df-3799-39d6-b18ea5e5745c": "us", // C. McNally
    "a1f4a627-5510-54f7-0f17-98ee028b06bc": "be", // E. Mertens
    "a3166fd4-a4e1-5b74-2d51-855032595b44": "no", // U. Eikeri
    "8e69dfd6-38ee-7738-3d1c-2028011930f8": "it", // F. Cina
    "8ffcdc14-e8fd-8fb1-c258-1c65b112d966": "ge", // N. Basilashvili
    "a3135470-a9af-3e81-7e13-738cc89d0547": "se", // E. Ymer
    "b8de80d5-4a75-c7c1-4705-527636636ea2": "za", // L. Harris
    "664dd4d0-f4fd-ae17-662d-77ec03a74609": "lv", // J. Ostapenko
    "6a260292-b79a-0601-9379-98d1c9508796": "gr", // M. Sakkari
    "e8540a1d-8c99-395d-5a1b-f0b0f2029659": "nz", // E. Routliffe
    "3c0f896c-16d1-bc06-deb9-66b830254895": "ee", // I. Neel
    "f996c22a-eb47-71e5-9826-02ea6e367247": "tn", // A. Dougaz
    "e9b82686-0f02-577d-9ace-8673dbaedc80": "tw", // C. Tseng
    "0a7272ab-507f-1c51-8fef-aa1d98bec32b": "co", // N. Mejia
    "3f75fe44-5eae-0ef6-5bb2-11ef3cbad4ce": "kr", // S. Hong
    "e53868d9-8464-3d1c-20e7-184f67f70491": "hk", // C. Wong
    "c7e57f0d-24d8-4640-d1b4-1ea0a034dbdc": "dk", // H. Rune
    "f62e199c-62fe-df12-b2fc-0aeb812e2d85": "pt", // N. Borges
    "cb43b48d-4904-c1e5-a044-c484f8ba5b91": "hu", // F. Marozsan
    "df9f507d-9501-b90b-df51-f30ab1777d0a": "ph", // A. Eala
    "a27c2174-2865-3cf9-ee26-05581e82b131": "cl", // A. Tabilo
    "0d70b5fc-21df-e66f-c1f2-2ca54d561072": "bo", // H. Dellien
    "822cd481-23d3-dc0b-0eb4-77ed1a908696": "in", // Y. Bhambri
    "e863220f-c7b5-0f9a-b2b2-6fae25f883fa": "sv", // M. Arevalo-Gonzalez
    "851f242e-74db-31c8-d564-6b6d47bd3ced": "sk", // T. Mihalikova
    "d16f0b87-e792-3a30-2592-1237ec9485f0": "pe", // J. Varillas
    "4d6da64d-bd11-ea9b-cd7c-fe38e9fad057": "th", // K. Samrej
    "dd4d0f50-33f4-28c3-e507-b4c073ae7ee7": "ro", // S. Cirstea
    "0fd76b9c-3f31-c3b5-b55a-40fc02aba104": "fi", // H. Heliovaara
    "ee7b470e-6a6a-7547-a659-c4e2071702b9": "at", // L. Miedler, S. Kraus
    "6726bf92-e107-6489-9b11-2cc1eb92f0cf": "si", // D. Jakupovic
    "37cddb29-1b8c-a1ec-9685-6098abbc239e": "md", // R. Albot
    "ef6071ec-86b2-f2c8-2505-0547d397501a": "lt", // E. Butvilas
    "c52340e9-b928-a524-cc1f-78ebca6bb174": "zw", // B. Lock
    "9b9432da-ffaf-ab9f-2c5f-f7a77872e8fe": "uy", // A. Behar
    "03eb3ba0-a6ec-ae26-ea02-3409721933b4": "id", // J. Tjen
    "29bbeeff-f74b-5fe3-8162-772f7266d048": "jo", // A. Shelbayh
    "df598250-6bba-48cb-eeaf-5e49dd985b9f": "am", // E. Avanesyan
    "0af744fc-7ad2-865d-d41a-dc4f091d949f": "ba", // D. Dzumhur
};

const unknownCountries = new Set();
function getFlagUrl(player) {
    const uuid = player?.country?.uuid;
    if (!uuid) return null;
    const code = COUNTRY_MAP[uuid];
    if (!code) {
        if (!unknownCountries.has(uuid)) {
            unknownCountries.add(uuid);
            console.log(`❓ "${uuid}": "??", // ${player.displayName}`);
        }
        return null;
    }
    return `${TENNIS_LOGO_BASE}${code}.png`;
}

// =========================================================================
// 🎾 TENİS GÜNCELLEME (ARINDIRILMIŞ SAF YAPI)
// =========================================================================
async function updateTennis(targetDates = [getTRDate(0)], isQuickScan = false) {
    console.log(`🎾 Tenis: (Mod: ${isQuickScan ? '🚀 HIZLI (3dk)' : '🐢 DETAYLI'}) Tarihler: ${targetDates.join(', ')}`);
    
    let allMatches = [];
    let tenisMatchesLog = [];
    let anySuccess = false;

 for (const date of targetDates) {
        const responseData = await fetchMackolikTennis(date);
        const tournaments = responseData?.data?.tournaments;

        if (tournaments && Array.isArray(tournaments)) {
            anySuccess = true;
            tournaments.forEach(tour => {
                const tourName = tour.name || "";
                const nameUpper = tourName.toUpperCase();
                const compId = tour.competition?.id;

                // 🛑 KATI BEYAZ LİSTE (Whitelist): Sadece bu listedeki kelimeleri içeren turnuvalar içeri günden gelebilir!
                const allowedTournaments = [
                    "TOKYO", "BEIJING", "PEKİN", "SHANGHAI", "ŞANGHAY", 
                    "WIMBLEDON", "US OPEN", "AUSTRALIAN OPEN", "ROLAND GARROS", 
                    "FRENCH OPEN", "INDIAN WELLS", "MIAMI", "MONTE CARLO", 
                    "MADRID", "ROME", "ROMA", "CINCINNATI", "CANADA", "MONTREAL", 
                    "TORONTO", "PARIS", "PARİS", "BASEL", "VIENNA", "VİYANA", 
                    "HAMBURG", "ACAPULCO", "DUBAI", "DUBAİ", "ROTTERDAM", 
                    "BARCELONA", "BARSELONA", "QUEEN", "HALLE"
                ];

                const isAllowed = allowedTournaments.some(item => nameUpper.includes(item));
                
                // Eğer gelen turnuva yukarıdaki listede yoksa (Adana, Samsun, Wuning, Suzhou vb. hepsi) DİREKT REDDEDİLİR!
                if (!isAllowed) {
                    return; 
                }

                console.log(`✅ Onaylanan Elit Turnuva: "${tourName}" | ID: ${compId}`);

                const categories = tour.categories || [];
                categories.forEach(cat => {
                    const rounds = cat.rounds || [];
                    rounds.forEach(round => {
                        const matches = round.matches || [];
                        matches.forEach(match => {
                            match.competitionName = tourName;
                            match.competitionId = compId;
                            match.fixedDate = date;
                            allMatches.push(match);
                        });
                    });
                });
            });
        }
    }

    console.log(`📊 Toplam çekilen tenis maçı sayısı: ${allMatches.length}`);

    if (!anySuccess || allMatches.length === 0) {
        const stillLive = Array.from(globalTennisCache.values()).some(m => m.status === 'inprogress');
        return {
            hasLiveMatch: stillLive || sportUpdateStatus.hasLiveMatch,
            nextMatchTimestamp: sportUpdateStatus.nextMatchTime,
            hasAnyMatches: globalTennisCache.size > 0
        };
    }

    const validDates = [getTRDate(-2), getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)];
    for (const [id, match] of globalTennisCache.entries()) {
        if (!validDates.includes(match.fixedDate)) globalTennisCache.delete(id);
    }

    for (const e of allMatches) {
        const p1 = e.contestants?.[0]?.players?.[0];
        const p2 = e.contestants?.[1]?.players?.[0];

        const hName = p1?.displayName || p1?.shortName || "Tenisçi 1";
        const aName = p2?.displayName || p2?.shortName || "Tenisçi 2";

        const rawStatus = String(e.status || "").toLowerCase();
        let statusType = 'notstarted';
        if (rawStatus === 'played' || rawStatus === 'finished' || rawStatus === 'ft') statusType = 'finished';
        else if (rawStatus === 'playing' || rawStatus === 'live' || rawStatus.includes('set')) {
            statusType = 'inprogress';
        }

        const isFinished = statusType === 'finished'; 
        const isInProgress = statusType === 'inprogress';
        const hasScore = isFinished || isInProgress;

       const homeLogos = [getFlagUrl(p1) || `${TENNIS_LOGO_BASE}mc.png`];
       const awayLogos = [getFlagUrl(p2) || `${TENNIS_LOGO_BASE}mc.png`];

        // 🏆 Güncel Sofascore ID'lerine Göre Turnuva Logosu Eşleme Fonksiyonu
        const getRepoLogoByTournamentName = (tourName) => {
            if (!tourName) return "default.png";
            const n = tourName.toUpperCase();

            // 🏆 GRAND SLAM
            if (n.includes("AUSTRALIAN OPEN")) return "2363.png";
            if (n.includes("ROLAND GARROS") || n.includes("FRENCH OPEN")) return "2480.png";
            if (n.includes("WIMBLEDON")) return "2361.png";
            if (n.includes("US OPEN")) return "2449.png";

            // 👑 MASTERS 1000
            if (n.includes("INDIAN WELLS")) return "2487.png";
            if (n.includes("MIAMI")) return "2430.png";
            if (n.includes("MONTE CARLO")) return "2391.png";
            if (n.includes("MADRID")) return "2374.png";
            if (n.includes("ROME") || n.includes("ROMA")) return "2488.png";
            if (n.includes("MONTREAL") || n.includes("TORONTO") || n.includes("CANADA")) return "2390.png";
            if (n.includes("CINCINNATI")) return "2373.png";
            if (n.includes("SHANGHAI") || n.includes("ŞANGHAY")) return "2519.png";
            if (n.includes("PARIS") || n.includes("PARİS")) return "2404.png";

            // 🌟 ATP 500 / WTA 500
            if (n.includes("TOKYO")) return "2435.png";
            if (n.includes("BEIJING") || n.includes("PEKİN")) return "2436.png";
            if (n.includes("WASHINGTON")) return "2368.png";
            if (n.includes("ROTTERDAM")) return "2444.png";
            if (n.includes("DUBAI") || n.includes("DUBAİ")) return "2389.png";
            if (n.includes("BARCELONA") || n.includes("BARSELONA")) return "2407.png";
            if (n.includes("HALLE")) return "2493.png";
            if (n.includes("HAMBURG")) return "2405.png";
            if (n.includes("VIENNA") || n.includes("VİYANA")) return "2428.png";

            return "default.png";
        };

        const tournamentLogoUrl = `${TENNIS_TOURNAMENT_BASE}${getRepoLogoByTournamentName(e.competitionName)}`;
       
    

                       // Set ve Maç Skoru Hesaplama
        let setScoresArr = [];
        let homeSetsWon = 0;
        let awaySetsWon = 0;

        // Bir set bitti mi? (6+ gem ve 2 fark, ya da 7 gem)
        const isSetComplete = (g1, g2) => {
            const hi = Math.max(g1, g2);
            const lo = Math.min(g1, g2);
            return (hi >= 6 && hi - lo >= 2) || hi === 7;
        };

        if (e.sets && Array.isArray(e.sets)) {
            e.sets.forEach(s => {
                const g1 = s.score?.[0]?.games ?? 0;
                const g2 = s.score?.[1]?.games ?? 0;
                if (g1 > 0 || g2 > 0) {
                    setScoresArr.push(`${g1}-${g2}`);
                    if (isSetComplete(g1, g2)) {
                        if (g1 > g2) homeSetsWon++;
                        else if (g2 > g1) awaySetsWon++;
                    }
                }
            });
        }

        let finalHomeScore = "-";
        let finalAwayScore = "-";
        if (isFinished && e.fts_A != null && e.fts_B != null) {
            // Biten maçlarda Mackolik'in kendi final set skoru
            finalHomeScore = String(e.fts_A);
            finalAwayScore = String(e.fts_B);
        } else if (hasScore) {
            finalHomeScore = String(homeSetsWon);
            finalAwayScore = String(awaySetsWon);
        }

        let timeString = "00:00";
        if (e.startTime) {
            const timePart = e.startTime.split(' ')[1];
            if (timePart) timeString = timePart.substring(0, 5);
        }

        if (isInProgress) {
            const periodStr = e.period || "CANLI";
            timeString = `${timeString}\n${periodStr}`;
        }

        const fallbackBroadcaster = "S Sport / S Sport Plus";
        const result = getBroadcasterWithFallback("tenis", e.fixedDate, timeString, hName, aName, fallbackBroadcaster);

        if (!isQuickScan) tenisMatchesLog.push({ home: hName, away: aName, kanal: result.kanal, source: result.source });

        globalTennisCache.set(e.id, {
            id: e.id, 
            isElite: true, 
            status: statusType, 
            fixedDate: e.fixedDate, 
            fixedTime: timeString, 
            timestamp: new Date(e.startTime || Date.now()).getTime(), 
            broadcaster: result.kanal,
            homeTeam: { name: hName, logos: homeLogos },
            awayTeam: { name: aName, logos: awayLogos },
            tournamentLogo: tournamentLogoUrl,
            homeScore: finalHomeScore, 
            awayScore: finalAwayScore, 
            setScores: setScoresArr, 
            tournament: e.competitionName || "Tenis Turnuvası"
        });

        previousMatchStates.set(String(e.id), { status: statusType, date: e.fixedDate });
    }

    const finalMatches = Array.from(globalTennisCache.values()).sort((a, b) => a.timestamp - b.timestamp);
    await uploadToFirebase({ success: true, matches: finalMatches });
    
    if (!isQuickScan && tenisMatchesLog.length < 30) logMatchesBySport({ tenis: tenisMatchesLog });
    saveState();
    
    const hasLiveMatch = finalMatches.some(m => m.status === 'inprogress');
    const nextMatchTimestamp = findNextMatchTime(globalTennisCache);
    return { hasLiveMatch, nextMatchTimestamp, hasAnyMatches: finalMatches.length > 0 };
}

// =========================================================================
// 🆕 ANA DÖNGÜ (TENİS)
// =========================================================================
async function main() {
    loadState();
    console.log("============================================================");
    console.log("🟢 [TENİS] BAĞIMSIZ MAÇKOLİK SERVİSİ BAŞLADI");
    console.log("============================================================");

    let lastPeriodicUpdate = 0;
    let lastBroadcastersString = "";
    let expectedWake = 0;

    const applyResult = (result) => {
        sportUpdateStatus.hasLiveMatch = result.hasLiveMatch;
        sportUpdateStatus.nextMatchTime = result.nextMatchTimestamp;
    };

    while (true) {
        try {
            const now = Date.now();
            if (expectedWake && now - expectedWake > 30000) {
                console.log(`⚠️ Döngü ${Math.round((now - expectedWake) / 1000)} sn geç uyandı: cihaz uykuya geçmiş olabilir.`);
            }
            
            await loadExternalBroadcasters();
            const currentBroadcastersString = JSON.stringify(externalBroadcasters);
            let forceUpdateDueToBroadcasters = false;
            
            if (lastBroadcastersString !== "" && currentBroadcastersString !== lastBroadcastersString) {
                console.log("📺 [YAYINCI] Yeni yayıncı bilgileri tespit edildi! Firebase güncelleniyor...");
                forceUpdateDueToBroadcasters = true;
            }
            lastBroadcastersString = currentBroadcastersString;

            const ist = getIstanbulNow();
            const msSinceMidnight = (ist.getHours() * 3600000) + (ist.getMinutes() * 60000) + (ist.getSeconds() * 1000);
            const startOfDay = now - msSinceMidnight;
            
            const TARGET_TIMES = [ 
                10 * 60 * 1000,              
                (1 * 60 + 15) * 60 * 1000,   
                (6 * 60 + 15) * 60 * 1000,    
                (9 * 60 + 15) * 60 * 1000,   
                (12 * 60 + 15) * 60 * 1000,  
                (15 * 60 + 15) * 60 * 1000   
            ];
            
            let activeTarget = startOfDay - (5 * 60 + 50) * 60 * 1000;
            for (let i = TARGET_TIMES.length - 1; i >= 0; i--) {
                if (msSinceMidnight >= TARGET_TIMES[i]) { activeTarget = startOfDay + TARGET_TIMES[i]; break; }
            }

            if (lastPeriodicUpdate < activeTarget || forceUpdateDueToBroadcasters) {
                console.log("\n🔄 [PERİYODİK / ZORUNLU] Tenis Detaylı Tarama Başlıyor...");
                const days4 = [getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)];
                const result = await withTimeout(updateTennis(days4, false), 120000, 'Detaylı tarama');
                applyResult(result);
                if (!forceUpdateDueToBroadcasters) lastPeriodicUpdate = now;
            }

            const currentHour = getIstanbulNow().getHours();
            let quickScanDates = [getTRDate(0)];
            if (currentHour >= 0 && currentHour <= 4) quickScanDates = [getTRDate(-1), getTRDate(0)];

            const isUpcoming = () => sportUpdateStatus.nextMatchTime && now >= (sportUpdateStatus.nextMatchTime - MINUTE_MS * 1.1);

            if (sportUpdateStatus.hasLiveMatch) {
                if (now - sportUpdateStatus.lastQuickUpdate >= MINUTE_MS) {
                    console.log("\n🎾 [HIZLI DÖNGÜ] Canlı tenis maçı var (3 dk aralıklı)!");
                    const result = await withTimeout(updateTennis(quickScanDates, true), 60000, 'Hızlı tarama');  
                    sportUpdateStatus.lastQuickUpdate = Date.now();
                    applyResult(result);
                }
            }
            else if (isUpcoming()) {
                if (now - sportUpdateStatus.lastQuickUpdate >= MINUTE_MS) {
                    console.log("\n⏰ [TENİS YAKLAŞAN] Yaklaşan tenis maçı vakti!");
                    const result = await withTimeout(updateTennis(quickScanDates, true), 60000, 'Hızlı tarama'); 
                    sportUpdateStatus.lastQuickUpdate = Date.now();
                    applyResult(result);
                }
            }

            let sleepTime;
            if (sportUpdateStatus.hasLiveMatch || isUpcoming()) {
                sleepTime = Math.max(10000, MINUTE_MS - (Date.now() - sportUpdateStatus.lastQuickUpdate));
                console.log(`\n⚡ [TENİS] Aktif/Yaklaşan maç var. ${Math.round(sleepTime / 1000)} sn sonra tekrar bakılacak.`);
            } else if (sportUpdateStatus.nextMatchTime && Date.now() >= sportUpdateStatus.nextMatchTime - MINUTE_MS * 12) {
                sleepTime = Math.min(30000, Math.max(10000, sportUpdateStatus.nextMatchTime - MINUTE_MS * 1.1 - Date.now()));
                console.log(`\n⏳ [TENİS] Maça az kaldı, ${Math.round(sleepTime / 1000)} sn sonra tekrar bakılacak.`);
            } else {
                sleepTime = TEN_MIN_MS;
                console.log("\n💤 [TENİS] Şu an hareket yok. 10 dakika derin uyku...");
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





main();




