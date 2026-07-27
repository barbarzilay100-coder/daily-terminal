/* Builds an offline copy of index.html for the e2e test.
 *
 * Three substitutions and nothing else. The app code under test is byte-identical
 * to what ships:
 *   1. the Lightweight Charts CDN <script> is repointed at the vendored copy
 *   2. window.fetch is wrapped so every outbound URL resolves to a captured
 *      fixture instead of the network
 *   3. Date.now() is frozen to the moment the fixtures were recorded
 *
 * (3) is not a convenience. The staleness guard compares fixture timestamps against
 * Date.now(), so with a live clock the fixtures rot: PLBC's P/E is dated 24/07/2026
 * and crosses the 30-day horizon a month after recording, at which point assertions
 * about its GARP score fail with the source unchanged. The README's claim is that the
 * suite does not move with the market. It must not move with the calendar either.
 * If you re-record the fixtures, move RECORDED_AT with them.
 *
 * The fixtures are real recorded API responses (see fixtures/data/), so the test
 * exercises the actual payload shapes, including the awkward ones like CULP's P/E
 * whose newest value is from 2022.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CDN = 'https://unpkg.com/lightweight-charts@5.2.0/dist/lightweight-charts.standalone.production.js';
const RECORDED_AT = '2026-07-26T12:00:00Z';   // see fixtures/README.md

const STUB = `<script>
(function(){
  const real = window.fetch;

  /* freeze the clock the staleness guard reads; new Date(x) is untouched because
     the app parses real timestamps with it */
  const FROZEN = Date.parse(${JSON.stringify(RECORDED_AT)});
  Date.now = () => FROZEN;
  window.__FROZEN_NOW = FROZEN;
  const HISTORY = { ORCL:'./data/orcl-history.json', CULP:'./data/culp-history.json',
                    PLBC:'./data/plbc-history.json' };
  const LIVE    = { CULP:'culp', PLBC:'plbc' };          // tickers with captured fundamentals
  const BY_CIK  = { '0000723603':'culp', '0001168455':'plbc' };
  window.__net = [];

  const ok   = p => real(p).then(r => r.json()).then(j => ({ ok:true, status:200, json:()=>Promise.resolve(j) }));
  const miss = s => Promise.resolve({ ok:false, status:s, json:()=>Promise.resolve({}) });

  window.fetch = function(u){
    u = String(u); window.__net.push(u);
    let m;
    if (u.includes('/history?')){
      const t = decodeURIComponent(u.match(/symbol\\/s\\/([^\\/]+)\\//)[1]).toUpperCase();
      return HISTORY[t] ? ok(HISTORY[t]) : miss(404);
    }
    if (u.includes('binance'))                             return u.includes('BTCUSDT') ? ok('./data/btc-klines.json') : miss(400);
    if (u.includes('equity-research-terminal/data.json'))   return ok('./data/universe-trimmed.json');
    if ((m = u.match(/\\/api\\/timeseries\\/s\\/([^\\/]+)\\/([^\\/?]+)/))){
      const d = LIVE[decodeURIComponent(m[1]).toUpperCase()];
      return d ? ok('./data/'+d+'/'+m[2]+'.json') : miss(404);
    }
    if ((m = u.match(/\\/api\\/quotes\\/s\\/([^\\/?]+)/))){
      const d = LIVE[decodeURIComponent(m[1]).toUpperCase()];
      return d ? ok('./data/'+d+'/quotes.json') : miss(404);
    }
    if ((m = u.match(/\\/api\\/symbol\\/s\\/([^\\/]+)\\/info/))){
      const d = LIVE[decodeURIComponent(m[1]).toUpperCase()];
      return d ? ok('./data/'+d+'/info.json') : miss(404);
    }
    if ((m = u.match(/data\\.sec\\.gov\\/submissions\\/CIK(\\d+)\\.json/)))
      return BY_CIK[m[1]] ? ok('./data/'+BY_CIK[m[1]]+'/sec.json') : miss(404);
    return miss(0);
  };

  /* Top-level let/const bindings are not properties of window, so the test
     cannot see them. Publish read-only views of the ones it asserts on. */
  window.addEventListener('load', () => setTimeout(() => { try {
    const get = (n, f) => Object.defineProperty(window, n, { get:f, configurable:true });
    get('__BARS', ()=>BARS); get('__IND', ()=>IND); get('__TECH', ()=>TECH);
    get('__LIVE_BAR', ()=>LIVE_BAR);
    get('__lines', ()=>priceLines); get('__fundCache', ()=>fundCache);
    Object.assign(window, {
      __chart:chart, __markers:markers, __brkMarkers:brkMarkers,
      __sma:sma, __ema:ema, __rsi:rsi, __profileLevels:profileLevels,
      __crossovers:crossovers, __trendState:trendState, __gateOpen:gateOpen,
      __lastLevelBreak:lastLevelBreak, __freshUpFlags:freshUpFlags,
      __evalConditions:evalConditions, __scoreAll:scoreAll, __buildHistory:buildHistory,
      __median:median, __pctlOf:pctlOf, __fmtDate:fmtDate,
      __garp:garp, __criterionApplies:criterionApplies, __verdictOf:verdictOf, __freshVal:freshVal,
      __fundFromUniverse:fundFromUniverse, __universeAge:universeAge, __universeUsable:universeUsable,
      __ageDays:ageDays, __dateLabel:dateLabel,
      __COND:COND, __LEVEL_COLOR:LEVEL_COLOR, __MAS:MAS, __resetView:resetView,
      __PROFILE_LOOKBACK:PROFILE_LOOKBACK, __FRESH_DAYS:FRESH_DAYS, __MAX_CHASE_PCT:MAX_CHASE_PCT,
      __FRESH_PRICE_DAYS:FRESH_PRICE_DAYS, __FRESH_STMT_DAYS:FRESH_STMT_DAYS,
      __RSI_LO:RSI_LO, __RSI_HI:RSI_HI,
      __setBARS:v => { BARS = v; }, __paintSeries:paintSeries, __applyQuote:applyQuote,
      __load:load, __renderAssessment:renderAssessment, __renderLevels:renderLevels,
      __setUnivMeta:m => { UNIV_META = m; }, __getUnivMeta:() => UNIV_META,
      __clearFundCache:() => { for (const k in fundCache) delete fundCache[k]; },
      __SECTOR_LABEL:SECTOR_LABEL,
      /* Non-transparent pixels on the volume-profile canvas. The histogram is drawn,
         not marked up, so this is the only way the suite can tell "profile shown"
         from "profile cleared". */
      __vpInk:() => {
        const cv = document.getElementById('vp');
        if (!cv || !cv.width || !cv.height) return 0;
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) n++;
        return n;
      },
    });
  } catch (e){ window.__hookErr = e.message; } }, 50));
})();
</script>
`;

function build(outDir){
  fs.mkdirSync(outDir, { recursive: true });
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  if (!html.includes(CDN)) throw new Error('CDN script tag not found in index.html. Did the version change?');
  /* Swap the whole <script> element, attributes and all. The shipped tag carries a
     hash for the CDN copy, which by definition will not match a local file. */
  const tagRe = /<script[^>]*src="[^"]*lightweight-charts[^"]*"[^>]*>\s*<\/script>/;
  if (!tagRe.test(html)) throw new Error('could not anchor the fetch stub');
  const tag = '<script src="./lwc.js"></script>';
  html = html.replace(tagRe, tag + '\n' + STUB);
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  /* index.html's first act is to check that the chart library loaded and to explain
     itself if it did not. The stub above always supplies the library, so that branch
     would never run under test; this variant points the tag at a file that is not
     there, which is what a blocked CDN or a failed SRI check looks like to the page. */
  fs.writeFileSync(path.join(outDir, 'no-lib.html'), html.replace('src="./lwc.js"', 'src="./absent.js"'));
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'lwc.js'), path.join(outDir, 'lwc.js'));
  fs.writeFileSync(path.join(outDir, 'favicon.ico'), '');
  // symlink the fixtures so the served tree can reach them without copying 1MB
  const link = path.join(outDir, 'data');
  if (!fs.existsSync(link)) fs.symlinkSync(path.join(__dirname, 'fixtures', 'data'), link, 'dir');
  return outDir;
}

module.exports = { build };
