const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// =========================================================================
// ⚙️ GLOBAL AYARLAR (Timezone Jilet Gibi Yapıldı)
// =========================================================================
const GITHUB_USER = "elfcrzgr";
const REPO_NAME = "macsaati-backend";

// 🚀 TÜRKİYE SAATİNE GÖRE YYYY-MM-DD DÖNDÜREN GÜVENLİ FONKSİYON
const getTRDate = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    // TR saatiyle (Europe/Istanbul) YYYY-MM-DD formatı
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
};

const validDates = [getTRDate(0), getTRDate(1), getTRDate(2)];

const globalSummary = {};
function addToSummary(sport, leagueName) {
    if (!globalSummary[sport]) globalSummary[sport] = {};
    globalSummary[sport][leagueName] = (globalSummary[sport][leagueName] || 0) + 1;
}

function printSportSummary(sport) {
    console.log(`\n📊 ${sport.toUpperCase()} ÖZET RAPORU`);
    let total = 0;
    const sorted = Object.entries(globalSummary[sport] || {}).sort((a, b) => b[1] - a[1]);
    sorted.forEach(([l, c]) => { console.log(`📍 ${l}: ${c} maç`); total += c; });
    console.log(`✅ Toplam ${total} maç kaydedildi.\n`);
}

// =========================================================================
// ⚽ FUTBOL AYARLARI
// =========================================================================
const FOOT_TEAM_LOGO = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/`;
const FOOT_TOUR_LOGO = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/`;

const teamTranslations = { "turkey": "Türkiye", "germany": "Almanya", "france": "Fransa", "england": "İngiltere", "spain": "İspanya", "usa": "ABD", "japan": "Japonya" };
const translateTeam = (n) => {
    if (!n) return n;
    let tn = n; const cs = n.replace(/[^a-zA-Z]/g, '').toLowerCase();
    for (const [e, t] of Object.entries(teamTranslations)) {
        if (cs.includes(e)) { tn = n.replace(new RegExp(e, 'i'), t); return cs === e ? t : tn; }
    }
    return n;
};

const ELITE_FOOT = [52, 351, 98, 17, 8, 23, 35, 11, 34, 37, 13, 238, 242, 938, 393, 7, 750, 10248, 10783, 1, 679, 17015];
const REGULAR_FOOT = [10, 155, 4664, 696, 97, 11415, 11416, 11417, 15938, 13363, 10618];
const ALL_FOOT_IDS = [...ELITE_FOOT, ...REGULAR_FOOT];

