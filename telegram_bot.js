// telegram_bot.js
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error("HATA: Bot Token veya Chat ID bulunamadı! start.sh ile çalıştırın.");
  process.exit(1);
}

async function mesajGonder(mesaj) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: mesaj
      })
    });
    
    const data = await response.json();
    if (data.ok) {
      console.log("Mesaj başarıyla Telegram'a gönderildi!");
    } else {
      console.error("Telegram Hatası:", data.description);
    }
  } catch (error) {
    console.error("Bağlantı hatası:", error);
  }
}

// Bot çalışınca bildirim atsın:
mesajGonder("Bot başarıyla çalıştırıldı!");
