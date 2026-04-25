const fs = require('fs');

// Node 18 altıysa aç:
// const fetch = require('node-fetch');

// =========================================================================
// ⚙️ GLOBAL AYARLAR
// =========================================================================
const getTRDate = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
};

const trToday = getTRDate(0);
const trTomorrow = getTRDate(1);
const validDates = [trToday, trTomorrow];

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// =========================================================================
// 🌐 FETCH (browser gibi davran)
// =========================================================================
async function fetchWithHeaders(url) {
    const res = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Accept": "application/json, text/plain, */*",
            "Referer": "https://www.sofascore.com/",
            "Origin": "https://www.sofascore.com",
        }
    });
    if (!res.ok) return null;
    return await res.json();
}

// =========================================================================
// ⚽ FUTBOL
// =========================================================================
async function runFootball() {
    console.log("⚽ Futbol...");

    const duplicate = new Set();
    let allRaw = [];

    for (const d of [getTRDate(-1), trToday, trTomorrow]) {
        const data = await fetchWithHeaders(`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${d}`);
        if (data?.events) allRaw.push(...data.events);
        await delay(800); // rate limit koruma
    }

    const matches = allRaw.map(e => {
        if (duplicate.has(e.id)) return null;
        const ut = e.tournament?.uniqueTournament;
        if (!ut) return null;

        const ts = e.startTimestamp * 1000;
        const dt = new Date(ts);
        const dayTR = dt.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });

        if (!validDates.includes(dayTR)) return null;

        duplicate.add(e.id);

        return {
            id: e.id,
            tournament: ut.name,
            date: dayTR,
            time: dt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            home: e.homeTeam.name,
            away: e.awayTeam.name,
            score: `${e.homeScore?.display ?? "-"} - ${e.awayScore?.display ?? "-"}`
        };
    }).filter(Boolean);

    fs.writeFileSync("matches_football.json", JSON.stringify(matches, null, 2));
    console.log("✅ Futbol tamam");
}

// =========================================================================
// 🏀 BASKET
// =========================================================================
async function runBasketball() {
    console.log("🏀 Basket...");

    let allRaw = [];

    for (const d of [getTRDate(-1), trToday, trTomorrow]) {
        const data = await fetchWithHeaders(`https://www.sofascore.com/api/v1/sport/basketball/scheduled-events/${d}`);
        if (data?.events) allRaw.push(...data.events);
        await delay(800);
    }

    const matches = allRaw.map(e => ({
        id: e.id,
        tournament: e.tournament?.name,
        home: e.homeTeam.name,
        away: e.awayTeam.name
    }));

    fs.writeFileSync("matches_basketball.json", JSON.stringify(matches, null, 2));
    console.log("✅ Basket tamam");
}

// =========================================================================
// 🎾 TENİS
// =========================================================================
async function runTennis() {
    console.log("🎾 Tenis...");

    let allRaw = [];

    for (const d of [getTRDate(-1), trToday, trTomorrow]) {
        const data = await fetchWithHeaders(`https://www.sofascore.com/api/v1/sport/tennis/scheduled-events/${d}`);
        if (data?.events) allRaw.push(...data.events);
        await delay(800);
    }

    const matches = allRaw.map(e => ({
        id: e.id,
        tournament: e.tournament?.name,
        home: e.homeTeam.name,
        away: e.awayTeam.name
    }));

    fs.writeFileSync("matches_tennis.json", JSON.stringify(matches, null, 2));
    console.log("✅ Tenis tamam");
}

// =========================================================================
// 🚀 START
// =========================================================================
async function start() {
    console.log("🚀 FETCH MOTOR BAŞLADI");

    // 🔥 önemli: siteyi bir kere “ısıt”
    await fetchWithHeaders("https://www.sofascore.com");
    await delay(1500);

    await runFootball();
    await runBasketball();
    await runTennis();

    console.log("🎉 Bitti");
}

start();