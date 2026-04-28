const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// =========================================================================
// ⚙️ AYARLAR
// =========================================================================
const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

const MINUTE_MS = 60000; // 1 Dakika
const FULL_UPDATE_INTERVAL_MS = 20 * 60000; // 20 Dakika

// TARGET_FILE'ları TÜM SPOR DALLARI İÇİN
const TARGET_FILES = {
    football: "matches_football.json",
    basketball: "matches_basketball.json",
    tennis: "matches_tennis.json",
    f1: "matches_f1.json"
};

// Git Yapılandırması
const GIT_USER_NAME = process.env.GIT_USER_NAME || "J7 Live Server";
const GIT_USER_EMAIL = process.env.GIT_USER_EMAIL || "live@j7server.local";

// =========================================================================
// 🛠️ YARDIMCI FONKSİYONLAR
// =========================================================================

async function executeCommand(command) {
    try {
        const { stdout, stderr } = await execPromise(command, { 
            maxBuffer: 10 * 1024 * 1024,
            timeout: 30000
        });
        return stdout;
    } catch (error) {
        throw new Error(`${error.message}\n${error.stderr || ''}`);
    }
}

async function initGitConfig() {
    try {
        console.log("📋 Git yapılandırması kontrol ediliyor...");
        await executeCommand(`git config user.name "${GIT_USER_NAME}"`);
        await executeCommand(`git config user.email "${GIT_USER_EMAIL}"`);
        console.log(`✅ Git User: ${GIT_USER_NAME}`);
    } catch (error) {
        console.error(`⚠️ Git Config Hatası: ${error.message}`);
    }
}

