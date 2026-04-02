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
catch(e) { reject(new Error(‘JSON parse error’)); }
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
‘x-nba-stats-origin’: ‘stats’,
‘x-nba-stats-token’: ‘true’,
};

// Star player PPG averages — update these as the season progresses
// This is our fallback if the API doesn’t return what we need
var STAR_DATA = {
ATL: { players: [‘Trae Young’, ‘De'Andre Hunter’],       ppg: [25.6, 17.2], rating: 79 },
BKN: { players: [‘Cam Thomas’],                           ppg: [24.2],       rating: 68 },
BOS: { players: [‘Jayson Tatum’, ‘Jaylen Brown’],         ppg: [27.0, 22.1], rating: 91 },
CHA: { players: [‘LaMelo Ball’, ‘Brandon Miller’],        ppg: [24.1, 17.9], rating: 77 },
CHI: { players: [‘Zach LaVine’],                         ppg: [24.8],       rating: 72 },
CLE: { players: [‘Donovan Mitchell’, ‘Evan Mobley’],      ppg: [25.5, 19.4], rating: 84 },
DAL: { players: [‘Luka Doncic’, ‘Anthony Davis’],         ppg: [28.1, 26.1], rating: 88 },
DEN: { players: [‘Nikola Jokic’, ‘Jamal Murray’],         ppg: [29.3, 21.5], rating: 92 },
DET: { players: [‘Cade Cunningham’],                      ppg: [26.9],       rating: 85 },
GSW: { players: [‘Stephen Curry’],                        ppg: [26.4],       rating: 83 },
HOU: { players: [‘Kevin Durant’, ‘Alperen Sengun’],       ppg: [27.3, 21.1], rating: 86 },
IND: { players: [‘Tyrese Haliburton’],                    ppg: [20.1],       rating: 69 },
LAC: { players: [‘Kawhi Leonard’, ‘James Harden’],        ppg: [22.0, 16.8], rating: 72 },
LAL: { players: [‘LeBron James’, ‘Luka Doncic’],          ppg: [23.8, 28.1], rating: 87 },
MEM: { players: [‘Jaren Jackson Jr.’],                    ppg: [22.1],       rating: 72 },
MIA: { players: [‘Jimmy Butler’, ‘Bam Adebayo’],          ppg: [20.8, 19.3], rating: 79 },
MIL: { players: [‘Damian Lillard’],                       ppg: [24.3],       rating: 76 },
MIN: { players: [‘Anthony Edwards’],                      ppg: [27.8],       rating: 84 },
NOP: { players: [‘Zion Williamson’],                      ppg: [22.9],       rating: 73 },
NYK: { players: [‘Jalen Brunson’, ‘Karl-Anthony Towns’],  ppg: [26.0, 24.9], rating: 88 },
OKC: { players: [‘Shai Gilgeous-Alexander’],              ppg: [32.1],       rating: 95 },
ORL: { players: [‘Paolo Banchero’, ‘Franz Wagner’],       ppg: [22.6, 19.1], rating: 80 },
PHI: { players: [‘Joel Embiid’, ‘Paul George’],           ppg: [34.7, 18.5], rating: 78 },
PHX: { players: [‘Devin Booker’],                         ppg: [25.8],       rating: 80 },
POR: { players: [‘Anfernee Simons’, ‘Scoot Henderson’],   ppg: [22.4, 16.2], rating: 71 },
SAC: { players: [‘De'Aaron Fox’],                        ppg: [26.0],       rating: 74 },
SAS: { players: [‘Victor Wembanyama’],                    ppg: [25.4],       rating: 88 },
TOR: { players: [‘Scottie Barnes’],                       ppg: [21.8],       rating: 76 },
UTA: { players: [‘Lauri Markkanen’],                      ppg: [23.4],       rating: 70 },
WAS: { players: [‘Jordan Poole’],                         ppg: [17.8],       rating: 58 },
};

module.exports = async function handler(req, res) {
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);

try {
// Try to fetch the NBA injury report
// This endpoint returns today’s official injury designations
var injuryData = {};
try {
var raw = await fetchJSON(
‘https://cdn.nba.com/static/json/liveData/injuries/injuries_00.json’,
NBA_HEADERS
);
// Parse injury report into a map of playerName -> status
var injuryList = (raw && raw.injuryReport && raw.injuryReport.injuries) || [];
injuryList.forEach(function(inj) {
var name = (inj.firstName || ‘’) + ’ ’ + (inj.lastName || ‘’);
var teamAbbr = inj.teamAbbreviation || ‘’;
var status = inj.status || ‘’;
if (!injuryData[teamAbbr]) injuryData[teamAbbr] = [];
injuryData[teamAbbr].push({
name: name.trim(),
status: status,
reason: inj.reason || ‘’,
});
});
} catch(injErr) {
// Injury API unavailable — continue with empty injury data
console.log(‘Injury fetch skipped:’, injErr.message);
}

```
// Build response combining star data + injury report
var teams = {};
Object.keys(STAR_DATA).forEach(function(abbr) {
  var stars = STAR_DATA[abbr];
  var injuries = injuryData[abbr] || [];

  // Apply injury adjustments to star rating
  var adjustedRating = stars.rating;
  var starInjuries = [];

  stars.players.forEach(function(playerName) {
    var inj = injuries.find(function(i) {
      return i.name.toLowerCase() === playerName.toLowerCase();
    });
    if (inj) {
      starInjuries.push({name: playerName, status: inj.status, reason: inj.reason});
      if (inj.status === 'Out') {
        // Remove this player's contribution — drop rating proportionally
        adjustedRating = Math.round(adjustedRating * 0.75);
      } else if (inj.status === 'Questionable' || inj.status === 'Doubtful') {
        adjustedRating = Math.round(adjustedRating * 0.88);
      }
    }
  });

  // Also include non-star injuries for display
  var otherInjuries = injuries.filter(function(i) {
    return !stars.players.some(function(p) {
      return p.toLowerCase() === i.name.toLowerCase();
    });
  }).slice(0, 3);

  teams[abbr] = {
    players: stars.players,
    ppg: stars.ppg,
    rating: Math.max(10, adjustedRating),
    baseRating: stars.rating,
    starInjuries: starInjuries,
    otherInjuries: otherInjuries,
    allInjuries: injuries,
  };
});

res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=300');
res.status(200).json({
  success: true,
  fetchedAt: new Date().toISOString(),
  hasLiveInjuries: Object.keys(injuryData).length > 0,
  teams: teams,
});
```

} catch(err) {
console.error(‘rosters.js error:’, err.message);
// Always return something useful even on error
res.status(200).json({
success: true,
fetchedAt: new Date().toISOString(),
hasLiveInjuries: false,
teams: STAR_DATA,
error: err.message,
});
}
};