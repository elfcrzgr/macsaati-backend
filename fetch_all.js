const fs = require('fs');

// Node 18 altıysa aç:
// const fetch = require('node-fetch');

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// =========================================================================
// 📅 TARİH
// =========================================================================
const getTRDate = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
};

const trToday = getTRDate(0);
const trTomorrow = getTRDate(1);
const validDates = [trToday, trTomorrow];

// =========================================================================
// 🌐 FETCH
// =========================================================================
async function fetchWithHeaders(url) {
    try {
        const res = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                "Accept": "application/json, text/plain, */*",
                "Referer": "https://www.sofascore.com/",
                "Origin": "https://www.sofascore.com"
            }
        });

        console.log(`🌐 ${url} → status: ${res.status}`);

        if (!res.ok) return null;

        return await res.json();
    } catch (e) {
        console.log(`❌ FETCH HATA: ${url}`);
        return null;
    }
}

// =========================================================================
// ⚽ FUTBOL
// =========================================================================
async function runFootball() {
    console.log("\n⚽ FUTBOL BAŞLADI");

    const duplicate = new Set();
    let allRaw = [];

    for (const d of [getTRDate(-1), trToday, trTomorrow]) {
        const data = await fetchWithHeaders(`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${d}`);

        console.log(`📥 ${d} için gelen maç: ${data?.events?.length || 0}`);

        if (data?.events) allRaw.push(...data.events);

        await delay(800);
    }

    const matches = allRaw.map(e => {
        if (duplicate.has(e.id)) return null;

        const ts = e.startTimestamp * 1000;
        const dt = new Date(ts);
        const dayTR = dt.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });

        if (!validDates.includes(dayTR)) return null;

        duplicate.add(e.id);

        return {
            id: e.id,
            tournament: e.tournament?.name,
            date: dayTR,
            time: dt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            home: e.homeTeam.name,
            away: e.awayTeam.name
        };
    }).filter(Boolean);

    console.log(`⚽ Toplam RAW: ${allRaw.length}`);
    console.log(`✅ Filtre sonrası: ${matches.length}`);

    fs.writeFileSync("matches_football.json", JSON.stringify(matches, null, 2));
}

// =========================================================================
// 🏀 BASKET
// =========================================================================
async function runBasketball() {
    console.log("\n🏀 BASKET BAŞLADI");

    let allRaw = [];

    for (const d of [getTRDate(-1), trToday, trTomorrow]) {
        const data = await fetchWithHeaders(`https://www.sofascore.com/api/v1/sport/basketball/scheduled-events/${d}`);

        console.log(`📥 ${d} basket maç: ${data?.events?.length || 0}`);

        if (data?.events) allRaw.push(...data.events);

        await delay(800);
    }

    const matches = allRaw.map(e => ({
        id: e.id,
        tournament: e.tournament?.name,
        home: e.homeTeam.name,
        away: e.awayTeam.name
    }));

    console.log(`🏀 Toplam RAW: ${allRaw.length}`);
    console.log(`✅ Filtre sonrası: ${matches.length}`);

    fs.writeFileSync("matches_basketball.json", JSON.stringify(matches, null, 2));
}

// =========================================================================
// 🎾 TENİS
// =========================================================================
async function runTennis() {
    console.log("\n🎾 TENİS BAŞLADI");

    let allRaw = [];

    for (const d of [getTRDate(-1), trToday, trTomorrow]) {
        const data = await fetchWithHeaders(`https://www.sofascore.com/api/v1/sport/tennis/scheduled-events/${d}`);

        console.log(`📥 ${d} tenis maç: ${data?.events?.length || 0}`);

        if (data?.events) allRaw.push(...data.events);

        await delay(800);
    }

    const matches = allRaw.map(e => ({
        id: e.id,
        tournament: e.tournament?.name,
        home: e.homeTeam.name,
        away: e.awayTeam.name
    }));

    console.log(`🎾 Toplam RAW: ${allRaw.length}`);
    console.log(`✅ Filtre sonrası: ${matches.length}`);

    fs.writeFileSync("matches_tennis.json", JSON.stringify(matches, null, 2));
}

// =========================================================================
// 🚀 START
// =========================================================================
async function start() {
    console.log("🚀 FETCH DEBUG BAŞLADI\n");

    // siteyi ısıt
    await fetchWithHeaders("https://www.sofascore.com");
    await delay(1500);

    await runFootball();
    await runBasketball();
    await runTennis();

    // 🔥 TEST DOSYASI (commit test)
    fs.writeFileSync("test.txt", "çalıştı " + Date.now());

    console.log("\n🎉 TAMAMLANDI");
}

start();