async function fetchData(url) {
    try {
        const response = await fetch(url, {
            headers: { 
                "User-Agent": "Mozilla/5.0 (Linux; Android 10; Samsung J7) AppleWebKit/537.36" 
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
// 📥 PUSH İŞLEMİ (KURŞUN GEÇİRMEZ VERSİYON)
// =========================================================================
async function pushToGithub() {
    const simdi = new Date().toLocaleTimeString('tr-TR');
    
    const existingFiles = Object.values(TARGET_FILES).filter(file => fs.existsSync(file));
    
    if (existingFiles.length === 0) {
        console.warn(`⚠️ Hiç dosya bulunamadı!`);
        return;
    }

    try {
        console.log(`📤 GitHub senkronizasyonu başlıyor [${simdi}]...`);
        
        // Önce dosyaları sahneye al
        for (const file of existingFiles) {
            await executeCommand(`git add "${file}"`);
        }
        
        // Değişiklik var mı kontrol et
        const status = await executeCommand('git status --porcelain');
        if (!status.trim()) {
            console.log(`  ℹ️ Yeni değişiklik yok`);
            return;
        }
        
        // Commit işlemini yap
        await executeCommand(`git commit -m "J7 Canlı Güncelleme: ${simdi}"`);
        
        // Çakışma (Conflict) dinlemeden, GitHub'daki yenilikleri al ama yerel dosyaları (ours) KORU
        try {
            await executeCommand('git pull origin main --no-rebase -s recursive -X ours');
        } catch (pullErr) {
            console.log("  ⚠️ Pull uyarı verdi (Çakışma olabilir), push zorlanıyor...");
        }
        
        // Yenilenmiş ve çakışması çözülmüş veriyi gönder
        await executeCommand('git push origin main');
        
        console.log(`✅ [${simdi}] GitHub senkronizasyonu BAŞARILI! (${existingFiles.length} dosya)`);
        
    } catch (error) {
        console.error(`❌ Git İşlem Hatası: ${error.message}`);
        // Eğer askıda kalan bir işlem varsa temizle ki sonraki döngü patlamasın
        try { await executeCommand('git rebase --abort'); } catch(e){}
        try { await executeCommand('git merge --abort'); } catch(e){}
    }
}





// =========================================================================
// ⚽ FUTBOL (Çeviriler, Dinamik Yayıncılar ve Temiz İsimler)
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

// Senin harika yayıncı bulucun (id karışıklıkları giderildi)
const getFootBroadcaster = (utId, hName, aName, tName, utName) => {
    const hn = (hName || "").toLowerCase();
    const an = (aName || "").toLowerCase();
    const tn = (tName || "").toLowerCase();
    const utn = (utName || "").toLowerCase();

    const isTurkey = hn.includes("turkey") || an.includes("turkey") || 
                     hn.includes("türkiye") || an.includes("türkiye");
    const isPlayoff = tn.includes("play-off") || tn.includes("playoff") || 
                       utn.includes("play-off") || utn.includes("playoff");

    if (utId === 748 || utId === 750) return isTurkey ? "TRT Spor / Tabii" : "Exxen";
    if (utId === 11 || utn.includes("world cup qual") || utn.includes("dünya kupası eleme")) {
        if (isTurkey) return isPlayoff ? "TV8" : "TRT 1 / Tabii";
        return isPlayoff ? "Exxen" : "S Sport Plus";
    }

    const staticConfigs = {
        34: "beIN Sports", 52: "beIN Sports", 238: "TRT Spor / Tabii", 242: "TRT Spor / Tabii", 938: "TRT 1 / Tabii", 
        17: "S Sport Plus", 8: "beIN Sports", 23: "S Sport Plus", 7: "TRT 1 / Tabii", 351: "S Sport Plus", 
        37: "beIN Sports", 10: "Exxen / S Sport+", 13: "TRT 1 / Tabii", 393: "TRT 1 / Tabii", 155: "Spor Smart / Exxen", 
        10618: "Exxen / FIFA+", 4664: "S Sport+ / TV+", 98: "beIN Sports / Tivibu Spor", 97: "TFF YouTube", 11417: "TFF YouTube", 
        11416: "TFF YouTube", 11415: "TFF YouTube", 15938: "TFF YouTube", 696: "DAZN / YouTube", 13363: "USL YouTube", 
        10783: "A Spor", 232: "S Sport Plus / DAZN", 1: "S Sport Plus", 19: "Exxen"
    };

    if (staticConfigs[utId]) return staticConfigs[utId];
    if (utn.includes("j1 league")) return "YouTube (J.League Int.)";
    if (utn.includes("baller league")) return "Twitch / YouTube (Global)";
    if (utn.includes("primera a") || utn.includes("primera división")) return "TV Yayını Yok (Yerel)";
    if (utn.includes("mls next pro")) return "Apple TV / OneFootball";
    return "Resmi Yayıncı / Canlı Skor";
};

const ELITE_FOOT_IDS = [17, 8, 35, 23, 34, 52, 37, 238, 38, 36, 19, 97, 7, 679, 17015, 16, 1, 133, 270];
const REGULAR_FOOT_IDS = [53, 299, 6516, 325, 155, 242];
const ALL_FOOT_TARGETS = [...ELITE_FOOT_IDS, ...REGULAR_FOOT_IDS];

// Doğrulanmış Gerçek Sofascore Turnuva İsimleri
const footballLeagues = {
    17: "İngiltere Premier Lig", 
    8: "İspanya La Liga", 
    35: "Almanya Bundesliga",
    23: "İtalya Serie A", 
    34: "Fransa Ligue 1", 
    52: "Türkiye Süper Lig", 
    37: "Hollanda Eredivisie", 
    238: "Portekiz Primeira Liga", 
    38: "Belçika Pro League", 
    36: "İskoçya Premiership", 
    19: "FA Cup", 
    97: "Türkiye Kupası",
    53: "TFF 1. Lig", 
    7: "UEFA Şampiyonlar Ligi", // <-- Sorun yaratan 7 numara düzeltildi!
    679: "UEFA Avrupa Ligi",
    17015: "UEFA Konferans Ligi", 
    16: "FIFA Dünya Kupası", 
    1: "UEFA EURO",
    133: "Copa America", 
    270: "Afrika Uluslar Kupası", 
    299: "Uluslararası Hazırlık Maçları", // Gerçek hazırlık maçlarının ID'si budur
    6516: "Kulüp Hazırlık Maçları", 
    325: "Brezilya Serie A", 
    155: "Arjantin Liga Profesional",
    242: "MLS"
};

async function updateFootball() {
    console.log(`⚽ Futbol güncelleniyor...`);
    let allEvents = [];
    
    for (const date of [getTRDate(0), getTRDate(1)]) {
        const data = await fetchData(`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${date}?_=${Date.now()}`);
        if (data?.events) {
            allEvents.push(...data.events.filter(e => ALL_FOOT_TARGETS.includes(e.tournament?.uniqueTournament?.id)));
        }
    }

    // Çift maçları engellemek için Map
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
        const tName = e.tournament?.name || "";
        const utName = e.tournament?.uniqueTournament?.name || "";
        
        // Önce bizim sözlüğümüze bak, yoksa API'den gelen ana turnuva ismini kullan (Knockout stage gibi kalabalıkları atar)
        const cleanTournamentName = footballLeagues[leagueId] || e.tournament?.name || utName;

        duplicateTracker.set(e.id, {
            id: e.id,
            isElite: ELITE_FOOT_IDS.includes(leagueId),
            status: status,
            liveMinute: isLive ? (e.status.description || "") : "",
            fixedDate: new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: new Date(e.startTimestamp * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            timestamp: e.startTimestamp * 1000,
            
            broadcaster: getFootBroadcaster(leagueId, hName, aName, tName, utName),
            
            homeTeam: { name: translateTeam(hName), logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.homeTeam.id}.png` },
            awayTeam: { name: translateTeam(aName), logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.awayTeam.id}.png` },
            
            tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/${leagueId}.png`,
            homeScore: (isLive || status === 'finished') ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: (isLive || status === 'finished') ? String(e.awayScore?.display ?? "0") : "-",
            
            // Temizlenmiş turnuva adı basılıyor
            tournament: cleanTournamentName
        });
    });

    const matches = Array.from(duplicateTracker.values()).sort((a, b) => a.timestamp - b.timestamp);

    fs.writeFileSync(TARGET_FILES.football, JSON.stringify({ success: true, lastUpdate: new Date().toLocaleTimeString('tr-TR'), matches }, null, 2));
    
    const hasLiveMatch = matches.some(m => m.status === 'inprogress');

    const upcomingMatches = matches.filter(m => m.status === 'notstarted' || m.status === 'delayed');
    const nextMatchTimestamp = upcomingMatches.length > 0 ? upcomingMatches[0].timestamp : null;

    console.log(`  ✅ Toplam ${matches.length} futbol maçı ${hasLiveMatch ? '(🟢 CANLI MAÇ VAR)' : '(⚪ Canlı maç yok)'}`);
    Object.keys(leagueCount).forEach(leagueId => {
        const leagueName = footballLeagues[leagueId] || `Liga ${leagueId}`;
        console.log(`      • ${leagueName}: ${leagueCount[leagueId]} maç`);
    });

    return { hasLiveMatch, nextMatchTimestamp };
}


// =========================================================================
// 🏀 BASKETBOL
// =========================================================================
const ELITE_LEAGUE_IDS = [3547, 138, 142, 137, 132, 167, 168];
const leagueConfigs = { 
    3547: "S Sport / NBA TV", 138: "S Sport / S Sport Plus", 142: "S Sport Plus", 
    137: "TRT Spor / Tabii", 132: "beIN Sports 5", 167: "S Sport Plus / FIBA TV", 
    168: "TRT Spor Yıldız", 9357: "S Sport Plus", 139: "beIN Sports / TRT Spor",
    11511: "TRT Spor Yıldız / TBF TV", 21511: "TBF TV (YouTube)", 251: "S Sport Plus", 
    215: "S Sport Plus", 304: "S Sport Plus", 227: "beIN Sports", 164: "beIN Sports",
    235: "S Sport Plus", 405: "beIN Sports"
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
    
    // Liglerden kaç maç geldi hesapla
    const leagueCount = {};

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
        
        if (isInProgress) {
            timeString = `${timeString}\nCANLI`; 
        }

        const hasScore = isFinished || isInProgress;

        finalMatches.push({
            id: e.id,
            isElite: ELITE_LEAGUE_IDS.includes(utId), 
            status: statusType, 
            fixedDate: dayStr,
            fixedTime: timeString, 
            timestamp: dateTR.getTime(),
            broadcaster: leagueConfigs[utId] || "Resmi Yayıncı", 
            homeTeam: { 
                name: e.homeTeam.name, 
                logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/logos/${isNBA ? "NBA/" : ""}${e.homeTeam.id}.png` 
            },
            awayTeam: { 
                name: e.awayTeam.name, 
                logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/logos/${isNBA ? "NBA/" : ""}${e.awayTeam.id}.png` 
            },
            tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/tournament_logos/${isNBA ? "3547" : utId}.png`,
            homeScore: hasScore ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: hasScore ? String(e.awayScore?.display ?? "0") : "-",
            tournament: isNBA ? "NBA" : utName
        });
        duplicateTracker.add(matchKey);
        
        // Ligi say
        leagueCount[utId] = (leagueCount[utId] || 0) + 1;
    }

    finalMatches.sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync(TARGET_FILES.basketball, JSON.stringify({ success: true, matches: finalMatches }, null, 2));
    
    // Detaylı log
    console.log(`  ✅ Toplam ${finalMatches.length} basketbol maçı`);
    Object.keys(leagueCount).forEach(leagueId => {
        const leagueName = leagueConfigs[leagueId] || `Liga ${leagueId}`;
        console.log(`      • ${leagueName}: ${leagueCount[leagueId]} maç`);
    });
}

// =========================================================================
// 🎾 TENİS (DETAYLI SIRALAMA VE ÇİFTLER LOGOSU İLE)
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

// ✨ YENİ: SofaScore API'den ranking çekme (çiftler için de çalışır)
const getPlayerRankings = async (eventId, homeTeamId, awayTeamId) => {
    try {
        let hRank = null;
        let aRank = null;

        // 1. Event detay API'sinden çek
        const detailData = await fetchData(`https://www.sofascore.com/api/v1/event/${eventId}`);
        
        if (detailData?.event) {
            const ev = detailData.event;
            
            // Tekli maç için
            if (ev.homeTeam?.ranking !== undefined && ev.homeTeam.ranking !== null) {
                hRank = ev.homeTeam.ranking;
            }
            if (ev.awayTeam?.ranking !== undefined && ev.awayTeam.ranking !== null) {
                aRank = ev.awayTeam.ranking;
            }

            // Çiftler maç için: subTeams içinde player ranking'leri ara
            if (!hRank && ev.homeTeam?.subTeams?.length > 0) {
                const ranks = ev.homeTeam.subTeams
                    .map(p => p.ranking)
                    .filter(r => r !== undefined && r !== null);
                if (ranks.length > 0) {
                    // En iyi ranking'i al (en düşük sayı)
                    hRank = Math.min(...ranks);
                }
            }

            if (!aRank && ev.awayTeam?.subTeams?.length > 0) {
                const ranks = ev.awayTeam.subTeams
                    .map(p => p.ranking)
                    .filter(r => r !== undefined && r !== null);
                if (ranks.length > 0) {
                    aRank = Math.min(...ranks);
                }
            }
        }

        // 2. Eğer hala null ise, doğrudan player endpoint'ini dene
        if (!hRank && homeTeamId) {
            const homePlayerData = await fetchData(`https://www.sofascore.com/api/v1/player/${homeTeamId}`);
            if (homePlayerData?.player?.ranking) {
                hRank = homePlayerData.player.ranking;
            }
        }

        if (!aRank && awayTeamId) {
            const awayPlayerData = await fetchData(`https://www.sofascore.com/api/v1/player/${awayTeamId}`);
            if (awayPlayerData?.player?.ranking) {
                aRank = awayPlayerData.player.ranking;
            }
        }

        return { hRank, aRank };
    } catch (error) {
        console.error(`⚠️ Ranking çekilemedi (Event ID: ${eventId}):`, error.message);
        return { hRank: null, aRank: null };
    }
};

async function updateTennis() {
    console.log(`🎾 Tenis güncelleniyor (Detaylı Tarama Modu)...`);
    let rawEvents = [];
    const targetDates = [getTRDate(0), getTRDate(1), getTRDate(2)];
    
    const tournamentCount = {};

    // 1. AŞAMA: Günlük listeden maçları topla
    for (const date of targetDates) {
        try {
            const data = await fetchData(`https://www.sofascore.com/api/v1/sport/tennis/scheduled-events/${date}`);
            if (data?.events) {
                const filtered = data.events.filter(e => {
                    const tourName = e.tournament?.name;
                    const catName = e.tournament?.category?.name;
                    return !isGarbage(tourName, catName);
                });
                rawEvents.push(...filtered);
            }
        } catch (error) {
            console.error(`⚠️ Tarih ${date} için veriler çekilemedi:`, error.message);
            continue;
        }
    }

    console.log(`  📋 ${rawEvents.length} maç bulundu`);
    const finalMatches = [];

    // 2. AŞAMA: Her maçın içine girip eksik verileri (Sıralama ve Çiftler) çek
    for (let idx = 0; idx < rawEvents.length; idx++) {
        const e = rawEvents[idx];
        
        try {
            const startTimestamp = e.startTimestamp * 1000;
            const dateTR = new Date(startTimestamp);
            const fixedDate = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
            if (!targetDates.includes(fixedDate)) continue;

            const tourName = e.tournament?.name || "";
            if (isGarbage(tourName, e.tournament?.category?.name)) continue;

            let homeLogos = [];
            let awayLogos = [];
            let hRank = null;
            let aRank = null;

            // 🚨 BAN KORUMASI: SofaScore'u boğmamak için request'ler arasında bekle
            await new Promise(r => setTimeout(r, 250));

            // DETAY API'SİNE GİT
            const detailData = await fetchData(`https://www.sofascore.com/api/v1/event/${e.id}`);
            
            if (detailData && detailData.event) {
                const ev = detailData.event;

                // ✨ Ranking'i daha detaylı çek
                const { hRank: hR, aRank: aR } = await getPlayerRankings(
                    e.id, 
                    ev.homeTeam?.id, 
                    ev.awayTeam?.id
                );
                hRank = hR;
                aRank = aR;

                // Logo'ları çek
                const getCodes = (team) => {
                    if (team.subTeams && team.subTeams.length > 0) {
                        return team.subTeams.map(p => p.country?.alpha2?.toLowerCase()).filter(Boolean);
                    }
                    return [team.country?.alpha2?.toLowerCase() || "mc"];
                };

                homeLogos = getCodes(ev.homeTeam).map(c => `${TENNIS_LOGO_BASE}${c}.png`);
                awayLogos = getCodes(ev.awayTeam).map(c => `${TENNIS_LOGO_BASE}${c}.png`);
            } else {
                // Eğer detay çekilemezse yedek olarak ana listedeki verileri kullan
                homeLogos = [e.homeTeam?.country?.alpha2 ? `${TENNIS_LOGO_BASE}${e.homeTeam.country.alpha2.toLowerCase()}.png` : `${TENNIS_LOGO_BASE}mc.png`];
                awayLogos = [e.awayTeam?.country?.alpha2 ? `${TENNIS_LOGO_BASE}${e.awayTeam.country.alpha2.toLowerCase()}.png` : `${TENNIS_LOGO_BASE}mc.png`];
            }

            const statusType = e.status?.type;
            let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
            
            const hasScore = statusType === 'inprogress' || statusType === 'finished';
            if (statusType === 'inprogress') timeString += "\nCANLI";
            else if (statusType === 'finished') timeString += "\nMS";

            // Set skorlarını çekme
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

            finalMatches.push({
                id: e.id,
                isElite: checkIsEliteMatch(tourName),
                status: statusType,
                fixedDate: fixedDate,
                fixedTime: timeString,
                timestamp: startTimestamp,
                broadcaster: "S Sport / beIN Sports",
                homeTeam: { 
                    name: e.homeTeam.name || "Belli Değil", 
                    ranking: hRank,
                    logos: homeLogos
                },
                awayTeam: { 
                    name: e.awayTeam.name || "Belli Değil", 
                    ranking: aRank, 
                    logos: awayLogos 
                },
                tournamentLogo: TENNIS_TOURNAMENT_BASE + (e.tournament?.uniqueTournament?.id || e.tournament?.category?.id) + ".png",
                homeScore: !hasScore ? "-" : String(e.homeScore?.display ?? "0"),
                awayScore: !hasScore ? "-" : String(e.awayScore?.display ?? "0"),
                setScores: sets,
                tournament: tourName
            });
            
            tournamentCount[tourName] = (tournamentCount[tourName] || 0) + 1;
            
            // İlerleme göster
            const progress = Math.round((idx / rawEvents.length) * 100);
            process.stdout.write(`\r  ⏳ İşleniyor... %${progress} (${idx}/${rawEvents.length})`);
            
        } catch (error) {
            console.error(`\n⚠️ Maç ${e.id} işlenirken hata:`, error.message);
            continue;
        }
    }

    finalMatches.sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync(TARGET_FILES.tennis, JSON.stringify({ success: true, matches: finalMatches }, null, 2));
    
    console.log(`\n  ✅ Toplam ${finalMatches.length} tenis maçı kaydedildi`);
    console.log(`  📊 Turnuvalar: ${Object.keys(tournamentCount).length}`);
    
    // Debug: Sıralama istatistikleri
    const withRanking = finalMatches.filter(m => m.homeTeam.ranking || m.awayTeam.ranking).length;
    console.log(`  🏆 Sıralama verisi olan maçlar: ${withRanking}/${finalMatches.length}`);
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
        if (!response) {
            console.log(`   ⚠️ F1 verisi alınamadı`);
            return;
        }

        const races = response.MRData?.RaceTable?.Races || [];
        const finalEvents = [];
        
        // Ülke isimlerini 2 haneli dosya adlarına çeviren mapping
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

        fs.writeFileSync(TARGET_FILES.f1, JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), totalSessions: finalEvents.length, events: finalEvents }, null, 2));
        
        // Detaylı log
        const raceCount = new Set(finalEvents.map(e => e.grandPrix)).size;
        console.log(`  ✅ Toplam ${finalEvents.length} F1 seanı (${raceCount} Grand Prix)`);
        
        // Her yarış için kaç seans olduğunu göster
        const sessionsByRace = {};
        finalEvents.forEach(e => {
            if (!sessionsByRace[e.grandPrix]) sessionsByRace[e.grandPrix] = 0;
            sessionsByRace[e.grandPrix]++;
        });
        
        Object.keys(sessionsByRace).slice(0, 3).forEach(race => {
            console.log(`      • ${race}: ${sessionsByRace[race]} seans`);
        });
        
    } catch (error) {
        console.error(`   ⚠️ F1 hatası: ${error.message}`);
    }
}

