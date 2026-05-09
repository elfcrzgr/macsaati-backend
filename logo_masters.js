const fs = require('fs');
const path = require('path');
const axios = require('axios');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const FIREBASE_BASE_URL =
  'https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app/';

const configs = [
  {
    name: 'Futbol',
    firebaseFile: 'matches_football',
    dirs: {
      team: path.join(__dirname, 'football', 'logos'),
      tournament: path.join(__dirname, 'football', 'tournament_logos')
    }
  },
  {
    name: 'Basketbol',
    firebaseFile: 'matches_basketball',
    dirs: {
      team: path.join(__dirname, 'basketball', 'logos'),
      nba: path.join(__dirname, 'basketball', 'logos', 'NBA'),
      tournament: path.join(__dirname, 'basketball', 'tournament_logos')
    }
  },
  {
    name: 'Tenis',
    firebaseFile: 'matches_tennis',
    dirs: {
      team: path.join(__dirname, 'tennis', 'logos'),
      tournament: path.join(__dirname, 'tennis', 'tournament_logos')
    }
  }
];

configs.forEach(conf => {
  Object.values(conf.dirs).forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

function extractId(url) {
  if (!url || typeof url !== 'string') return null;

  // Yeni format
  let match = url.match(/\/(\d+)\/image/);
  if (match) return match[1];

  // Eski png formatı
  match = url.match(/\/(\d+)\.(png|jpg|jpeg|webp)/i);
  if (match) return match[1];

  // Son fallback
  match = url.match(/(\d+)/);
  if (match) return match[1];

  return null;
}

async function fetchWithRetry(url, options = {}, retry = 3) {
  for (let i = 0; i < retry; i++) {
    try {
      return await axios.get(url, options);

    } catch (e) {
      const status = e.response?.status || 'NO_RESPONSE';

      console.log(`      Retry ${i + 1}/${retry} -> ${status}`);

      if (i === retry - 1) {
        throw e;
      }

      await sleep(2500);
    }
  }
}

async function start() {
  console.log('🚀 Maç Saati Logo Sistemi Başlatıldı...\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });

  const page = await browser.newPage();

  const userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  await page.setUserAgent(userAgent);

  try {
    console.log('🔑 Sofascore session oluşturuluyor...\n');

    await page.goto('https://www.sofascore.com', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    const cookies = await page.cookies();

    const cookieString = cookies
      .map(c => `${c.name}=${c.value}`)
      .join('; ');

    let totalDownloaded = 0;
    let totalDefaulted = 0;
    let totalFailed = 0;

    for (const conf of configs) {

      console.log(`\n📦 ${conf.name} Firebase verisi çekiliyor...`);

      let firebaseData;

      try {
        const firebaseUrl =
          `${FIREBASE_BASE_URL}${conf.firebaseFile}.json`;

        const response = await axios.get(firebaseUrl, {
          timeout: 30000
        });

        firebaseData = response.data;

      } catch (e) {
        console.log(`❌ Firebase okunamadı: ${conf.name}`);
        continue;
      }

      if (!firebaseData) {
        console.log(`⚠️ Veri boş: ${conf.name}`);
        continue;
      }

      const matches =
        firebaseData.matches ||
        firebaseData.events ||
        [];

      console.log(`📄 ${matches.length} maç bulundu`);

      const missing = [];

      matches.forEach(m => {

        const tournamentName = m.tournament || '';

        const isNBA =
          tournamentName.toUpperCase().includes('NBA');

        // =========================
        // TURNOVA LOGOSU
        // =========================

        if (m.tournamentLogo) {

          const id = extractId(m.tournamentLogo);

          if (
            id &&
            id !== 'default' &&
            id !== 'null'
          ) {

            const targetPath =
              path.join(
                conf.dirs.tournament,
                `${id}.png`
              );

            if (!fs.existsSync(targetPath)) {

              missing.push({
                id,
                name: tournamentName,
                type: 'Turnuva',
                dir: conf.dirs.tournament,
                sport: conf.name
              });
            }
          }
        }

        // =========================
        // TAKIM LOGOLARI
        // =========================

        const teams = [
          { team: m.homeTeam },
          { team: m.awayTeam }
        ];

        teams.forEach(t => {

          if (!t.team) return;

          const logos =
            Array.isArray(t.team.logos)
              ? t.team.logos
              : [t.team.logo];

          logos.forEach(logoUrl => {

            if (
              !logoUrl ||
              typeof logoUrl !== 'string'
            ) {
              return;
            }

            const id = extractId(logoUrl);

            if (
              !id ||
              id === 'default' ||
              id === 'null'
            ) {
              return;
            }

            let targetDir =
              conf.name === 'Basketbol' && isNBA
                ? conf.dirs.nba
                : conf.dirs.team;

            const targetPath =
              path.join(targetDir, `${id}.png`);

            if (!fs.existsSync(targetPath)) {

              if (!missing.find(x => x.id === id)) {

                missing.push({
                  id,
                  name: t.team.name,
                  type: 'Logo',
                  dir: targetDir,
                  sport: conf.name
                });
              }
            }
          });
        });
      });

      if (missing.length === 0) {
        console.log(`✅ ${conf.name} güncel`);
        continue;
      }

      console.log(`🔍 ${missing.length} eksik logo bulundu\n`);

      for (const item of missing) {

        const targetPath =
          path.join(item.dir, `${item.id}.png`);

        const defaultPath =
          path.join(item.dir, 'default.png');

        let apiUrl = '';

        // =========================
        // TURNOVA
        // =========================

        if (item.type === 'Turnuva') {

          apiUrl =
            `https://api.sofascore.app/api/v1/unique-tournament/${item.id}/image`;

        // =========================
        // TENİS BAYRAKLARI
        // =========================

        } else if (
          item.sport === 'Tenis' &&
          item.type === 'Logo'
        ) {

          apiUrl =
            `https://www.sofascore.com/static/images/flags/${item.id.toLowerCase()}.png`;

        // =========================
        // NORMAL TAKIM
        // =========================

        } else {

          apiUrl =
            `https://api.sofascore.app/api/v1/team/${item.id}/image`;
        }

        try {

          const response = await fetchWithRetry(
            apiUrl,
            {
              responseType: 'arraybuffer',
              timeout: 30000,
              headers: {
                'User-Agent': userAgent,
                'Cookie': cookieString,
                'Referer': 'https://www.sofascore.com/',
                'Origin': 'https://www.sofascore.com',
                'Accept': 'image/png,image/*,*/*',
                'Cache-Control': 'no-cache'
              }
            },
            3
          );

          const size = response.data.byteLength;

          if (size < 1000) {
            throw new Error(`Dosya çok küçük: ${size}`);
          }

          fs.writeFileSync(targetPath, response.data);

          console.log(`   ✅ ${item.name}`);

          totalDownloaded++;

        } catch (e) {

          const status =
            e.response?.status || 'ERR';

          console.log(
            `   ❌ ${item.name} -> ${status}`
          );

          if (fs.existsSync(defaultPath)) {

            fs.copyFileSync(defaultPath, targetPath);

            console.log('      ↳ default kullanıldı');

            totalDefaulted++;

          } else {

            totalFailed++;
          }
        }

        // Rate limit koruması
        await sleep(1800);
      }
    }

    console.log('\n📊 ÖZET');
    console.log(`✅ Başarılı: ${totalDownloaded}`);
    console.log(`⚠️ Default: ${totalDefaulted}`);
    console.log(`❌ Hata: ${totalFailed}`);

  } catch (err) {

    console.error('\n❌ Kritik hata:', err.message);

  } finally {

    await browser.close();
  }
}

start();