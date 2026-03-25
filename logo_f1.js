const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const MATCHES_FILE = path.join(__dirname, 'matches_f1.json');
// Klasör yolunu tam olarak senin belirttiğin yapıya göre ayarladık
const TOURNAMENT_LOGOS_DIR = path.join(__dirname, 'f1', 'tournament_logos');
const LOGOS_DIR = path.join(__dirname, 'f1', 'logos'); // İhtiyaç olursa diye oluşturuyoruz

// Klasörlerin kontrolü ve oluşturulması
if (!fs.existsSync(TOURNAMENT_LOGOS_DIR)) fs.mkdirSync(TOURNAMENT_LOGOS_DIR, { recursive: true });
if (!fs.existsSync(LOGOS_DIR)) fs.mkdirSync(LOGOS_DIR, { recursive: true });

async function start() {
    if (!fs.existsSync(MATCHES_FILE)) {
        return console.error("❌ JSON bulunamadı! Önce fetch_f1.js çalıştırılmalı.");
    }

    const json = JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf8'));
    const tournamentsToProcess = new Map();

    json.events.forEach(e => {
        const tournamentId = e.tournamentLogo.split('/').pop().replace('.png', '');
        if (tournamentId !== "default" && !tournamentsToProcess.has(tournamentId)) {
            tournamentsToProcess.set(tournamentId, { name: e.grandPrix });
        }
    });

    console.log(`\n🔍 F1 JSON Tarandı: Toplam Grand Prix: ${tournamentsToProcess.size}`);

    const missingTournaments = [];
    tournamentsToProcess.forEach((info, id) => {
        const targetPath = path.join(TOURNAMENT_LOGOS_DIR, `${id}.png`);
        if (!fs.existsSync(targetPath)) {
            missingTournaments.push({ id, ...info });
        }
    });

    if (missingTournaments.length === 0) {
        console.log(`\n🎉 Harika! Tüm F1 GP/Pist logoları f1/tournament_logos KLASÖRÜNDE mevcut. İşlem bitti.\n`);
        return;
    }

    console.log(`\n⚠️  ${missingTournaments.length} adet eksik F1 GP logosu indiriliyor...\n`);

    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
    const page = await browser.newPage();
    let successCount = 0;

    for (const t of missingTournaments) {
        const targetPath = path.join(TOURNAMENT_LOGOS_DIR, `${t.id}.png`);
        try {
            const res = await page.goto(`https://api.sofascore.com/api/v1/tournament/${t.id}/image`, { waitUntil: 'networkidle2', timeout: 30000 });
            if (res.status() === 200) {
                fs.writeFileSync(targetPath, await res.buffer());
                console.log(`   ✅ [GP] İndirildi: ${t.name}`);
                successCount++;
            } else {
                console.log(`   ❌ [Hata] ${t.name}: API ${res.status()}`);
            }
        } catch (e) {
            console.log(`   ❌ [Bağlantı Hatası] ${t.name}`);
        }
        await new Promise(r => setTimeout(r, 1000));
    }

    await browser.close();
    console.log(`\n🏁 F1 LOGOLARI BİTTİ:`);
    console.log(`   - Başarıyla Eklenen: ${successCount}`);
    console.log(`   - Toplam Eksik: ${missingTournaments.length}\n`);
}

start();