// =========================================================================
// 🔄 ANA DÖNGÜ (OPTİMİZE EDİLMİŞ)
// =========================================================================
async function main() {
    console.log("============================================================");
    console.log("🟢 J7 CANLI SUNUCU BAŞLADI (AKILLI ZAMANLAYICI)");
    console.log("============================================================");
    
    await initGitConfig();
    
    let iteration = 1;
    // DEĞİŞTİ: Artık updateFootball'dan obje döneceği için bunu objeye çevirdik
    let footballStatus = { hasLiveMatch: false, nextMatchTimestamp: null };
    
    // İlk açılışta tüm spor dallarını anında güncellemesi için sayacı dolu başlatıyoruz
    let timeSinceLastFullUpdate = FULL_UPDATE_INTERVAL_MS; 

    while (true) {
        try {
            console.log(`\n[İterasyon ${iteration}] ${new Date().toLocaleTimeString('tr-TR')}`);
            let updatedSomething = false;
            
            // EKLENDİ: Şu anki saat, sıradaki maçın saatine geldi mi? (1 dakika tolerans payı)
            const now = Date.now();
            const isMatchTime = footballStatus.nextMatchTimestamp && (now >= (footballStatus.nextMatchTimestamp - 60000));
            
            if (timeSinceLastFullUpdate >= FULL_UPDATE_INTERVAL_MS) {
                // 20 DAKİKA DOLDU -> TÜM SPOR DALLARINI GÜNCELLE
                console.log("🔄 20 Dakikalık Tam Güncelleme Döngüsü Çalışıyor...");
                
                footballStatus = await updateFootball(); // DEĞİŞTİ: Obje olarak güncelledik
                await updateBasketball();
                await updateTennis();
                await updateF1();
                
                timeSinceLastFullUpdate = 0; // Sayacı sıfırla
                updatedSomething = true;
            } else if (footballStatus.hasLiveMatch || isMatchTime) { // DEĞİŞTİ: Maç saati geldiyse de buraya gir
                // 20 DAKİKA DOLMADI AMA CANLI MAÇ VAR VEYA MAÇ SAATİ GELDİ
                if (isMatchTime && !footballStatus.hasLiveMatch) {
                    console.log("⏰ Yeni maç saati geldi! Sadece futbol 1 dakikalık döngüde güncelleniyor...");
                } else {
                    console.log("⚽ Canlı maç var! Sadece futbol 1 dakikalık döngüde güncelleniyor...");
                }
                
                footballStatus = await updateFootball(); // DEĞİŞTİ: Obje olarak güncelledik
                updatedSomething = true;
            } else {
                // CANLI MAÇ YOK VE 20 DAKİKA DOLMADI -> BEKLE
                const minutesLeft = Math.round((FULL_UPDATE_INTERVAL_MS - timeSinceLastFullUpdate) / 60000);
                
                // EKLENDİ: Ekranda ilk maça ne kadar kaldığını da görebilmen için küçük bir detay
                if (footballStatus.nextMatchTimestamp && (footballStatus.nextMatchTimestamp - now) < (FULL_UPDATE_INTERVAL_MS - timeSinceLastFullUpdate)) {
                    const matchMins = Math.round((footballStatus.nextMatchTimestamp - now) / 60000);
                    console.log(`💤 Canlı maç yok. Tam güncellemeye ${minutesLeft} dk, ilk maça ${matchMins} dk kaldı.`);
                } else {
                    console.log(`💤 Canlı maç yok. Tam güncellemeye yaklaşık ${minutesLeft} dakika kaldı.`);
                }
            }

            // Eğer herhangi bir JSON değiştiyse/güncellendiyse GitHub'a yolla
            if (updatedSomething) {
                await pushToGithub();
            }
            
        } catch (e) { 
            console.error("🚨 Hata:", e.message); 
        }
        
        console.log(`⏳ ${MINUTE_MS / 1000} saniye bekleniyor...\n`);
        
        // Her halükarda 1 dakika uyu, uyandıktan sonra süreyi sayaca ekle
        await new Promise(r => setTimeout(r, MINUTE_MS));
        timeSinceLastFullUpdate += MINUTE_MS;
        iteration++;
    }
}


main(); 
