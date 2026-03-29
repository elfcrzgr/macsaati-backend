const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const OUTPUT_FILE = "matches_football.json";

// --- ÜLKE İSİMLERİ TÜRKÇE ÇEVİRİ SÖZLÜĞÜ ---
const countryTranslations = {
    "Turkey": "Türkiye", "Germany": "Almanya", "France": "Fransa", "Italy": "İtalya",
    "Spain": "İspanya", "England": "İngiltere", "Netherlands": "Hollanda", "Belgium": "Belçika",
    "Portugal": "Portekiz", "Brazil": "Brezilya", "Argentina": "Arjantin", "Croatia": "Hırvatistan",
    "Switzerland": "İsviçre", "Denmark": "Danimarka", "Norway": "Norveç", "Sweden": "İsveç",
    "Poland": "Polonya", "Austria": "Avusturya", "Scotland": "İskoçya", "Wales": "Galler",
    "Ireland": "İrlanda", "Greece": "Yunanistan", "Czechia": "Çekya", "Slovakia": "Slovakya",
    "Hungary": "Macaristan", "Romania": "Romanya", "Bulgaria": "Bulgaristan", "Serbia": "Sırbistan",
    "Slovenia": "Slovenya", "Georgia": "Gürcistan", "Ukraine": "Ukrayna", "Russia": "Rusya",
    "Japan": "Japonya", "South Korea": "Güney Kore", "USA": "ABD", "Canada": "Kanada",
    "Mexico": "Meksika", "Morocco": "Fas", "Senegal": "Senegal"
};

// --- 2026 GÜNCEL YAYINCI VE ELİT LİG SÖZLÜĞÜ ---
const leagueConfigs = {
    // Türkiye
    52: "beIN Sports / TOD", 1: "TRT Spor / beIN Sports", 935: "A Spor / ATV", 1480: "ATV / beIN Sports",
    // Gençlik Ligleri (U19/U21)
    937: "A Spor / TRT Spor (U21)", 938: "A Spor / TRT Spor (U19)",
    11357: "A Spor (U19 Elit A)", 11358: "A Spor (U19 Elit B)", 10642: "A Spor (U21 Hazırlık)",
    // Avrupa Kupaları (TRT Dönemi)
    1465: "TRT 1 / Tabii (Şampiyonlar Ligi)", 1470: "TRT Spor / Tabii (Avrupa Ligi)", 1030: "TRT Spor / Tabii (Konferans Ligi)",
    // Avrupa Ligleri
    17: "beIN Sports / TOD (Premier Lig)", 18: "beIN Sports (Championship)", 701: "TRT / Tabii (FA Cup)",
    8: "S Sport / TV8.5 (LaLiga)", 23: "S Sport / Tivibu (Serie A)", 35: "S Sport / Tivibu (Bundesliga)",
    34: "beIN Sports (Ligue 1)", 37: "S Sport Plus (Eredivisie)", 33: "S Sport Plus (Portekiz)",
    1001: "S Sport / TV8.5 (Suudi)", 13: "D-Smart (Brezilya)", 155: "D-Smart (Arjantin)",
    // Milli Takımlar
    10: "TRT 1 (Dünya Kupası)", 1475: "TRT 1 (Euro Elemeleri)", 466: "TRT Spor (Uluslar Ligi)"
};

const targetLeagueIds = Object.keys(leagueConfigs).map(Number);

// Akıllı Çeviri Fonksiyonu
function translateName(name) {
    if (!name) return "";
    let translated = name;
    for (const [eng, tr] of Object.entries(countryTranslations)) {
        if (name.includes(eng)) {
            translated = name.replace(eng, tr);
            break; 
        }
    }
    return translated;
}

async function start() {
    console.log("⚽ Mac Saati Motoru: Tüm Maçlar + Skor Koruması + TR Çeviri...");
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
    // Dün, Bugün ve Yarın'ı çekerek "Eski" ve "Yeni" tüm maçları kapsıyoruz
    const dates = [getTRDate(-1), getTRDate(0), getTRDate(1)];

    for (const date of dates) {
        try {
            console.log(`⏳ ${date} verileri taranıyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            if (data?.events) {
                const filtered = data.events.filter(e => {
                    const tId = e.tournament?.uniqueTournament?.id || e.tournament?.category?.id;
                    return targetLeagueIds.includes(tId);
                });
                rawEvents.push(...filtered);
            }
        } catch (e) {
            console.error(`❌ ${date} hatası:`, e.message);
        }
    }

    // Tekilleştirme (Aynı maçın iki gün listesinde de çıkmasını engeller)
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
            // Skor sadece maç "finished" (bitti) ise görünür. 
            // Bu sayede gün içindeki eski maçlar skorlu, yeni maçlar skorsuz görünür.
            homeScore: isFinished ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: isFinished ? String(e.awayScore?.display ?? "0") : "-"
        };
    });

    finalMatches.sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
        success: true, lastUpdated: new Date().toISOString(), 
        totalMatches: finalMatches.length, matches: finalMatches 
    }, null, 2));

    console.log(`\n✅ Kaydedildi: ${finalMatches.length} maç (Dün-Bugün-Yarın).`);
    await browser.close();
}

start();