// =========================================================================
// 🏀 BASKETBOL AYARLARI (Full Liste & NBA Fix)
// =========================================================================
const BASK_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/`;
// 🚀 137 yerine 519 ekledik, böylece Süper Lig 'Elit' statüsünü korur
const ELITE_BASK_IDS = [3547, 138, 142, 519, 132, 167, 168];
const baskConfigs = {
    519: "TRT Spor / Tabii",         // 🇹🇷 Türkiye Basketbol Süper Ligi (Yeni ID)
    3547: "S Sport / NBA TV",        // NBA
    138: "S Sport Plus",             // Euroleague
    142: "S Sport Plus",             // Eurocup
    168: "TRT Spor Yıldız",          // 🇹🇷 TBL (Türkiye Basketbol 1. Ligi)
    167: "S Sport Plus / FIBA TV",   // Şampiyonlar Ligi
    132: "beIN Sports 5",            // Fransa LNB
    227: "beIN Sports",              // Almanya BBL
    164: "beIN Sports",              // İspanya ACB
    235: "S Sport Plus",             // Adriyatik ABA
    304: "S Sport Plus",             // Yunanistan GBL
    405: "beIN Sports"               // VTB United
};
const targetBaskIds = Object.keys(baskConfigs).map(Number);

// =========================================================================
// 🎾 TENİS AYARLARI
// =========================================================================
const TENNIS_LOGO = `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/logos/`;
const TENNIS_TOUR = `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/tournament_logos/`;

// =========================================================================
// 🚀 ANA MOTOR
// =========================================================================
async function start() {
    console.log("🚀 MAÇ SAATİ AKILLI MOTOR (TR 00:01 Fix Aktif)...");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    try {
        console.log("🛡️ Güvenlik duvarı aşılıyor...");
        await page.goto('https://www.sofascore.com', { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 6000));

        await runFootball(page);
        await runBasketball(page);
        await runTennis(page);
        await runF1();

    } catch (e) { console.error("Kritik Hata:", e.message); }
    finally { await browser.close(); console.log("✅ İşlem Bitti."); }
}

async function runFootball(page) {
    console.log("⚽ Futbol taranıyor...");
    let events = [];
    for (const d of validDates) {
        const data = await page.evaluate(async (dt) => {
            const res = await fetch(`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${dt}`);
            return res.ok ? await res.json() : null;
        }, d);
        if (data?.events) events.push(...data.events);
    }

    const matches = events.map(e => {
        const ut = e.tournament?.uniqueTournament;
        if (!ut) return null;

        const dt = new Date(e.startTimestamp * 1000);
        // 🚀 TR SAATİNE GÖRE GÜNÜ BELİRLE
        const dayTR = dt.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        if (!validDates.includes(dayTR)) return null;

        const utName = ut.name || "";
        if (utName.toLowerCase().match(/u19|u21|women/)) return null;

        const isTarget = ALL_FOOT_IDS.includes(ut.id);
        const isImportant = ut.hasEventPlayerStatistics && ut.priority < 100;
        if (!isTarget && !isImportant) return null;

        addToSummary("football", utName);
        return {
            id: e.id, isElite: ELITE_FOOT.includes(ut.id), status: e.status?.type,
            matchStatus: { type: e.status?.type },
            fixedDate: dayTR,
            fixedTime: dt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }),
            timestamp: e.startTimestamp * 1000,
            homeTeam: { name: translateTeam(e.homeTeam.name), logo: FOOT_TEAM_LOGO + e.homeTeam.id + ".png" },
            awayTeam: { name: translateTeam(e.awayTeam.name), logo: FOOT_TEAM_LOGO + e.awayTeam.id + ".png" },
            tournamentLogo: FOOT_TOUR_LOGO + ut.id + ".png",
            homeScore: String(e.homeScore?.display ?? "-"), awayScore: String(e.awayScore?.display ?? "-"), tournament: utName
        };
    }).filter(Boolean);

    fs.writeFileSync("matches_football.json", JSON.stringify({ success: true, matches }, null, 2));
    printSportSummary("football");
}

async function runBasketball(page) {
    console.log("🏀 Basketbol taranıyor...");
    const trToday = getTRDate(0);
    const trTomorrow = getTRDate(1);
    let events = [];
    
    // TR saatiyle Dün, Bugün ve Yarın'ı tara
    for (const d of [getTRDate(-1), trToday, trTomorrow]) {
        const data = await page.evaluate(async (dt) => {
            const res = await fetch(`https://www.sofascore.com/api/v1/sport/basketball/scheduled-events/${dt}`);
            return res.ok ? await res.json() : null;
        }, d);
        if (data?.events) events.push(...data.events);
    }

    const matches = events.map(e => {
        const ut = e.tournament?.uniqueTournament;
        if (!ut || !targetBaskIds.includes(ut.id)) return null;

        const dt = new Date(e.startTimestamp * 1000);
        // 🚀 TR SAATİNE GÖRE GÜNÜ BELİRLE (02:00 maçı artık 24 Nisan görünecek)
        const dayTR = dt.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        
        // Sadece Bugün ve Yarın'ın maçlarını al
        if (dayTR !== trToday && dayTR !== trTomorrow) return null;

        const isNBA = (ut.id === 3547 || ut.name.toUpperCase().includes("NBA"));
        addToSummary("basketball", isNBA ? "NBA" : ut.name);

        return {
            id: e.id, isElite: ELITE_BASK_IDS.includes(ut.id), status: e.status?.type,
            matchStatus: { type: e.status?.type },
            fixedDate: dayTR,
            fixedTime: dt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }),
            timestamp: dt.getTime(),
            homeTeam: { name: e.homeTeam.name, logo: BASK_BASE + "logos/" + (isNBA ? "NBA/" : "") + e.homeTeam.id + ".png" },
            awayTeam: { name: e.awayTeam.name, logo: BASK_BASE + "logos/" + (isNBA ? "NBA/" : "") + e.awayTeam.id + ".png" },
            tournamentLogo: BASK_BASE + "tournament_logos/" + (isNBA ? "NBA/3547" : ut.id) + ".png",
            homeScore: String(e.homeScore?.display ?? "-"), awayScore: String(e.awayScore?.display ?? "-"), tournament: isNBA ? "NBA" : ut.name
        };
    }).filter(Boolean);

    fs.writeFileSync("matches_basketball.json", JSON.stringify({ success: true, matches }, null, 2));
    printSportSummary("basketball");
}

