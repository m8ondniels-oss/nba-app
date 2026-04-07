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
        catch(e) { reject(new Error('JSON parse error: ' + data.slice(0,100))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    // Fetch standings (records, conf rank) and advanced stats (off/def/net rating) in parallel
    const [standRaw, advRaw] = await Promise.all([
      fetchJSON('https://stats.nba.com/stats/leaguestandingsv3?LeagueID=00&Season=2025-26&SeasonType=Regular+Season&SeasonYear=2025-26'),
      fetchJSON('https://stats.nba.com/stats/leaguedashteamstats?Conference=&DateFrom=&DateTo=&Division=&GameScope=&GameSegment=&Height=&ISTRound=&LastNGames=0&LeagueID=00&Location=&MeasureType=Advanced&Month=0&OpponentTeamID=0&Outcome=&PORound=0&PaceAdjust=N&PerMode=PerGame&Period=0&PlayerExperience=&PlayerPosition=&PlusMinus=N&Rank=N&Season=2025-26&SeasonSegment=&SeasonType=Regular+Season&ShotClockRange=&StarterBench=&TeamID=0&TwoWay=0&VsConference=&VsDivision=')
    ]);

    // Parse standings - headers tell us column positions
    var standHeaders = standRaw.resultSets[0].headers;
    var teamIdIdx = standHeaders.indexOf('TeamID');
    var teamCityIdx = standHeaders.indexOf('TeamCity');
    var teamNameIdx = standHeaders.indexOf('TeamName');
    var confIdx = standHeaders.indexOf('Conference');
    var confRankIdx = standHeaders.indexOf('PlayoffRank');
    var winsIdx = standHeaders.indexOf('WINS');
    var lossIdx = standHeaders.indexOf('LOSSES');
    var abbrIdx = standHeaders.indexOf('TeamAbbreviation');

    // Parse advanced - headers for ratings
    var advHeaders = advRaw.resultSets[0].headers;
    var advTeamIdIdx = advHeaders.indexOf('TEAM_ID');
    var offRtgIdx = advHeaders.indexOf('OFF_RATING');
    var defRtgIdx = advHeaders.indexOf('DEF_RATING');
    var netRtgIdx = advHeaders.indexOf('NET_RATING');
    var paceIdx = advHeaders.indexOf('PACE');

    // Build advanced lookup by teamId
    var advMap = {};
    advRaw.resultSets[0].rowSet.forEach(function(row) {
      var tid = row[advTeamIdIdx];
      advMap[tid] = {
        offRtg: Math.round(row[offRtgIdx] * 10) / 10,
        defRtg: Math.round(row[defRtgIdx] * 10) / 10,
        netRtg: Math.round(row[netRtgIdx] * 10) / 10,
        pace:   Math.round(row[paceIdx] * 10) / 10,
      };
    });

    var teams = standRaw.resultSets[0].rowSet.map(function(row) {
      var tid = row[teamIdIdx];
      var adv = advMap[tid] || {offRtg:0,defRtg:0,netRtg:0,pace:0};
      return {
        teamId: tid,
        abbr: row[abbrIdx],
        name: (row[teamCityIdx] + ' ' + row[teamNameIdx]).trim(),
        conf: row[confIdx] === 'East' ? 'E' : 'W',
        confRank: row[confRankIdx],
        wins: row[winsIdx],
        losses: row[lossIdx],
        offRtg: adv.offRtg,
        defRtg: adv.defRtg,
        netRtg: adv.netRtg,
        pace: adv.pace,
      };
    });

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    res.status(200).json({
      success: true,
      fetchedAt: new Date().toISOString(),
      teams: teams
    });
  } catch(err) {
    console.error('standings.js error:', err.message);
    res.status(500).json({success: false, error: err.message});
  }
};
