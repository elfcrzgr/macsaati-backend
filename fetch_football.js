// --- GÜNCEL VE KALICI KLASÖR YAPISI ---
const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

// Logolar artık bu klasörlerden okunacak (GitHub'da klasörleri buna göre taşı)
const FOOTBALL_TEAM_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/`;
const FOOTBALL_TOURNAMENT_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/`;

const OUTPUT_FILE = "matches_football.json"; 
// -----------------------------------------

// ... (Scriptin geri kalanı aynı, sadece logo basılan yerler yukarıdaki değişkenleri kullanmalı)
homeTeam: { 
    name: e.homeTeam.name, 
    logo: `${FOOTBALL_TEAM_LOGO_BASE}${e.homeTeam.id}.png` 
},
awayTeam: { 
    name: e.awayTeam.name, 
    logo: `${FOOTBALL_TEAM_LOGO_BASE}${e.awayTeam.id}.png` 
},
tournamentLogo: `${FOOTBALL_TOURNAMENT_LOGO_BASE}${e.tournament.uniqueTournament.id}.png`,