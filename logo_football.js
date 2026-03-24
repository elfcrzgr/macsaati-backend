const TOURNAMENT_LOGOS_DIR = path.join(__dirname, 'football', 'tournament_logos');

// Eksik turnuva logolarını kontrol etmek için klasörü oluşturun
if (!fs.existsSync(TOURNAMENT_LOGOS_DIR)) fs.mkdirSync(TOURNAMENT_LOGOS_DIR, { recursive: true });

// --- TURNURA LOGOLARINI KONTROL VE İNDİRME ---
const missingTournamentLogos = new Map();

json.matches.forEach(m => {
    const tournamentLogoId = m.tournamentLogo.split('/').pop().replace('.png', '');
    const tournamentLogoPath = path.join(TOURNAMENT_LOGOS_DIR, `${tournamentLogoId}.png`);

    // Eksik turnuva logolarını listeleyin
    if (!fs.existsSync(tournamentLogoPath)) {
        missingTournamentLogos.set(tournamentLogoId, {
            name: m.tournament,
            logoUrl: m.tournamentLogo
        });
    }
});

// Eğer eksik turnuva logoları varsa, bunları indir
if (missingTournamentLogos.size > 0) {
    console.log(`⚠️ ${missingTournamentLogos.size} adet eksik turnuva logosu bulundu. İndirmeye başlıyorum...\n`);

    for (const [id, tournament] of missingTournamentLogos) {
        const filePath = path.join(TOURNAMENT_LOGOS_DIR, `${id}.png`);
        const url = tournament.logoUrl;

        try {
            const viewSource = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

            if (viewSource && viewSource.status() === 200) {
                const buffer = await viewSource.buffer();
                fs.writeFileSync(filePath, buffer);
                console.log(`✅ İndirildi: Turnuva -> ${tournament.name} (${id}.png)`);
            } else {
                console.error(`❌ İndirilemedi (${tournament.name}): API ${viewSource ? viewSource.status() : 'Bilinmeyen'} döndürdü.`);
            }
        } catch (err) {
            console.error(`❌ Bağlantı Hatası (${tournament.name}):`, err.message);
        }

        // Radar tespitinden kaçınmak için 1 saniye bekle
        await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`\n🏁 Tüm eksik turnuva logoları tamamlandı!\n`);
} else {
    console.log(`🎉 Harika! Tüm turnuva logoları zaten mevcut. İşlem bitti.\n`);
}