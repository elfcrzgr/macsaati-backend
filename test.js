async function testSofascore() {
    // Senin yakaladığın spesifik lig (7: Şampiyonlar Ligi) ve tarih
    const url = "https://www.sofascore.com/api/v1/unique-tournament/7/scheduled-events/2026-07-08";
    
    console.log(`📡 İstek atılıyor: ${url}\n`);
    
    try {
        const response = await fetch(url, {
            headers: {
                // Standart bir mobil cihaz gibi görünüyoruz
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1",
                "Accept": "*/*",
                "Accept-Language": "tr-TR,tr;q=0.9",
                "Referer": "https://www.sofascore.com/football/2026-07-08",
                
                // 🔑 İŞTE KAPIYI AÇAN O GİZLİ ANAHTAR!
                "X-Requested-With": "93a9a4",
                "Cache-Control": "max-age=0"
            }
        });

        console.log(`🔄 HTTP Durum Kodu: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            console.log("❌ SORGUDAN RED GELDİ! (Muhtemelen hash kodu günlük değişiyor)");
        } else {
            console.log("✅ BİNGO! BAĞLANTI BAŞARILI!");
            const data = await response.json();
            console.log(`📊 Gelen Veri Başarıyla Okundu. Toplam ${data.events ? data.events.length : 0} maç var.`);
        }
    } catch (error) {
        console.error("🚨 Ağ veya Fetch Hatası:", error.message);
    }
}

testSofascore();
