const https = require('https');
const {parse} = require('url');

function fetchJSON(urlStr) {
  return new Promise(function(resolve, reject) {
    const parsed = parse(urlStr);
    const options = {
      hostname: parsed.hostname,
      path: parsed.path,
      method: 'GET',
      headers: {
        'Referer': 'https://www.nba.com/',
        'Origin': 'https://www.nba.com',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'x-nba-stats-origin': 'stats',
        'x-nba-stats-token': 'true',
      }
    };
    const req = https.request(options, function(res) {
      let data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        if (res.statusCode !== 200) {
          return reject(new Error('NBA API status ' + res.statusCode));
        }
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    // Fetch per-game player stats for the season - sorted by PPG
    var raw = await fetchJSON(
      'https://stats.nba.com/stats/leaguedashplayerstats?College=&Conference=&Country=&DateFrom=&DateTo=&Division=&DraftPick=&DraftYear=&GameScope=&GameSegment=&Height=&ISTRound=&LastNGames=0&LeagueID=00&Location=&MeasureType=Base&Month=0&OpponentTeamID=0&Outcome=&PORound=0&PaceAdjust=N&PerMode=PerGame&Period=0&PlayerExperience=&PlayerPosition=&PlusMinus=N&Rank=N&Season=2025-26&SeasonSegment=&SeasonType=Regular+Season&ShotClockRange=&StarterBench=&TeamID=0&TwoWay=0&VsConference=&VsDivision=&Weight='
    );

    var headers = raw.resultSets[0].headers;
    var nameIdx = headers.indexOf('PLAYER_NAME');
    var teamIdIdx = headers.indexOf('TEAM_ID');
    var teamAbbrIdx = headers.indexOf('TEAM_ABBREVIATION');
    var gpIdx = headers.indexOf('GP');
    var ptsIdx = headers.indexOf('PTS');
    var rebIdx = headers.indexOf('REB');
    var astIdx = headers.indexOf('AST');
    var minIdx = headers.indexOf('MIN');

    // Only include players with meaningful minutes (10+ GP, 10+ MPG)
    var players = raw.resultSets[0].rowSet
      .filter(function(row) {
        return row[gpIdx] >= 10 && row[minIdx] >= 10;
      })
      .map(function(row) {
        return {
          name: row[nameIdx],
          teamId: row[teamIdIdx],
          teamAbbr: row[teamAbbrIdx],
          gp: row[gpIdx],
          ppg: Math.round(row[ptsIdx] * 10) / 10,
          rpg: Math.round(row[rebIdx] * 10) / 10,
          apg: Math.round(row[astIdx] * 10) / 10,
          mpg: Math.round(row[minIdx] * 10) / 10,
        };
      });

    // Group top players by team (top 3 by PPG per team)
    var byTeam = {};
    players.forEach(function(p) {
      if (!byTeam[p.teamAbbr]) byTeam[p.teamAbbr] = [];
      byTeam[p.teamAbbr].push(p);
    });
    Object.keys(byTeam).forEach(function(abbr) {
      byTeam[abbr].sort(function(a, b) { return b.ppg - a.ppg; });
      byTeam[abbr] = byTeam[abbr].slice(0, 3);
    });

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    res.status(200).json({
      success: true,
      fetchedAt: new Date().toISOString(),
      byTeam: byTeam,
      // Also return top 25 scorers for AVGS lookup
      leaders: players
        .sort(function(a, b) { return b.ppg - a.ppg; })
        .slice(0, 50)
        .map(function(p) { return {name: p.name, ppg: p.ppg, teamAbbr: p.teamAbbr}; })
    });
  } catch(err) {
    console.error('players.js error:', err.message);
    res.status(500).json({success: false, error: err.message});
  }
};
