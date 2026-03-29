const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const OUTPUT_FILE = "matches_football.json";

// --- ÜLKE İSİMLERİ TÜRKÇE ÇEVİRİ SÖZLÜĞÜ ---
const countryTranslations = {
    "Turkey": "Türkiye", "Germany": "Almanya", "France": "Fransa", "Italy": "İtalya",
    "Spain": "İspanya", "England": "İngiltere", "Netherlands": "Hollanda", "Belgium": "Belçika",
    "Portugal": "Portekiz", "Brazil": "Brezilya", "Argentina": "Arjantin", "USA": "ABD"
};

// --- YAYINCI VE GENİŞLETİLMİŞ LİG SÖZLÜĞÜ (NESİNE 2./3. LİG DAHİL) ---
const leagueConfigs = {
    // TÜRKİYE ANA LİGLER
    52: "beIN Sports / TOD", 1: "TRT Spor / beIN Sports", 935: "A Spor / ATV", 1480: "ATV / beIN Sports",
    
    // NESİNE 2. LİG VE 3. LİG (Teyitli Yayıncılar)
    11843: "Nesine TV / TFF YouTube (2. Lig Beyaz)",
    11844: "Nesine TV / TFF YouTube (2. Lig Kırmızı)",
    11845: "Nesine TV / TFF YouTube (3. Lig 1. Grup)",
    11846: "Nesine TV / TFF YouTube (3. Lig 2. Grup)",
    11847: "Nesine TV / TFF YouTube (3. Lig 3. Grup)",
    11848: "Nesine TV / TFF YouTube (3. Lig 4. Grup)",

    // GENÇLİK LİGLERİ
    937: "A Spor / TRT Spor (U21)", 938: "A Spor / TRT Spor (U19)",
    11357: "A Spor (U19 Elit A)", 11358: "A Spor (U19 Elit B)",
    
    // AVRUPA KUPALARI (TRT DÖNEMİ)
    1465: "TRT 1 / Tabii (Şampiyonlar Ligi)", 1470: "TRT Spor / Tabii (Avrupa Ligi)", 1030: "TRT Spor / Tabii (Konferans Ligi)",
    
    // AVRUPA DEVLERİ
    17: "beIN Sports (EPL)", 8: "S Sport (LaLiga)", 23: "S Sport / Tivibu (Serie A)", 
    35: "S Sport / Tivibu (Bundesliga)", 34: "beIN Sports (Ligue 1)",
    
    // MİLLİ TAKIMLAR
    10: "TRT 1 (Dünya Kupası)", 1475: "TRT 1 (Euro Elemeleri)", 466: "TRT Spor (Uluslar Ligi)"
};

// Bu ülkelerden gelen her maçı (alt ligler dahil) kabul ediyoruz
const popularCountries = ["Turkey", "England", "Spain", "Germany", "Italy", "France"];

const targetLeagueIds = Object.keys(leagueConfigs).map(Number);

function translateName(name) {
    if (!name) return "";
    let translated = name;
    for (const [eng, tr] of Object.entries(countryTranslations)) {
        if (name.includes(eng)) { translated = name.replace(eng, tr); break; }
    }
    return translated;
}

async function start() {
    console.log("🚀 Mac Saati: Nesine 2. ve 3. Lig Filtresi Aktif Edildi...");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'stylesheet', 'font'].includes(req.resourceType())) req.abort();
        else req.continue();
    });

    const getTRDate = (offset = 0) => {
        const d = new Date(); d.setHours(d.getHours() + 3);
        d.setDate(d.getDate() + offset);
        return d.toISOString().split('T')[0];
    };

    let rawEvents = [];
    // Dün, Bugün ve Yarın'ı tarıyoruz (Eski maçların skorlarını korumak için)
    for (const date of [getTRDate(-1), getTRDate(0), getTRDate(1)]) {
        try {
            console.log(`⏳ ${date} takvimi taranıyor (Alt ligler dahil)...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            if (data?.events) {
                const filtered = data.events.filter(e => {
                    const tId = e.tournament?.uniqueTournament?.id || e.tournament?.category?.id;
                    const country = e.tournament?.category?.name;
                    return targetLeagueIds.includes(tId) || popularCountries.includes(country);
                });
                rawEvents.push(...filtered);
            }
        } catch (e) { console.error(`❌ ${date} hatası.`); }
    }

    const uniqueEventsMap = new Map();
    rawEvents.forEach(e => uniqueEventsMap.set(e.id, e));

    const finalMatches = Array.from(uniqueEventsMap.values()).map(e => {
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        const isFinished = e.status?.type === 'finished';
        const tId = e.tournament?.uniqueTournament?.id || e.tournament?.category?.id || 0;

        return {
            id: e.id,
            fixedDate: dayStr,
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
            timestamp: dateTR.getTime(),
            tournament: translateName(e.tournament.name),
            tournamentLogo: `https://api.sofascore.com/api/v1/unique-tournament/${tId}/image`,
            broadcaster: leagueConfigs[tId] || "Yerel Yayıncı / Web",
            matchStatus: { type: e.status?.type || "notstarted", description: e.status?.description || "-" },
            homeTeam: { name: translateName(e.homeTeam.name), logo: `https://api.sofascore.com/api/v1/team/${e.homeTeam.id}/image` },
            awayTeam: { name: translateName(e.awayTeam.name), logo: `https://api.sofascore.com/api/v1/team/${e.awayTeam.id}/image` },
            // Skor Koruması: Sadece biten maçların skorunu göster
            homeScore: isFinished ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: isFinished ? String(e.awayScore?.display ?? "0") : "-"
        };
    });

    finalMatches.sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
        success: true, lastUpdated: new Date().toISOString(), 
        totalMatches: finalMatches.length, matches: finalMatches 
    }, null, 2));

    console.log(`\n✅ İşlem Tamam: ${finalMatches.length} maç (2. ve 3. Lig dahil) kaydedildi.`);
    await browser.close();
}

start();