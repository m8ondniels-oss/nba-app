const https = require(‘https’);
const { parse } = require(‘url’);

function fetchJSON(urlStr, headers) {
return new Promise(function(resolve, reject) {
const parsed = parse(urlStr);
const options = {
hostname: parsed.hostname,
path: parsed.path,
method: ‘GET’,
headers: headers || {},
};
const req = https.request(options, function(res) {
let data = ‘’;
res.on(‘data’, function(chunk) { data += chunk; });
res.on(‘end’, function() {
if (res.statusCode !== 200) {
return reject(new Error(’Status ’ + res.statusCode));
}
try { resolve(JSON.parse(data)); }
catch(e) { reject(new Error(’JSON parse error: ’ + data.slice(0, 80))); }
});
});
req.on(‘error’, reject);
req.end();
});
}

const NBA_HEADERS = {
‘Referer’: ‘https://www.nba.com/’,
‘Origin’: ‘https://www.nba.com’,
‘User-Agent’: ‘Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36’,
‘Accept’: ‘application/json, text/plain, */*’,
‘Accept-Language’: ‘en-US,en;q=0.9’,
‘x-nba-stats-origin’: ‘stats’,
‘x-nba-stats-token’: ‘true’,
};

// Current accurate rosters + star ratings
// DAL now has Luka Doncic + Anthony Davis after the trade
// LAL no longer has those players
var STAR_DATA = {
ATL: { players: [‘Trae Young’, “De’Andre Hunter”],        ppg: [25.6, 17.2], rating: 79 },
BKN: { players: [‘Cam Thomas’],                           ppg: [24.2],       rating: 68 },
BOS: { players: [‘Jayson Tatum’, ‘Jaylen Brown’],         ppg: [27.0, 22.1], rating: 91 },
CHA: { players: [‘LaMelo Ball’, ‘Brandon Miller’],        ppg: [24.1, 17.9], rating: 77 },
CHI: { players: [‘Zach LaVine’],                         ppg: [24.8],       rating: 72 },
CLE: { players: [‘Donovan Mitchell’, ‘Evan Mobley’],      ppg: [25.5, 19.4], rating: 84 },
DAL: { players: [‘Luka Doncic’, ‘Anthony Davis’],         ppg: [28.1, 26.1], rating: 90 },
DEN: { players: [‘Nikola Jokic’, ‘Jamal Murray’],         ppg: [29.3, 21.5], rating: 92 },
DET: { players: [‘Cade Cunningham’],                      ppg: [26.9],       rating: 85 },
GSW: { players: [‘Stephen Curry’],                        ppg: [26.4],       rating: 83 },
HOU: { players: [‘Kevin Durant’, ‘Alperen Sengun’],       ppg: [27.3, 21.1], rating: 86 },
IND: { players: [‘Tyrese Haliburton’],                    ppg: [20.1],       rating: 69 },
LAC: { players: [‘James Harden’, ‘Kawhi Leonard’],        ppg: [16.8, 22.0], rating: 72 },
LAL: { players: [‘LeBron James’, ‘Austin Reaves’],        ppg: [23.8, 18.4], rating: 78 },
MEM: { players: [‘Jaren Jackson Jr.’],                    ppg: [22.1],       rating: 72 },
MIA: { players: [‘Bam Adebayo’, ‘Tyler Herro’],           ppg: [19.3, 22.4], rating: 77 },
MIL: { players: [‘Damian Lillard’, ‘Giannis Antetokounmpo’], ppg: [24.3, 27.1], rating: 82 },
MIN: { players: [‘Anthony Edwards’, ‘Julius Randle’],     ppg: [27.8, 20.1], rating: 84 },
NOP: { players: [‘Zion Williamson’, ‘Brandon Ingram’],    ppg: [22.9, 21.4], rating: 73 },
NYK: { players: [‘Jalen Brunson’, ‘Karl-Anthony Towns’],  ppg: [26.0, 24.9], rating: 88 },
OKC: { players: [‘Shai Gilgeous-Alexander’],              ppg: [32.1],       rating: 95 },
ORL: { players: [‘Paolo Banchero’, ‘Franz Wagner’],       ppg: [22.6, 19.1], rating: 80 },
PHI: { players: [‘Paul George’, ‘Tyrese Maxey’],          ppg: [18.5, 25.9], rating: 78 },
PHX: { players: [‘Devin Booker’, ‘Kevin Durant’],         ppg: [25.8, 27.3], rating: 84 },
POR: { players: [‘Anfernee Simons’, ‘Scoot Henderson’],   ppg: [22.4, 16.2], rating: 71 },
SAC: { players: [“De’Aaron Fox”, ‘Domantas Sabonis’],     ppg: [26.0, 19.9], rating: 76 },
SAS: { players: [‘Victor Wembanyama’, ‘Stephon Castle’],  ppg: [25.4, 14.2], rating: 88 },
TOR: { players: [‘Scottie Barnes’, ‘RJ Barrett’],         ppg: [21.8, 21.2], rating: 76 },
UTA: { players: [‘Lauri Markkanen’, ‘Collin Sexton’],     ppg: [23.4, 18.6], rating: 70 },
WAS: { players: [‘Jordan Poole’, ‘Kyle Kuzma’],           ppg: [17.8, 15.2], rating: 58 },
};

module.exports = async function handler(req, res) {
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);

var injuryData = {};
var hasLiveInjuries = false;

// Try the NBA stats injury report endpoint
// This is the same stats.nba.com API family that works for other endpoints
try {
var raw = await fetchJSON(
‘https://stats.nba.com/stats/injuries/?InjuryDate=0&Season=2025-26’,
NBA_HEADERS
);

```
// Parse resultSets format (same structure as other nba stats endpoints)
var resultSets = (raw && raw.resultSets) || [];
var injurySet = resultSets.find(function(r) { return r.name === 'InjuryReport'; }) || resultSets[0];

if (injurySet && injurySet.rowSet && injurySet.rowSet.length > 0) {
  var headers = injurySet.headers || [];
  var teamIdx   = headers.indexOf('TEAM_ABBREVIATION');
  var nameIdx   = headers.indexOf('PLAYER_NAME');
  var statusIdx = headers.indexOf('RETURN_DATE');
  var reasonIdx = headers.indexOf('NOTES');
  var gameStatusIdx = headers.indexOf('GAME_STATUS');

  injurySet.rowSet.forEach(function(row) {
    var team   = row[teamIdx]  || '';
    var name   = row[nameIdx]  || '';
    var status = row[gameStatusIdx] || row[statusIdx] || 'Out';
    var reason = row[reasonIdx] || '';
    if (!injuryData[team]) injuryData[team] = [];
    injuryData[team].push({ name: name, status: status, reason: reason });
  });

  hasLiveInjuries = true;
}
```

} catch(err) {
console.log(‘NBA stats injury fetch failed:’, err.message);

```
// Second attempt — try the CDN injury feed with a slightly different path
try {
  var raw2 = await fetchJSON(
    'https://cdn.nba.com/static/json/liveData/injuries/injuries_00.json',
    NBA_HEADERS
  );
  var injList = [];
  if (raw2 && raw2.injuryReport) injList = raw2.injuryReport.injuries || raw2.injuryReport || [];
  else if (raw2 && Array.isArray(raw2)) injList = raw2;

  injList.forEach(function(inj) {
    var team = inj.teamAbbreviation || inj.TEAM_ABBREVIATION || '';
    var name = inj.playerName || ((inj.firstName || '') + ' ' + (inj.lastName || '')).trim() || '';
    var status = inj.status || inj.GAME_STATUS || 'Out';
    var reason = inj.reason || inj.NOTES || '';
    if (team && name) {
      if (!injuryData[team]) injuryData[team] = [];
      injuryData[team].push({ name: name, status: status, reason: reason });
    }
  });

  if (Object.keys(injuryData).length > 0) hasLiveInjuries = true;
} catch(err2) {
  console.log('CDN injury fetch also failed:', err2.message);
}
```

}

// Build final response combining star data + any live injury data
var teams = {};
Object.keys(STAR_DATA).forEach(function(abbr) {
var stars    = STAR_DATA[abbr];
var injuries = injuryData[abbr] || [];
var adjustedRating = stars.rating;
var starInjuries   = [];

```
stars.players.forEach(function(playerName) {
  var inj = injuries.find(function(i) {
    // Match on last name at minimum to handle formatting differences
    var injLower  = (i.name || '').toLowerCase();
    var starLower = playerName.toLowerCase();
    var lastName  = starLower.split(' ').pop();
    return injLower === starLower || injLower.indexOf(lastName) !== -1;
  });
  if (inj) {
    starInjuries.push({ name: playerName, status: inj.status, reason: inj.reason });
    var s = (inj.status || '').toLowerCase();
    if (s === 'out' || s === 'inactive') {
      adjustedRating = Math.round(adjustedRating * 0.75);
    } else if (s === 'questionable' || s === 'doubtful') {
      adjustedRating = Math.round(adjustedRating * 0.88);
    }
  }
});

var otherInjuries = injuries.filter(function(i) {
  return !stars.players.some(function(p) {
    return (i.name || '').toLowerCase().indexOf(p.split(' ').pop().toLowerCase()) !== -1;
  });
}).slice(0, 3);

teams[abbr] = {
  players:       stars.players,
  ppg:           stars.ppg,
  rating:        Math.max(10, adjustedRating),
  baseRating:    stars.rating,
  starInjuries:  starInjuries,
  otherInjuries: otherInjuries,
};
```

});

// Cache for 30 mins — v2 will make this time-aware per NBA disclosure policy
res.setHeader(‘Cache-Control’, ‘s-maxage=1800, stale-while-revalidate=300’);
res.status(200).json({
success:         true,
fetchedAt:       new Date().toISOString(),
hasLiveInjuries: hasLiveInjuries,
teams:           teams,
});
};