async function runTennis(page) {
    console.log("🎾 Tenis taranıyor...");
    let raw = [];
    for (const d of validDates) {
        const data = await page.evaluate(async (dt) => {
            const res = await fetch(`https://www.sofascore.com/api/v1/sport/tennis/scheduled-events/${dt}`);
            return res.ok ? await res.json() : null;
        }, d);
        if (data?.events) raw.push(...data.events);
    }

    const matches = [];
    for (const e of raw) {
        if (!e.tournament || e.tournament.name.toUpperCase().match(/ITF|CHALLENGER|UTR/)) continue;
        const dt = new Date(e.startTimestamp * 1000);
        const dayTR = dt.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        if (!validDates.includes(dayTR)) continue;

        addToSummary("tennis", e.tournament.name);
        const rank = await page.evaluate(async (id) => {
            try {
                const res = await fetch(`https://www.sofascore.com/api/v1/event/${id}`);
                const ev = await res.json();
                return { h: ev.event.homeTeam.ranking, a: ev.event.awayTeam.ranking };
            } catch { return null; }
        }, e.id);

        matches.push({
            id: e.id, status: e.status?.type, matchStatus: { type: e.status?.type },
            fixedDate: dayTR, fixedTime: dt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }),
            timestamp: dt.getTime(), homeTeam: { name: e.homeTeam.name, logos: [TENNIS_LOGO + "mc.png"] },
            awayTeam: { name: e.awayTeam.name, logos: [TENNIS_LOGO + "mc.png"] },
            homeRank: rank?.h ? String(rank.h) : null, awayRank: rank?.a ? String(rank.a) : null,
            tournamentLogo: TENNIS_TOUR + (e.tournament?.uniqueTournament?.id || 0) + ".png",
            homeScore: String(e.homeScore?.display ?? "-"), awayScore: String(e.awayScore?.display ?? "-"), tournament: e.tournament.name
        });
    }
    fs.writeFileSync("matches_tennis.json", JSON.stringify({ success: true, matches }, null, 2));
    printSportSummary("tennis");
}

async function runF1() {
    console.log("🏎️ F1 taranıyor...");
    try {
        const res = await fetch('https://api.jolpi.ca/ergast/f1/current.json');
        const data = await res.json();
        const races = data.MRData.RaceTable.Races;
        const events = races.map(r => ({
            id: r.round, grandPrix: r.raceName, timestamp: new Date(`${r.date}T${r.time}`).getTime(),
            fixedDate: r.date, fixedTime: r.time
        }));
        fs.writeFileSync("matches_f1.json", JSON.stringify({ success: true, events }, null, 2));
        console.log("✅ F1 kaydedildi.");
    } catch(e) { console.log("F1 Hatası"); }
}

start();