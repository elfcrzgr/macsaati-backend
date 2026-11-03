const util = require('util');
const { execFile } = require('child_process');
const execFileAsync = util.promisify(execFile);

async function exploreFibaWithCurl() {
    const dateTR = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    
    // En muhtemel FIBA JSON API uç noktaları
    const endpoints = [
        `https://www.championsleague.basketball/api/games?date=${dateTR}`,
        `https://api.fiba.basketball/api/games?date=${dateTR}`,
        `https://bbis.basketball/v1/games?date=${dateTR}`
    ];

    for (const url of endpoints) {
        console.log(`\n============================================================`);
        console.log(`🚀 CURL ile Deneniyor: ${url}`);
        
        try {
            const { stdout } = await execFileAsync('curl', [
                '-s',
                '--max-time', '10',
                url,
                '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                '-H', 'Accept: application/json'
            ]);

            try {
                const json = JSON.parse(stdout);
                console.log("✅ JSON BAŞARIYLA ÇEKİLDİ!");
                
                // İlk elemanı bulup ekrana basalım
                const dataArray = Array.isArray(json) ? json : (json.data || json.matches || Object.values(json)[0]);
                if (Array.isArray(dataArray) && dataArray.length > 0) {
                    console.log(`Toplam ${dataArray.length} maç bulundu. İlk maç:`);
                    console.log(JSON.stringify(dataArray[0], null, 2));
                    console.log(`\n🏆 KULLANILACAK API: ${url}`);
                    return; // Başarılı olursak döngüyü bitir
                } else {
                    console.log("JSON geldi ama bugün için maç listesi boş.");
                }
            } catch (e) {
                console.log("⚠️ Yine HTML döndü, JSON parse edilemedi.");
            }
        } catch (err) {
            console.error("❌ CURL İstek hatası:", err.message);
        }
    }
    console.log("\n🛑 Tüm CURL denemeleri bitti. Çıktıyı benimle paylaşır mısın?");
}

exploreFibaWithCurl();
