// test_fiba.js
async function exploreFIBA() {
    const dateTR = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    
    // FIBA'nın muhtemel resmi API uç noktaları
    const endpoints = [
        `https://www.championsleague.basketball/api/matches?date=${dateTR}`,
        `https://www.championsleague.basketball/api/games?date=${dateTR}`,
        `https://api.fiba.basketball/api/games?date=${dateTR}`,
        `https://bbis.basketball/v1/games?date=${dateTR}`
    ];

    for (const url of endpoints) {
        console.log(`\n============================================================`);
        console.log(`🔍 Deneniyor: ${url}`);
        try {
            const response = await fetch(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15",
                    "Accept": "application/json"
                },
                // Termux/Node.js fetch takılmalarını önlemek için timeout
                signal: AbortSignal.timeout(10000) 
            });
            
            console.log("Durum Kodu:", response.status);
            if (response.status !== 200) {
                console.log("⚠️ Başarısız veya HTML döndü, atlanıyor...");
                continue;
            }

            const text = await response.text();
            
            try {
                const json = JSON.parse(text);
                const isArray = Array.isArray(json);
                console.log("Tip:", isArray ? "Array" : typeof json);

                let sample;
                if (isArray && json.length > 0) {
                    console.log("Toplam maç:", json.length);
                    sample = json[0];
                } else if (json.data && Array.isArray(json.data) && json.data.length > 0) {
                    console.log("json.data bulundu, toplam maç:", json.data.length);
                    sample = json.data[0];
                } else if (json.matches && Array.isArray(json.matches) && json.matches.length > 0) {
                    console.log("json.matches bulundu, toplam maç:", json.matches.length);
                    sample = json.matches[0];
                }

                if (sample) {
                    console.log("\n📋 İlk maç örneği (JSON Yapısı):");
                    console.log(JSON.stringify(sample, null, 2));
                    console.log(`\n✅ BULDUM! Çalışan API bu: ${url}`);
                    return; // Çalışanı bulunca testi bitir
                } else {
                    console.log("⚠️ JSON geldi ama içinde bugün için maç verisi yok.");
                }
                
            } catch (parseErr) {
                console.log("⚠️ JSON ayrıştırılamadı. Muhtemelen HTML/Web sayfası geldi.");
            }
        } catch (e) {
            console.error("❌ İstek hatası:", e.message);
        }
    }
    
    console.log("\n🛑 Bütün uç noktalar denendi. Lütfen terminal çıktısını benimle paylaş.");
}

exploreFIBA();
