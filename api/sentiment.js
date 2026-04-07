const https = require('https');
const {parse} = require('url');

// Team subreddit map
var SUBREDDITS = {
  ATL:'atlantahawks', BKN:'gonets', BOS:'bostonceltics', CHA:'charlottehornets',
  CHI:'chicagobulls', CLE:'clevelandcavs', DAL:'mavericks', DEN:'denvernuggets',
  DET:'detroitpistons', GSW:'warriors', HOU:'rockets', IND:'pacers',
  LAC:'laclippers', LAL:'lakers', MEM:'memphisgrizzlies', MIA:'heat',
  MIL:'mkebucks', MIN:'timberwolves', NOP:'nolapelicans', NYK:'nyknicks',
  OKC:'thunder', ORL:'orlandomagic', PHI:'sixers', PHX:'suns',
  POR:'ripcity', SAC:'kings', SAS:'nba_spurs', TOR:'torontoraptors',
  UTA:'utahjazz', WAS:'washingtonwizards'
};

// Basketball-specific sentiment lexicon
var POSITIVE = [
  'elite','dominant','unstoppable','mvp','clutch','playoff','locked in','healthy',
  'chemistry','depth','embarrassed them','blowout win','statement','locked up',
  'love this team','so good','incredible','amazing','great win','swept','first seed',
  'banner','championship','contender','built different','real deal','special',
  'efficient','shutdown','unreal','on fire','hot streak','winning','excited',
  'playoff push','back to back','dynasty','future','bright','promising','let\'s go',
  'hype','energy','vibe','fun to watch','must watch'
];

var NEGATIVE = [
  'fire the coach','tank','rebuild','injured','injury','out for season','done',
  'disappointing','embarrassing','gave up','no effort','checked out','tanking',
  'lottery','wasted','overpaid','bust','fraud','soft','bad loss','blew it',
  'collapse','choking','can\'t win','what are we doing','sell','trade him',
  'fired','terrible','awful','pathetic','disgrace','lost again','losing streak',
  'eliminated','washed','declining','frustrating','concerned','worried'
];

function fetchReddit(subreddit) {
  return new Promise(function(resolve, reject) {
    var urlStr = 'https://www.reddit.com/r/' + subreddit + '/top.json?limit=25&t=week';
    var parsed = parse(urlStr);
    var options = {
      hostname: parsed.hostname,
      path: parsed.path,
      method: 'GET',
      headers: {
        'User-Agent': 'NBAGlance/1.0 (NBA watchability app; hobby project)',
        'Accept': 'application/json',
      }
    };
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        if (res.statusCode === 429) return reject(new Error('Reddit rate limited'));
        if (res.statusCode !== 200) return reject(new Error('Reddit status ' + res.statusCode));
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Reddit JSON parse error')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, function() { req.destroy(new Error('timeout')); });
    req.end();
  });
}

function scoreSentiment(posts) {
  if (!posts || !posts.length) return {score:50, label:'Neutral', themes:[], postCount:0};

  var totalWeight = 0;
  var weightedScore = 0;
  var themes = {};

  posts.forEach(function(post) {
    var text = ((post.title || '') + ' ' + (post.selftext || '')).toLowerCase();
    var upvotes = Math.max(1, post.score || 1);
    var weight = Math.log(upvotes + 1); // log scale so viral posts don't dominate

    var posHits = 0, negHits = 0;
    POSITIVE.forEach(function(word) {
      if (text.includes(word)) {
        posHits++;
        themes[word] = (themes[word] || 0) + weight;
      }
    });
    NEGATIVE.forEach(function(word) {
      if (text.includes(word)) {
        negHits++;
        themes[word] = (themes[word] || 0) + weight * -1;
      }
    });

    // Base score: 50 neutral, shift by sentiment hits
    var postScore = 50 + (posHits * 12) - (negHits * 12);
    postScore = Math.max(0, Math.min(100, postScore));

    // Comment count also signals engagement (high engagement = exciting = positive signal)
    var comments = post.num_comments || 0;
    if (comments > 500) postScore = Math.min(100, postScore + 5);

    weightedScore += postScore * weight;
    totalWeight += weight;
  });

  var finalScore = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 50;
  finalScore = Math.max(5, Math.min(95, finalScore));

  // Get top themes (most upvote-weighted keywords)
  var themeList = Object.keys(themes)
    .map(function(k) { return {word: k, weight: themes[k]}; })
    .sort(function(a, b) { return Math.abs(b.weight) - Math.abs(a.weight); })
    .slice(0, 4)
    .map(function(t) { return {word: t.word, positive: t.weight > 0}; });

  var label;
  if (finalScore >= 80) label = 'Electric';
  else if (finalScore >= 65) label = 'Optimistic';
  else if (finalScore >= 50) label = 'Mixed';
  else if (finalScore >= 35) label = 'Frustrated';
  else label = 'In Despair';

  return {score: finalScore, label: label, themes: themeList, postCount: posts.length};
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  var abbr = (req.query && req.query.team || '').toUpperCase();
  if (!abbr || !SUBREDDITS[abbr]) {
    return res.status(400).json({success: false, error: 'Missing or invalid team param'});
  }
  var subreddit = SUBREDDITS[abbr];
  try {
    var raw = await fetchReddit(subreddit);
    var posts = ((raw.data || {}).children || []).map(function(c) { return c.data; });
    var sentiment = scoreSentiment(posts);
    // Cache for 7 days - fan sentiment doesn't change that fast
    res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate=86400');
    res.status(200).json({
      success: true,
      team: abbr,
      subreddit: 'r/' + subreddit,
      fetchedAt: new Date().toISOString(),
      sentiment: sentiment
    });
  } catch(err) {
    console.error('sentiment.js error:', abbr, err.message);
    res.status(500).json({success: false, error: err.message});
  }
};
