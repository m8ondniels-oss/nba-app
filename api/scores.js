const https = require('https');
const { parse } = require('url');

function fetchJSON(urlStr, headers) {
  return new Promise(function(resolve, reject) {
    const parsed = parse(urlStr);
    const options = {
      hostname: parsed.hostname,
      path: parsed.path,
      method: 'GET',
      headers: headers,
    };
    const req = https.request(options, function(res) {
      let data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        if (res.statusCode !== 200) {
          return reject(new Error('NBA API status ' + res.statusCode));
        }
        try {
          resolve(JSON.parse(data));
        } catch(e) {
          reject(new Error('JSON parse error: ' + data.slice(0, 100)));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const raw = await fetchJSON(
      'https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json',
      {
        'Referer': 'https://www.nba.com/',
        'Origin': 'https://www.nba.com',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'x-nba-stats-origin': 'stats',
        'x-nba-stats-token': 'true',
      }
    );

    const games = ((raw.scoreboard || {}).games || []).map(function(g) {
      var home = g.homeTeam || {};
      var away = g.awayTeam || {};
      var statusNum = g.gameStatus || 1;
      var status = statusNum === 1 ? 'scheduled' : statusNum === 2 ? 'inprogress' : 'final';

      var clock = '';
      var cm = (g.gameClock || '').match(/PT(\d+)M([\d.]+)S/);
      if (cm) {
        clock = parseInt(cm[1]) + ':' + ('0' + Math.floor(parseFloat(cm[2]))).slice(-2);
      }

      function leaders(team) {
        return ((team.players || [])
          .filter(function(p) { return p.statistics && p.statistics.points > 0; })
          .sort(function(a, b) { return b.statistics.points - a.statistics.points; })
          .slice(0, 3)
          .map(function(p) {
            return {
              name: (p.firstName + ' ' + p.familyName).trim(),
              pts: p.statistics.points || 0,
              reb: p.statistics.reboundsTotal || 0,
              ast: p.statistics.assists || 0,
            };
          }));
      }

      function periods(homeT, awayT) {
        return ((homeT.periods || []).map(function(hp, i) {
          return {
            period: i + 1,
            home: hp.score || 0,
            away: ((awayT.periods || [])[i] || {}).score || 0,
          };
        }));
      }

      return {
        id:          g.gameId,
        status:      status,
        startTime:   g.gameTimeUTC || '',
        clock:       clock,
        quarter:     g.period || 0,
        home: {
          abbr:  home.teamTricode || '',
          name:  ((home.teamCity || '') + ' ' + (home.teamName || '')).trim(),
          score: home.score != null ? home.score : null,
          fgPct: (home.statistics || {}).fieldGoalsPercentage || null,
        },
        away: {
          abbr:  away.teamTricode || '',
          name:  ((away.teamCity || '') + ' ' + (away.teamName || '')).trim(),
          score: away.score != null ? away.score : null,
          fgPct: (away.statistics || {}).fieldGoalsPercentage || null,
        },
        leaders:      { home: leaders(home), away: leaders(away) },
        periodScores: periods(home, away),
        broadcasts:   ((g.broadcasters || {}).nationalTvBroadcasters || []).map(function(b) {
          return b.broadcasterDisplay;
        }),
      };
    });

    res.setHeader('Cache-Control', 's-maxage=25, stale-while-revalidate=10');
    res.status(200).json({ success: true, fetchedAt: new Date().toISOString(), gameCount: games.length, games: games });

  } catch(err) {
    console.error('scores.js error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};
