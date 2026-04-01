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
          reject(new Error('JSON parse error'));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const gameId = (req.query && req.query.gameId) || '';
  if (!gameId) {
    return res.status(400).json({ success: false, error: 'Missing gameId parameter' });
  }

  const URL = 'https://cdn.nba.com/static/json/liveData/boxscore/boxscore_' + gameId + '.json';

  try {
    const raw = await fetchJSON(URL, {
      'Referer': 'https://www.nba.com/',
      'Origin': 'https://www.nba.com',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'x-nba-stats-origin': 'stats',
      'x-nba-stats-token': 'true',
    });

    const game = (raw.game) || {};
    const home = game.homeTeam || {};
    const away = game.awayTeam || {};

    function parsePlayers(team) {
      return (team.players || [])
        .filter(function(p) {
          return p.status === 'ACTIVE' && p.statistics && p.statistics.minutesCalculated !== 'PT00M';
        })
        .sort(function(a, b) {
          return (b.statistics.points || 0) - (a.statistics.points || 0);
        })
        .map(function(p) {
          var s = p.statistics || {};
          return {
            name:    (p.firstName + ' ' + p.familyName).trim(),
            jerseyNum: p.jerseyNum || '',
            position: p.position || '',
            minutes: (s.minutesCalculated || '').replace('PT','').replace('M','m').replace('S','') || '0m',
            pts:  s.points || 0,
            reb:  s.reboundsTotal || 0,
            ast:  s.assists || 0,
            stl:  s.steals || 0,
            blk:  s.blocks || 0,
            to:   s.turnovers || 0,
            fgm:  s.fieldGoalsMade || 0,
            fga:  s.fieldGoalsAttempted || 0,
            tpm:  s.threePointersMade || 0,
            tpa:  s.threePointersAttempted || 0,
            ftm:  s.freeThrowsMade || 0,
            fta:  s.freeThrowsAttempted || 0,
            plusMinus: s.plusMinusPoints || 0,
          };
        });
    }

    res.setHeader('Cache-Control', 's-maxage=25, stale-while-revalidate=10');
    res.status(200).json({
      success: true,
      gameId: gameId,
      fetchedAt: new Date().toISOString(),
      home: {
        abbr: home.teamTricode || '',
        name: ((home.teamCity || '') + ' ' + (home.teamName || '')).trim(),
        score: home.score || 0,
        players: parsePlayers(home),
      },
      away: {
        abbr: away.teamTricode || '',
        name: ((away.teamCity || '') + ' ' + (away.teamName || '')).trim(),
        score: away.score || 0,
        players: parsePlayers(away),
      },
    });

  } catch(err) {
    console.error('boxscore.js error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};
