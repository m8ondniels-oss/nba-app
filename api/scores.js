// api/scores.js
// Vercel serverless function — proxies the NBA stats API with the correct
// headers that the NBA CDN requires. Your frontend calls /api/scores and
// this function fetches the real data and returns it.

module.export default async function handler(req, res) {
  // Allow your frontend to call this endpoint
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  // Today's date in the format the NBA API expects: MM/DD/YYYY
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day   = String(now.getDate()).padStart(2, '0');
  const year  = now.getFullYear();
  const dateStr = `${month}/${day}/${year}`;

  const SCOREBOARD_URL =
    `https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json`;

  try {
    const response = await fetch(SCOREBOARD_URL, {
      headers: {
        // These headers are required — the NBA CDN blocks requests without them
        'Referer':    'https://www.nba.com/',
        'Origin':     'https://www.nba.com',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept':     'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'x-nba-stats-origin': 'stats',
        'x-nba-stats-token':  'true',
      },
    });

    if (!response.ok) {
      throw new Error(`NBA API responded with status ${response.status}`);
    }

    const raw = await response.json();

    // ── Parse the NBA response into a clean shape our frontend understands ──
    const games = (raw?.scoreboard?.games || []).map(g => {
      const homeTeam = g.homeTeam || {};
      const awayTeam = g.awayTeam || {};

      // Game status: 1 = not started, 2 = in progress, 3 = final
      const statusNum = g.gameStatus || 1;
      const status =
        statusNum === 1 ? 'scheduled' :
        statusNum === 2 ? 'inprogress' : 'final';

      // Clock comes as "PT07M32.00S" — convert to "7:32"
      const rawClock = g.gameClock || '';
      let clock = '';
      const clockMatch = rawClock.match(/PT(\d+)M([\d.]+)S/);
      if (clockMatch) {
        const mins = parseInt(clockMatch[1]);
        const secs = Math.floor(parseFloat(clockMatch[2]));
        clock = `${mins}:${String(secs).padStart(2, '0')}`;
      }

      return {
        id:         g.gameId,
        status,
        startTime:  g.gameTimeUTC,
        clock,
        quarter:    g.period || 0,
        home: {
          abbr:  homeTeam.teamTricode || '',
          name:  `${homeTeam.teamCity || ''} ${homeTeam.teamName || ''}`.trim(),
          score: homeTeam.score ?? null,
          // Per team stats available mid-game
          fgPct:   homeTeam.statistics?.fieldGoalsPercentage ?? null,
          efgPct:  null, // calculated below if possible
          assists: homeTeam.statistics?.assists ?? null,
          tos:     homeTeam.statistics?.turnovers ?? null,
        },
        away: {
          abbr:  awayTeam.teamTricode || '',
          name:  `${awayTeam.teamCity || ''} ${awayTeam.teamName || ''}`.trim(),
          score: awayTeam.score ?? null,
          fgPct:   awayTeam.statistics?.fieldGoalsPercentage ?? null,
          efgPct:  null,
          assists: awayTeam.statistics?.assists ?? null,
          tos:     awayTeam.statistics?.turnovers ?? null,
        },
        // Top scorers from the live box score (up to 3 per team)
        leaders: {
          home: (g.homeTeam?.players || [])
            .filter(p => (p.statistics?.points ?? 0) > 0)
            .sort((a,b) => (b.statistics?.points ?? 0) - (a.statistics?.points ?? 0))
            .slice(0, 3)
            .map(p => ({
              name:   `${p.firstName || ''} ${p.familyName || ''}`.trim(),
              pts:    p.statistics?.points ?? 0,
              reb:    p.statistics?.reboundsTotal ?? 0,
              ast:    p.statistics?.assists ?? 0,
              status: p.status || 'ACTIVE',
            })),
          away: (g.awayTeam?.players || [])
            .filter(p => (p.statistics?.points ?? 0) > 0)
            .sort((a,b) => (b.statistics?.points ?? 0) - (a.statistics?.points ?? 0))
            .slice(0, 3)
            .map(p => ({
              name:   `${p.firstName || ''} ${p.familyName || ''}`.trim(),
              pts:    p.statistics?.points ?? 0,
              reb:    p.statistics?.reboundsTotal ?? 0,
              ast:    p.statistics?.assists ?? 0,
              status: p.status || 'ACTIVE',
            })),
        },
        // Scoring by period
        periodScores: (g.homeTeam?.periods || []).map((hp, i) => ({
          period: i + 1,
          home: hp.score ?? 0,
          away: (g.awayTeam?.periods?.[i]?.score ?? 0),
        })),
        arena:       g.arenaName || '',
        attendance:  g.attendance || null,
        broadcasts:  (g.broadcasters?.nationalTvBroadcasters || []).map(b => b.broadcasterDisplay),
      };
    });

    // Cache for 25 seconds on Vercel's edge — keeps us under NBA rate limits
    // while still feeling live to the user
    res.setHeader('Cache-Control', 's-maxage=25, stale-while-revalidate=10');
    res.status(200).json({
      success: true,
      date: dateStr,
      fetchedAt: new Date().toISOString(),
      gameCount: games.length,
      games,
    });

  } catch (err) {
    console.error('NBA API fetch error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      fallback: true,
    });
  }
}
