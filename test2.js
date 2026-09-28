const { gotScraping } = require('got-scraping');
const urls = [
  'https://api.sofascore.com/api/v1/sport/football/events/live',
  'https://www.sofascore.com/api/v1/sport/football/events/live',
  'https://www.sofascore.com/api/v1/unique-tournament/17/scheduled-events/2026-09-28'
];
(async () => {
  for (const u of urls) {
    try {
      const r = await gotScraping({
        url: u,
        throwHttpErrors: false,
        headerGeneratorOptions: { browsers: [{ name: 'chrome', minVersion: 110 }], devices: ['mobile'], operatingSystems: ['android'] }
      });
      console.log(r.statusCode, u);
    } catch (e) { console.log('HATA', e.message, u); }
  }
})();
