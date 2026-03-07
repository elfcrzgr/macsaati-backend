// Updated fetch.js to sort all matches by time globally

const fetchMatches = async () => {
    const leagues = await getLeagues();
    let allMatches = [];

    for (const league of leagues) {
        const matches = await fetchMatchesByLeague(league);
        allMatches = allMatches.concat(matches);
    }

    // Sort all matches by time
    allMatches.sort((a, b) => new Date(a.time) - new Date(b.time));

    return allMatches;
};

export default fetchMatches;