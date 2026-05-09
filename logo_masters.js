const fs = require('fs');
const path = require('path');
const axios = require('axios');

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

// =========================
// FOLDERS
// =========================
configs.forEach(conf => {
  Object.values(conf.dirs).forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

// =========================
// SOFASCORE FALLBACK
// =========================
async function getSofaLogo(teamId) {
  try {

    const url =
      `https://img.sofascore.com/api/v1/team/${teamId}/image`;

    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      },
      timeout: 15000,
      responseType: 'arraybuffer'
    });

    if (!res.data || res.data.byteLength < 500) {
      return null;
    }

    return url;

  } catch (e) {
    return null;
  }
}

// =========================
// DOWNLOAD
// =========================
async function download(url, filePath, name) {
  try {

    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'image/*'
      }
    });

    fs.writeFileSync(filePath, res.data);

    console.log(`   ✅ ${name}`);
    return true;

  } catch (err) {

    console.log(
      `   ❌ ${name} -> ${err.response?.status || err.message}`
    );

    return false;
  }
}

// =========================
// MAIN
// =========================
async function start() {

  console.log('🚀 Logo Masters FIXED VERSION\n');

  let ok = 0;
  let fail = 0;

  for (const conf of configs) {

    console.log(`📦 ${conf.name} Firebase...`);

    let data;

    try {
      const res = await axios.get(
        `${FIREBASE_BASE_URL}${conf.firebaseFile}.json`
      );

      data = res.data;

    } catch (e) {
      console.log('❌ Firebase error');
      continue;
    }

    const matches =
      data?.matches || data?.events || [];

    console.log(`📄 ${matches.length} maç`);

    // =========================
    // EXTRACT ALL MISSING FIRST
    // =========================
    const missing = [];

    for (const m of matches) {

      const isNBA =
        (m.tournament || '').toUpperCase().includes('NBA');

      const teams = [m.homeTeam, m.awayTeam];

      for (const t of teams) {

        if (!t?.id || !t?.name) continue;

        let dir = conf.dirs.team;

        if (conf.name === 'Basketbol' && isNBA) {
          dir = conf.dirs.nba;
        }

        const filePath =
          path.join(dir, `${t.id}.png`);

        if (!fs.existsSync(filePath)) {

          missing.push({
            id: t.id,
            name: t.name,
            dir,
            filePath
          });
        }
      }

      // tournament
      if (m.tournamentLogo && m.tournamentId) {

        const filePath =
          path.join(
            conf.dirs.tournament,
            `${m.tournamentId}.png`
          );

        if (!fs.existsSync(filePath)) {

          missing.push({
            id: m.tournamentId,
            name: m.tournament,
            dir: conf.dirs.tournament,
            filePath,
            isTournament: true
          });
        }
      }
    }

    console.log(`🔍 Eksik: ${missing.length}`);

    // =========================
    // DOWNLOAD
    // =========================
    for (const item of missing) {

      let url = null;

      // team or tournament
      if (item.isTournament) {
        url =
          `https://img.sofascore.com/api/v1/unique-tournament/${item.id}/image`;
      } else {
        url =
          `https://img.sofascore.com/api/v1/team/${item.id}/image`;
      }

      // fallback test
      const finalUrl =
        await getSofaLogo(item.id) || url;

      const success =
        await download(
          finalUrl,
          item.filePath,
          item.name
        );

      if (success) ok++;
      else fail++;

      await sleep(400);
    }

    console.log(`✅ ${conf.name} tamam\n`);
  }

  console.log('\n📊 SONUÇ');
  console.log(`✅ Başarılı: ${ok}`);
  console.log(`❌ Hata: ${fail}`);
}

start();