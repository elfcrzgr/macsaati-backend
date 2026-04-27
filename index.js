const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

puppeteer.use(StealthPlugin());

// =========================================================================
// ⚙️ GLOBAL AYARLAR
// =========================================================================
const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

const getTRDate = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
};

// 📊 ÖZET RAPORU
let globalSummary = {};
function addToSummary(sport, leagueName) {
    if (!globalSummary[sport]) globalSummary[sport] = {};
    globalSummary[sport][leagueName || "Bilinmeyen"] = (globalSummary[sport][leagueName || "Bilinmeyen"] || 0) + 1;
}

// =========================================================================
// ⚽ FUTBOL FİLTRELERİ
// =========================================================================
const ELITE_FOOT_IDS = [52, 351, 98, 17, 8, 23, 35, 11, 34, 37, 13, 238, 242, 938, 393, 7, 750, 10248, 10783, 1, 679, 17015, 19, 18];
const REGULAR_FOOT_IDS = [10, 155, 4664, 696, 97, 11415, 11416, 11417, 15938, 13363, 10618];
const ALL_FOOT_TARGETS = [...ELITE_FOOT_IDS, ...REGULAR_FOOT_IDS];

// =========================================================================
// 🚀 GÖREV MOTORLARI (iMac İçin Optimize Edildi)
// =========================================================================

async function runFootball(page) {
    console.log("⚽ Futbol taranıyor...");
    let allEvents = [];
    const dates = [getTRDate(0), getTRDate(1)];

    for (const date of dates) {
        try {
            const data = await page.evaluate(async (d) => {
                const response = await fetch(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${d}`);
                return response.ok ? await response.json() : null;
            }, date);

            if (data?.events) {
                const filtered = data.events.filter(e => {
                    const ut = e.tournament?.uniqueTournament;
                    // Filtreyi esnettik: Ya senin listende olacak ya da priority yüksek olacak
                    return ut && (ALL_FOOT_TARGETS.includes(ut.id) || ut.priority > 50);
                });
                allEvents.push(...filtered);
            }
        } catch (e) { console.error(`❌ Futbol Hatası (${date}):`, e.message); }
    }

    const matches = allEvents.map(e => ({
        id: e.id,
        isElite: ELITE_FOOT_IDS.includes(e.tournament?.uniqueTournament?.id),
        status: e.status.type,
        liveMinute: e.status.type === 'inprogress' ? (e.status.description || "Canlı") : "",
        fixedTime: new Date(e.startTimestamp * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }),
        timestamp: e.startTimestamp * 1000,
        homeTeam: { name: e.homeTeam.name, logo: `https://api.sofascore.app/api/v1/team/${e.homeTeam.id}/image` },
        awayTeam: { name: e.awayTeam.name, logo: `https://api.sofascore.app/api/v1/team/${e.awayTeam.id}/image` },
        homeScore: String(e.homeScore?.display ?? "-"),
        awayScore: String(e.awayScore?.display ?? "-"),
        tournament: e.tournament.name
    }));

    fs.writeFileSync("matches_football.json", JSON.stringify({ success: true, matches }, null, 2));
    console.log(`   ✅ Futbol: ${matches.length} maç kaydedildi.`);
}

// Basketbol, Tenis ve F1 fonksiyonlarını da benzer sade/güçlü yapıda tutabilirsin.

// =========================================================================
// 🔄 ANA DÖNGÜ VE GİT PUSH
// =========================================================================

async function loop() {
    console.log("🟢 iMac MASTER SUNUCUSU BAŞLATILDI");
    
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    const page = await browser.newPage();
    // Gerçekçi bir iMac tarayıcı kimliği
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

    while (true) {
        const baslangic = Date.now();
        try {
            await runFootball(page);
            // Buraya runBasketball(page), runTennis(page) vb. ekle...

            const simdi = new Date().toLocaleTimeString('tr-TR');
            const gitCmd = `git add . && git commit -m "iMac Güncelleme: ${simdi}" && git push origin main --force`;
            
            exec(gitCmd, (err) => {
                if (err) console.error(`[${simdi}] ❌ GitHub Push Hatası`);
                else console.log(`[${simdi}] 🚀 GitHub Push Başarılı!`);
            });

        } catch (e) {
            console.error("⚠️ Döngü hatası:", e.message);
        }

        // 30 saniye bekle (İşlem süresini hesaba katarak)
        const gecen = Date.now() - baslangic;
        const bekleme = Math.max(30000 - gecen, 5000);
        await new Promise(r => setTimeout(r, bekleme));
    }
}

loop().catch(e => console.error("KRİTİK HATA:", e));