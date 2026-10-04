const xml2js = require('xml2js');

async function fetchFotMobData(dateStr) { 
    try {
        const url = `https://api3.fotmob.com/matches?date=${dateStr}&tz=10800000&tzone=Europe%2FIstanbul`;

        const response = await fetch(url, {
            headers: {
                "Host": "api3.fotmob.com",
                "fotmob-version": "1243.0",
                "Accept": "application/xml, text/xml, */*",
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FotMob",
                "Accept-Language": "tr-TR,tr;q=0.9",
                "Connection": "keep-alive"
            }
        });

        const xmlText = await response.text();

        if (!response.ok) {
            console.log(`⚠ API Reddi (HTTP ${response.status})`);
            return null;
        }

        // XML metnini JavaScript objesine dönüştürüyoruz
        xml2js.parseString(xmlText, { explicitArray: false }, (err, result) => {
            if (err) {
                console.error("❌ XML Çözümleme Hatası:", err.message);
                return;
            }

            console.log("✅ FOTMOB XML VERİSİ BAŞARIYLA ÇÖZÜLDÜ!");
            
            // Gelen verideki ligleri ve maçları güvenli bir şekilde okuyalım
            try {
                const leagues = result.live.exmatches.league;
                console.log(`🏆 Toplam Lig Sayısı: ${Array.isArray(leagues) ? leagues.length : 1}`);
                
                // İlk ligin ilk maçını örnek olarak yazdıralım
                const firstLeague = Array.isArray(leagues) ? leagues[0] : leagues;
                if (firstLeague && firstLeague.match) {
                    const firstMatch = Array.isArray(firstLeague.match) ? firstLeague.match[0] : firstLeague.match;
                    console.log(`⚽ Örnek Maç: ${firstMatch.$.hTeam} vs ${firstMatch.$.aTeam} | Skor: ${firstMatch.$.hScore}-${firstMatch.$.aScore}`);
                }
            } catch (e) {
                console.log("Veri yapısı taranırken detay uyarısı:", e.message);
            }
        });

    } catch (e) {
        console.error("Bağlantı Hatası:", e.message);
    }
}

fetchFotMobData("20261004");
