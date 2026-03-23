const fs = require('fs');
const https = require('https');
const path = require('path');

const MATCHES_FILE = 'matches_football.json';
const LOGOS_DIR = './football/logos';

// Eğer "football/logos" klasörü yoksa otomatik oluşturur
if (!fs.existsSync(LOGOS_DIR)){
    fs.mkdirSync(LOGOS_DIR, { recursive: true });
}

const downloadLogo = (teamId, teamName) => {
    const filePath = path.join(LOGOS_DIR, `${teamId}.png`);
    
    // Eğer logo zaten varsa indirme (Zaman tasarrufu)
    if (fs.existsSync(filePath)) return; 

    // SofaScore'un gizli logo URL'si
    const url = `https://api.sofascore.com/api/v1/team/${teamId}/image`;
    
    https.get(url, (res) => {
        if (res.statusCode === 200) {
            const file = fs.createWriteStream(filePath);
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                console.log(`✅ İndirildi: ${teamName} (${teamId}.png)`);
            });
        }
    }).on('error', (err) => {
        console.error(`❌ Hata (${teamId}):`, err.message);
    });
};

fs.readFile(MATCHES_FILE, 'utf8', (err, data) => {
    if (err) return console.error("JSON dosyası okunamadı! Önce maçları çeken scripti çalıştır.", err);
    
    const json = JSON.parse(data);
    const teams = new Map(); // Aynı takımı 2 kez indirmemek için

    json.matches.forEach(m => {
        // Logo URL'sinden ID'yi çekip çıkarıyoruz
        const homeId = m.homeTeam.logo.split('/').pop().replace('.png', '');
        const awayId = m.awayTeam.logo.split('/').pop().replace('.png', '');
        
        teams.set(homeId, m.homeTeam.name);
        teams.set(awayId, m.awayTeam.name);
    });

    console.log(`🔍 JSON tarandı. Toplam ${teams.size} takım bulundu. Eksik logolar kontrol ediliyor...`);
    
    teams.forEach((name, id) => {
        downloadLogo(id, name);
    });
});