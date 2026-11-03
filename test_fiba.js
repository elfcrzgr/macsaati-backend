const util = require('util');
const { execFile } = require('child_process');
const execFileAsync = util.promisify(execFile);

async function testAiScore() {
    // AiScore tarih formatı: YYYYMMDD
    const dateObj = new Date();
    const dateStr = dateObj.getFullYear().toString() +
                    (dateObj.getMonth() + 1).toString().padStart(2, '0') +
                    dateObj.getDate().toString().padStart(2, '0');

    // AiScore basketbol uç noktası (Versiyon 1)
    const url = `https://api.aiscore.com/v1/basketball/match/list?date=${dateStr}`;

    console.log(`\n============================================================`);
    console.log(`🚀 AiScore SSL-Bypass ile Deneniyor...`);
    console.log(`URL: ${url}`);
    
    try {
        // -k (--insecure) parametresi SSL/Sertifika hatalarını yok sayar!
        const { stdout } = await execFileAsync('curl', [
            '-s', '-k', '--max-time', '15',
            url,
            '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        ]);

        try {
            const json = JSON.parse(stdout);
            console.log(`✅ [BAŞARILI] JSON formatı alındı!`);
            
            // AiScore verisi genelde json.data veya json.match içinde döner
            let matches = [];
            if (json.data && Array.isArray(json.data.match)) matches = json.data.match;
            else if (json.data && Array.isArray(json.data)) matches = json.data;
            else matches = json;

            if (Array.isArray(matches) && matches.length > 0) {
                console.log(`Toplam ${matches.length} maç bulundu.`);
                console.log(`\n📋 İlk maç örneği:`);
                console.log(JSON.stringify(matches[0], null, 2));
            } else {
                console.log(`⚠️ JSON geldi ama maç listesi boş veya farklı bir yapıda.`);
                console.log("Gelen yapının üst anahtarları:", Object.keys(json));
            }
        } catch (e) {
            console.log(`❌ JSON Parse Hatası. HTML veya farklı bir hata mesajı dönmüş olabilir.`);
            console.log(`Dönen metnin ilk 500 karakteri:\n`, stdout.substring(0, 500));
        }
    } catch (e) {
        console.log(`❌ CURL İstek hatası: ${e.message}`);
    }
    
    console.log(`\n🛑 Test bitti. Lütfen terminal çıktısını paylaş.`);
}

testAiScore();
