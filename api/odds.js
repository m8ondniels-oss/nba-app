const https = require('https');
const {parse} = require('url');

function fetchJSON(urlStr) {
  return new Promise(function(resolve, reject) {
    const parsed = parse(urlStr);
    const options = {
      hostname: parsed.hostname,
      path: parsed.path,
      method: 'GET',
      headers: {'Accept': 'application/json'}
    };
    const req = https.request(options, function(res) {
      let data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        if (res.statusCode !== 200) {
          return reject(new Error('Odds API status ' + res.statusCode + ': ' + data.slice(0,100)));
        }
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function americanOdds(price) {
  if (!price && price !== 0) return null;
  return price > 0 ? '+' + price : String(price);
}

function impliedProb(price) {
  if (!price) return null;
  if (price < 0) return Math.round((-price / (-price + 100)) * 100);
  return Math.round((100 / (price + 100)) * 100);
}

function bestOdds(outcomes, name) {
  var matches = outcomes.filter(function(o) {
    return o.name && o.name.toLowerCase().includes(name.toLowerCase());
  });
  if (!matches.length) return null;
  // Return the best (most favorable) american odds
  return matches.reduce(function(best, o) {
    var p = o.price;
    if (best === null) return p;
    // Higher positive or less negative = better for bettor
    if (p > 0 && best > 0) return p > best ? p : best;
    if (p < 0 && best < 0) return p > best ? p : best;
    if (p > 0 && best < 0) return p;
    return best;
  }, null);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({success: false, error: 'ODDS_API_KEY not configured'});
  }
  try {
    // Fetch game odds (h2h moneyline) and championship futures in parallel
    // Each costs 1 request from quota
    const [gameRaw, champRaw] = await Promise.all([
      fetchJSON('https://api.the-odds-api.com/v4/sports/basketball_nba/odds?apiKey=' + apiKey + '&regions=us&markets=h2h&oddsFormat=american&bookmakers=draftkings,fanduel,betmgm'),
      fetchJSON('https://api.the-odds-api.com/v4/sports/basketball_nba_championship_winner/odds?apiKey=' + apiKey + '&regions=us&markets=outrights&oddsFormat=american&bookmakers=draftkings,fanduel,betmgm')
    ]);

    // Process game odds - build lookup by team abbreviation pairs
    var gameOdds = {};
    (gameRaw || []).forEach(function(game) {
      var home = game.home_team;
      var away = game.away_team;
      // Average odds across bookmakers for each team
      var homeOddsList = [];
      var awayOddsList = [];
      (game.bookmakers || []).forEach(function(bk) {
        var h2h = (bk.markets || []).find(function(m) { return m.key === 'h2h'; });
        if (!h2h) return;
        (h2h.outcomes || []).forEach(function(o) {
          if (o.name === home) homeOddsList.push(o.price);
          if (o.name === away) awayOddsList.push(o.price);
        });
      });
      function avgOdds(list) {
        if (!list.length) return null;
        var avg = Math.round(list.reduce(function(s, v) { return s + v; }, 0) / list.length);
        return americanOdds(avg);
      }
      gameOdds[home + '|' + away] = {
        home: avgOdds(homeOddsList),
        away: avgOdds(awayOddsList),
        homeProb: homeOddsList.length ? impliedProb(Math.round(homeOddsList.reduce(function(s,v){return s+v;},0)/homeOddsList.length)) : null,
        awayProb: awayOddsList.length ? impliedProb(Math.round(awayOddsList.reduce(function(s,v){return s+v;},0)/awayOddsList.length)) : null,
        commenceTime: game.commence_time
      };
    });

    // Process championship futures - collect all outcomes across bookmakers
    var champOdds = {};
    (champRaw || []).forEach(function(event) {
      (event.bookmakers || []).forEach(function(bk) {
        var outright = (bk.markets || []).find(function(m) { return m.key === 'outrights'; });
        if (!outright) return;
        (outright.outcomes || []).forEach(function(o) {
          if (!champOdds[o.name]) champOdds[o.name] = [];
          champOdds[o.name].push(o.price);
        });
      });
    });

    // Average and format championship odds
    var champFormatted = Object.keys(champOdds).map(function(team) {
      var prices = champOdds[team];
      var avg = Math.round(prices.reduce(function(s, v) { return s + v; }, 0) / prices.length);
      return {
        team: team,
        odds: americanOdds(avg),
        prob: impliedProb(avg)
      };
    }).sort(function(a, b) { return b.prob - a.prob; }).slice(0, 12);

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120');
    res.status(200).json({
      success: true,
      fetchedAt: new Date().toISOString(),
      gameOdds: gameOdds,
      champOdds: champFormatted
    });
  } catch(err) {
    console.error('odds.js error:', err.message);
    res.status(500).json({success: false, error: err.message});
  }
};
