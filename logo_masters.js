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

const sleep = ms => new Promise(r => setTimeout(r, ms));

// =========================
// DOWNLOAD
// =========================
async function download(url, filePath, name) {
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });

    fs.writeFileSync(filePath, res.data);

    console.log(`   ✅ ${name}`);
    return true;

  } catch (e) {
    console.log(`   ❌ ${name} -> ${e.response?.status || e.message}`);
    return false;
  }
}

// =========================
// SOFASCORE FALLBACK
// =========================
const getLogo = (type, id) => {
  if (type === 'team') {
    return `https://img.sofascore.com/api/v1/team/${id}/image`;
  }

  if (type === 'tournament') {
    return `https://img.sofascore.com/api/v1/unique-tournament/${id}/image`;
  }

  return null;
};

// =========================
// MAIN
// =========================
async function start() {

  console.log('🚀 Repo-based Logo Sync Started\n');

  let ok = 0;
  let fail = 0;

  for (const conf of configs) {

    console.log(`📦 ${conf.name}`);

    const res = await axios.get(
      `${FIREBASE_BASE_URL}${conf.firebaseFile}.json`
    );

    const matches =
      res.data?.matches || res.data?.events || [];

    console.log(`📄 ${matches.length} matches`);

    const missing = [];

    // =========================
    // BUILD MISSING FROM FILESYSTEM ONLY
    // =========================
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

        // 🔥 TEK GERÇEK KAYNAK BURASI
        if (!fs.existsSync(filePath)) {

          missing.push({
            type: 'team',
            id: t.id,
            name: t.name,
            filePath
          });
        }
      }

      // tournament
      if (m.tournamentId) {

        const filePath =
          path.join(
            conf.dirs.tournament,
            `${m.tournamentId}.png`
          );

        if (!fs.existsSync(filePath)) {

          missing.push({
            type: 'tournament',
            id: m.tournamentId,
            name: m.tournament,
            filePath
          });
        }
      }
    }

    console.log(`🔍 Missing: ${missing.length}`);

    // =========================
    // DOWNLOAD
    // =========================
    for (const item of missing) {

      const url =
        getLogo(item.type, item.id);

      const success =
        await download(url, item.filePath, item.name);

      if (success) ok++;
      else fail++;

      await sleep(300);
    }

    console.log(`✅ ${conf.name} done\n`);
  }

  console.log('\n📊 FINAL');
  console.log(`✅ Success: ${ok}`);
  console.log(`❌ Fail: ${fail}`);
}

start();