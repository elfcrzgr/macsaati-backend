async function checkEuroleagueDates() {
    // E2026 sezonu API adresi
    const url = "https://api-live.euroleague.net/v2/competitions/E/seasons/E2026/games";
    console.log(`🔍 EuroLeague API kontrol ediliyor: ${url}`);
    
    try {
        const response = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
        });
        const games = await response.json();
        console.log(`Toplam çekilen maç sayısı: ${games.length}`);
        
        if (games.length === 0) {
            console.log("⚠️ API bağlandı ama içi BOMBOŞ! Sorun kodda değil, EuroLeague'in kendi API'sinde.");
            return;
        }

        // Kasım (-11-) ayına ait maçları filtreleyelim
        const novGames = games.filter(g => g.utcDate && g.utcDate.includes("-11-"));
        console.log(`Kasım ayına ait toplam maç: ${novGames.length}`);
        
        if (novGames.length > 0) {
            console.log("🗓️ API'deki Kasım ayına ait ilk 5 maçın tarihleri:");
            novGames.slice(0, 5).forEach(g => {
                console.log(`- Maç: ${g.local.club.abbreviatedName} vs ${g.road.club.abbreviatedName} | Tarih: ${g.utcDate}`);
            });
        } else {
            console.log("⚠️ Kasım ayında HİÇ maç bulunamadı. Fikstürde tarih sorunu var. API'deki ilk 3 maç:");
            games.slice(0, 3).forEach(g => {
                console.log(`- Maç: ${g.local.club.abbreviatedName} vs ${g.road.club.abbreviatedName} | Tarih: ${g.utcDate}`);
            });
        }
    } catch(e) {
        console.log("❌ Hata:", e.message);
    }
}

checkEuroleagueDates();
