(function () {
    'use strict';
    const CFG = { title: 'IMDb Episodes Grid', styleId: 'jf-imdb-episodes-grid-style-v8', root: '[data-jf-ieg-root="1"]', datasetBase: 'https://cdn.jsdelivr.net/gh/ya0903/imdb-episode-dataset@main/data/shows', watchDogMs: 800, maxWaitMs: 12000, readyAnchorWaitMs: 2200, reapplyDelayMs: 250, pollMs: 250, maxSeasons: 500, maxEpisodeSpan: 200, observerIdleMs: 250, retryMs: 5000, ttl: 86400000 };
    const INV_KEY = 'jf-imdb-episodes-grid-inverted-v1';
    const HOVER_STYLE_ID = 'jf-hover-tooltip-style';
    const HOVER_TOOLTIP_ID = 'jf-hover-tooltip';
    let scheduled = null, burst = [], runSeq = 0, lastItemId = '';
    let hoverTimer = null, hoverCard = null, hoverX = 0, hoverY = 0;
    let anchorItem = '', anchorSince = 0;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const q = (s, r = document) => r.querySelector(s);
    const qa = (s, r = document) => Array.from(r.querySelectorAll(s));
    const cacheGet = k => { try { const o = JSON.parse(sessionStorage.getItem(k) || 'null'); if (!o || Date.now() > o.e) return null; return o.v; } catch { return null; } };
    const cacheSet = (k, v, ttl = CFG.ttl) => { try { sessionStorage.setItem(k, JSON.stringify({ v, e: Date.now() + ttl })); } catch { } };
    const normId = s => { s = String(s || '').trim(); return s ? (s.startsWith('tt') ? s : 'tt' + s) : ''; };
    const toRating = v => { const n = typeof v === 'string' ? parseFloat(v) : Number(v); return Number.isFinite(n) && n > 0 && n <= 10 ? n : null; };
    const getInv = () => { try { return localStorage.getItem(INV_KEY) === 'true'; } catch { return false; } };
    const setInv = v => { try { localStorage.setItem(INV_KEY, v ? 'true' : 'false'); } catch { } };
    const scheduleRun = d => { if (scheduled) clearTimeout(scheduled); scheduled = setTimeout(() => { scheduled = null; run(); }, typeof d === 'number' ? d : 0); };
    const scheduleBurst = arr => { burst.forEach(clearTimeout); burst = []; (arr || [0]).forEach(d => burst.push(setTimeout(run, d || 0))); };
    const client = () => { const c = window.ApiClient; return c && typeof c.getJSON === 'function' && typeof c.getUrl === 'function' && typeof c.accessToken === 'function' && c.accessToken() ? c : null; };
    const api = async path => { const c = client(); if (!c) throw new Error('ApiClient not ready'); return c.getJSON(c.getUrl(path)); };
    const failedAt = {};
    const retryBlocked = id => !!failedAt[id] && (Date.now() - failedAt[id]) < CFG.retryMs;
    const itemIdFromUrl = () => { const u = new URL(location.href); return u.searchParams.get('id') || (((u.hash || '').match(/[?&]id=([^&]+)/) || [])[1] ? decodeURIComponent(((u.hash || '').match(/[?&]id=([^&]+)/) || [])[1]) : null); };
    const serverIdFromUrl = () => { const u = new URL(location.href); return u.searchParams.get('serverId') || (((u.hash || '').match(/[?&]serverId=([^&]+)/) || [])[1] ? decodeURIComponent(((u.hash || '').match(/[?&]serverId=([^&]+)/) || [])[1]) : ''); };
    const detailsHash = (id, sid) => '/details?id=' + encodeURIComponent(id) + '&serverId=' + encodeURIComponent(sid);
    const webRoot = () => { const m = String(location.pathname || '').match(/^(.*\/web\/)(?:index\.html)?$/i); return m ? m[1] : '/web/'; };
    const detailsUrl = (id, sid) => location.origin + webRoot() + '#' + detailsHash(id, sid);
    const visible = el => { if (!el || !el.isConnected) return false; const cs = getComputedStyle(el), r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0' && r.width > 2 && r.height > 2; };
    const best = els => { let b = null, a = 0; for (const el of els) { if (!visible(el)) continue; const r = el.getBoundingClientRect(), x = r.width * r.height; if (x > a) { a = x; b = el; } } return b || els[els.length - 1] || null; };
    const isDetails = () => { const h = String(location.hash || ''); return h.includes('/details') && (h.includes('id=') || new URL(location.href).searchParams.get('id')); };
    const imdbFromItem = item => { const ids = item && item.ProviderIds || {}; for (const k of Object.keys(ids)) if (String(k).toLowerCase() === 'imdb') return normId(ids[k]); return ''; };

    const inflight = {};
    function fetchItem(id) { const k = 'ieg_item_' + id, c = cacheGet(k); if (c) return Promise.resolve(c); if (inflight[k]) return inflight[k]; inflight[k] = api('Items/' + encodeURIComponent(id) + '?Fields=ProviderIds').then(v => { cacheSet(k, v); return v; }).finally(() => { delete inflight[k]; }); return inflight[k]; }

    async function fetchDataset(imdbId) {
        const k = 'ieg_ds_' + imdbId, c = cacheGet(k); if (c !== null) return c;
        const r = await fetch(CFG.datasetBase + '/' + encodeURIComponent(imdbId) + '.json', { credentials: 'omit' });
        if (r.status === 404) { cacheSet(k, null); return null; }
        if (!r.ok) throw new Error('dataset ' + r.status);
        const show = await r.json();
        if (!show || typeof show !== 'object' || Array.isArray(show)) { cacheSet(k, null); return null; }
        const seasons = show.seasons;
        if (!seasons || typeof seasons !== 'object' || Array.isArray(seasons)) { cacheSet(k, null); return null; }
        const nums = Object.keys(seasons).map(Number).filter(n => Number.isInteger(n) && n > 0 && n <= CFG.maxSeasons);
        if (!nums.length) { cacheSet(k, null); return null; }
        const max = Math.max(...nums), out = [];
        for (let s = 1; s <= max; s++) {
            const eps = Object.entries(seasons[String(s)] || {}).map(([n, d]) => ({ episode: parseInt(n, 10), rating: toRating(d && d.r), id: normId((d && ((d.i) || (d.id) || (d.imdb) || (d.imdbId))) || '') })).filter(e => Number.isFinite(e.episode) && e.episode > 0).sort((a, b) => a.episode - b.episode);
            out.push(eps);
        }
        const val = out.some(a => a.length) ? out : null; cacheSet(k, val); return val;
    }

    async function fetchJf(seriesId) {
        const k = 'ieg_jf_' + seriesId, c = cacheGet(k); if (c) return c;
        let epsFailed = false, ssFailed = false;
        const [epsRes, ssRes] = await Promise.all([
            api('Shows/' + encodeURIComponent(seriesId) + '/Episodes?Fields=ProviderIds,CommunityRating,IndexNumberEnd,ParentIndexNumber,IndexNumber,Name,PremiereDate&EnableImages=false&EnableUserData=false&Limit=20000').catch(() => { epsFailed = true; return { Items: [] }; }),
            api('Shows/' + encodeURIComponent(seriesId) + '/Seasons?Fields=IndexNumber&EnableImages=false&EnableUserData=false').catch(() => { ssFailed = true; return { Items: [] }; })
        ]);
        if (epsFailed) throw new Error('episodes request failed');
        const seasonsByNum = {}, seasonIds = {};
        for (const s of (ssRes.Items || [])) { const n = Number(s && s.IndexNumber); if (Number.isFinite(n) && n > 0) seasonIds[n] = s.Id || ''; }
        for (const ep of (epsRes.Items || [])) {
            const sn = Number(ep && ep.ParentIndexNumber), en = Number(ep && ep.IndexNumber);
            if (!Number.isFinite(sn) || !Number.isFinite(en) || sn < 1 || en < 1) continue;
            const end = typeof ep.IndexNumberEnd === 'number' && Number.isFinite(ep.IndexNumberEnd) && ep.IndexNumberEnd >= en ? Math.min(ep.IndexNumberEnd, en + CFG.maxEpisodeSpan) : en;
            if (!seasonsByNum[sn]) seasonsByNum[sn] = [];
            seasonsByNum[sn].push({ ep: en, epEnd: end, jfId: ep.Id || '', name: ep.Name || '', airDate: ep.PremiereDate || '', imdbEpId: normId((ep.ProviderIds && (ep.ProviderIds.Imdb || ep.ProviderIds.imdb)) || ''), rating: toRating(ep && ep.CommunityRating) });
        }
        const val = { seasonsByNum, seasonIds }; if (!ssFailed) cacheSet(k, val); return val;
    }

    function mergeData(ds, jf) {
        const nums = [0, ...Object.keys(jf.seasonsByNum || {}).map(Number).filter(Number.isFinite), ...(ds ? ds.map((_, i) => i + 1) : [])], max = Math.min(Math.max(...nums), CFG.maxSeasons), out = [];
        for (let s = 1; s <= max; s++) {
            const byEp = {}, jfList = (jf.seasonsByNum[s] || []), dsList = ((ds && ds[s - 1]) || []);
            for (const e of dsList) if (e && Number.isFinite(e.episode) && e.episode > 0) byEp[e.episode] = { ep: e.episode, exists: true, rating: toRating(e.rating), imdbEpId: e.id || '', jfId: '', name: '', airDate: '', combined: false };
            for (const j of jfList) {
                const start = Number(j.ep), end = Number(j.epEnd) >= start ? Number(j.epEnd) : start;
                for (let n = start; n <= end; n++) {
                    if (!byEp[n]) byEp[n] = { ep: n, exists: true, rating: null, imdbEpId: '', jfId: '', name: '', airDate: '', combined: end > start };
                    const x = byEp[n];
                    if (x.rating == null && j.rating != null) x.rating = j.rating;
                    if (!x.imdbEpId && j.imdbEpId) x.imdbEpId = j.imdbEpId;
                    if (!x.jfId && j.jfId) x.jfId = j.jfId;
                    if (!x.name && j.name) x.name = j.name;
                    if (!x.airDate && j.airDate) x.airDate = j.airDate;
                    if (end > start) x.combined = true;
                }
            }
            const episodes = Object.values(byEp).sort((a, b) => a.ep - b.ep);
            if (episodes.length) out.push({ num: s, seasonJfId: jf.seasonIds[s] || '', episodes });
        }
        return out;
    }

    function ratingStyle(r) {
        const v = toRating(r); if (v == null) return '';
        let h = 0, s = 78, l = 16;
        if (v >= 9.5) { h = 92; s = 100; l = 51.5; }
        else if (v >= 9.0) { h = 120; s = 100; l = 45; }
        else if (v >= 8.0) { h = 84; s = 98; l = 30.6; }
        else if (v >= 7.0) { h = 32; s = 88; l = 20; }
        else if (v >= 6.0) { h = 18; s = 90; l = 19; }
        else if (v >= 5.0) { h = 10; s = 84; l = 17; }
        else if (v >= 4.0) { h = 6; s = 82; l = 15; }
        else if (v >= 3.0) { h = 3; s = 80; l = 14; }
        else if (v >= 2.0) { h = 1; s = 78; l = 13; }
        else { h = 0; s = 76; l = 12; }
        const frac = v % 1, lb = frac * (v >= 7 ? 7 : 3.8), light = Math.min(l + lb, v >= 7 ? 72 : 26), a = v >= 7 ? (.82 + frac * .12) : (.92 + frac * .04);
        let glow = 'inset 0 1px 0 rgba(255,255,255,.06)';
        if (v >= 9.8) glow = '0 0 8px rgba(255,240,28,.24),0 0 16px rgba(255,240,28,.12),inset 0 1px 0 rgba(255,255,255,.12)';
        else if (v >= 9.7) glow = '0 0 8px rgba(146,255,74,.28),0 0 16px rgba(146,255,74,.13),inset 0 1px 0 rgba(255,255,255,.11)';
        else if (v >= 9.6) glow = '0 0 6px rgba(86,255,72,.22),0 0 12px rgba(86,255,72,.10),inset 0 1px 0 rgba(255,255,255,.10)';
        else if (v >= 9.0) glow = '0 0 5px hsla(' + h + ',' + s + '%,' + (light + 8) + '%,.28),inset 0 1px 0 rgba(255,255,255,.08)';
        return 'background:hsla(' + h + ',' + s + '%,' + light + '%,' + a + ');border-color:hsla(' + h + ',' + s + '%,' + Math.min(light + (v >= 7 ? 18 : 10), v >= 7 ? 85 : 34) + '%,.30);color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.70),0 0 1px rgba(0,0,0,.55);box-shadow:' + glow + ';';
    }

    function injectStyle() {
        if (document.getElementById(CFG.styleId)) return;
        const s = document.createElement('style'); s.id = CFG.styleId; s.textContent = `
${CFG.root}{--c1:2.72rem;--c2:3.05rem;--rh:2.36rem;--axis:rgba(34,34,40,.84);--axis2:rgba(48,48,56,.90);margin:.85em 0 1.1em;position:relative;z-index:3;clear:both;width:100%;max-width:calc(100% - 3.15rem)}
.jf-ieg-box{border-radius:12px;overflow:hidden;background:rgba(18,18,18,.26);border:1px solid rgba(255,255,255,.08)}
.jf-ieg-toggle{width:100%;display:flex;align-items:center;gap:.42rem;border:0;margin:0;padding:.72rem .95rem;cursor:pointer;color:inherit;background:rgba(255,255,255,.03);text-align:left;font:inherit;outline:none !important;box-shadow:none !important;-webkit-tap-highlight-color:transparent}.jf-ieg-toggle:hover{background:rgba(255,255,255,.05)}.jf-ieg-toggle-label{font-size:1.05rem;font-weight:700;line-height:1.2}.jf-ieg-toggle-icon{transition:transform .16s ease;opacity:.92;flex:0 0 auto}.jf-ieg-toggle[aria-expanded="true"] .jf-ieg-toggle-icon{transform:rotate(180deg)}
.jf-ieg-panel{border-top:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.09);overflow:hidden}.jf-ieg-panel[hidden]{display:none !important}
.jf-ieg-body{padding:.72rem .82rem .82rem;background:rgba(0,0,0,.06)}
.jf-ieg-status{font-size:.92rem;opacity:.9;padding:.15rem .05rem}.jf-ieg-link{color:inherit !important;text-decoration:none !important;font-weight:700}
.jf-ieg-tabs{display:flex;gap:.8rem;margin-bottom:.8rem;border-bottom:1px solid rgba(255,255,255,.1);padding-bottom:.4rem}
.jf-ieg-tab-btn{background:0 0;border:0;color:rgba(255,255,255,.5);cursor:pointer;font:inherit;font-size:1rem;font-weight:700;padding:.2rem .4rem;transition:color .2s}
.jf-ieg-tab-btn:hover{color:rgba(255,255,255,.8)}.jf-ieg-tab-btn.active{color:#fff;border-bottom:2px solid #10b981}
.jf-ieg-scroll{overflow-x:auto;overflow-y:auto;max-height:500px;padding-bottom:.08rem;padding-right:.55rem;max-width:100%}
.jf-ieg-grid{display:grid;column-gap:.26rem;row-gap:.26rem;align-items:stretch;min-width:max-content;grid-auto-rows:var(--rh)}
.jf-ieg-cell{height:var(--rh);min-height:var(--rh);max-height:var(--rh);display:flex;align-items:center;justify-content:center;text-align:center;border-radius:8px;box-sizing:border-box;padding:.18rem .24rem;line-height:1;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);font-size:.86rem;position:relative;flex:0 0 auto}
.jf-ieg-season,.jf-ieg-rating,.jf-ieg-empty,.jf-ieg-ghost{width:var(--c1);min-width:var(--c1);max-width:var(--c1)}.jf-ieg-episode{width:var(--c2);min-width:var(--c2);max-width:var(--c2)}.jf-ieg-episode-compact,.jf-ieg-corner-compact{width:var(--c1);min-width:var(--c1);max-width:var(--c1)}.jf-ieg-corner-wide{width:var(--c2);min-width:var(--c2);max-width:var(--c2)}
.jf-ieg-corner{position:sticky;left:0;z-index:6;background:var(--axis) !important;border-color:rgba(255,255,255,.14) !important;box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}
.jf-ieg-corner-btn{cursor:pointer;outline:none !important;-webkit-tap-highlight-color:transparent;color:inherit}.jf-ieg-corner-btn:hover{background:var(--axis2) !important;border-color:rgba(255,255,255,.24) !important}.jf-ieg-corner-icon{width:1rem;height:1rem;display:block;opacity:.92;transition:transform .16s ease,opacity .16s ease;pointer-events:none;color:inherit}
.jf-ieg-season,.jf-ieg-episode{font-weight:700;background:var(--axis) !important;font-size:.89rem;color:inherit !important;text-decoration:none !important;outline:none !important;box-shadow:inset 0 1px 0 rgba(255,255,255,.05) !important;border-color:rgba(255,255,255,.14) !important}
.jf-ieg-season:hover,.jf-ieg-episode:hover{background:var(--axis2) !important;border-color:rgba(255,255,255,.24) !important}
.jf-ieg-sticky-left{position:sticky;left:0;z-index:5;background:var(--axis) !important;border-color:rgba(255,255,255,.14) !important;box-shadow:inset 0 1px 0 rgba(255,255,255,.05) !important}
.jf-ieg-axis-match{background:var(--axis2) !important;border-color:rgba(255,255,255,.30) !important;box-shadow:0 0 0 1px rgba(255,255,255,.04),inset 0 1px 0 rgba(255,255,255,.05) !important}
.jf-ieg-rating{cursor:pointer;font-family:inherit !important;font-weight:700 !important;font-size:1.28rem;letter-spacing:-.01em;font-variant-numeric:tabular-nums;transition:filter .16s ease,border-color .16s ease,box-shadow .16s ease;text-decoration:none !important;outline:none !important;color:#fff !important;z-index:1}.jf-ieg-rating:hover{filter:brightness(1.36) saturate(1.42) contrast(1.12);border-color:rgba(255,255,255,.22)}
.jf-ieg-rating-96{filter:brightness(1.26) saturate(1.34) contrast(1.10);text-shadow:0 1px 0 rgba(0,0,0,.88),0 0 1px rgba(0,0,0,.58),0 0 5px rgba(86,255,72,.26),0 0 10px rgba(86,255,72,.11) !important}
.jf-ieg-rating-97{filter:brightness(1.32) saturate(1.40) contrast(1.12);text-shadow:0 1px 0 rgba(0,0,0,.90),0 0 1px rgba(0,0,0,.60),0 0 6px rgba(146,255,74,.32),0 0 12px rgba(146,255,74,.15) !important}
.jf-ieg-rating-98plus{filter:brightness(1.36) saturate(1.42) contrast(1.12);text-shadow:0 1px 0 rgba(0,0,0,.90),0 0 1px rgba(0,0,0,.60),0 0 6px rgba(255,240,28,.34),0 0 12px rgba(255,240,28,.18) !important}
.jf-ieg-rating-96:hover{filter:brightness(1.34) saturate(1.40) contrast(1.12) !important;box-shadow:0 0 8px rgba(86,255,72,.30),0 0 16px rgba(86,255,72,.15),0 0 22px rgba(86,255,72,.08),inset 0 0 0 1px rgba(255,255,255,.05),inset 0 1px 0 rgba(255,255,255,.04) !important}
.jf-ieg-rating-97:hover{filter:brightness(1.40) saturate(1.46) contrast(1.13) !important;box-shadow:0 0 10px rgba(146,255,74,.36),0 0 19px rgba(146,255,74,.20),0 0 26px rgba(146,255,74,.11),inset 0 0 0 1px rgba(255,255,255,.06),inset 0 1px 0 rgba(255,255,255,.05) !important}
.jf-ieg-rating-98plus:hover{filter:brightness(1.40) saturate(1.46) contrast(1.13) !important;box-shadow:0 0 10px rgba(255,240,28,.38),0 0 19px rgba(255,240,28,.22),0 0 28px rgba(255,240,28,.12),inset 0 0 0 1px rgba(255,255,255,.06),inset 0 1px 0 rgba(255,255,255,.05) !important}
.jf-ieg-empty{cursor:pointer;font-weight:800;font-size:1.02rem;color:rgba(255,255,255,.76) !important;text-decoration:none !important;outline:none !important;background:rgba(112,112,124,.18) !important;border-color:rgba(220,220,230,.12) !important;box-shadow:inset 0 1px 0 rgba(255,255,255,.04) !important}.jf-ieg-empty:hover{filter:brightness(1.10);border-color:rgba(255,255,255,.18) !important}
.jf-ieg-ghost{opacity:0;pointer-events:none;background:transparent !important;border-color:transparent !important;box-shadow:none !important}
@media (max-width:900px){${CFG.root}{max-width:calc(100% - .4rem)}.jf-ieg-body{padding:.72rem .42rem .82rem .42rem !important}.jf-ieg-scroll{padding-right:.12rem !important}}
`; document.head.appendChild(s);
    }

    function ensureHoverStyle() {
        if (document.getElementById(HOVER_STYLE_ID)) return;
        const s = document.createElement('style'); s.id = HOVER_STYLE_ID; s.textContent = '#' + HOVER_TOOLTIP_ID + '{position:fixed;z-index:99999;background:rgba(15,15,15,.95);color:#fff;padding:16px;border-radius:12px;width:320px;box-shadow:0 12px 40px rgba(0,0,0,.85);border:1px solid rgba(255,255,255,.15);backdrop-filter:blur(12px);pointer-events:none;opacity:0;transition:opacity .2s ease-in-out;display:none;font-family:inherit;box-sizing:border-box}#' + HOVER_TOOLTIP_ID + '.interactive{pointer-events:auto !important}#' + HOVER_TOOLTIP_ID + '.visible{opacity:1;display:block}.jf-tooltip-close{position:absolute;top:8px;right:10px;background:transparent;border:0;color:rgba(255,255,255,.6);font-size:1.4rem;line-height:1;cursor:pointer;padding:2px 6px;border-radius:4px}.jf-tooltip-close:hover{color:#fff;background:rgba(255,255,255,.15)}.jf-tooltip-title{font-size:1.1em;font-weight:800;margin:0 0 6px;color:#fff;line-height:1.25;padding-right:22px}.jf-tooltip-meta{font-size:.8em;color:#10b981;margin-bottom:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}.jf-tooltip-sep{color:#666;margin:0 5px}.jf-tooltip-overview{font-size:.85em;line-height:1.5;color:#d1d5db;display:-webkit-box;-webkit-line-clamp:5;line-clamp:5;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:8px}.jf-tooltip-actions{margin-top:12px;display:flex;gap:8px}.jf-tooltip-btn{display:inline-flex;align-items:center;justify-content:center;background:#10b981 !important;color:#fff !important;font-weight:700 !important;font-size:.88rem !important;padding:8px 14px !important;border-radius:8px !important;text-decoration:none !important;border:none !important;cursor:pointer;transition:background .15s ease;width:100%;box-sizing:border-box}.jf-tooltip-btn:hover{background:#059669 !important}@media (max-width:600px){#' + HOVER_TOOLTIP_ID + '{position:fixed !important;left:12px !important;right:12px !important;bottom:16px !important;top:auto !important;width:auto !important;max-width:calc(100vw - 24px) !important;border-radius:16px !important;box-shadow:0 -8px 32px rgba(0,0,0,.9) !important;pointer-events:auto !important}}'; document.head.appendChild(s);
    }
    let isPopoverPinned = false;
    function getTooltip() { let t = document.getElementById(HOVER_TOOLTIP_ID); if (!t) { t = document.createElement('div'); t.id = HOVER_TOOLTIP_ID; document.body.appendChild(t); } return t; }
    function hideTooltip(force = false) { if (!force && isPopoverPinned) return; clearTimeout(hoverTimer); hoverTimer = null; hoverCard = null; isPopoverPinned = false; const t = document.getElementById(HOVER_TOOLTIP_ID); if (t) { t.classList.remove('visible'); t.classList.remove('interactive'); } }
    function positionTooltip(t, customX, customY) {
        const posX = typeof customX === 'number' ? customX : hoverX, posY = typeof customY === 'number' ? customY : hoverY;
        if (window.innerWidth <= 600) { t.style.left = '12px'; t.style.right = '12px'; t.style.bottom = '16px'; t.style.top = 'auto'; t.style.width = 'auto'; t.style.margin = '0 auto'; }
        else { t.style.bottom = 'auto'; t.style.right = 'auto'; t.style.width = '320px'; t.style.margin = '0'; let x = posX + 15, y = posY + 15; const w = 320, h = t.offsetHeight || 200; if (x + w > window.innerWidth - 15) x = Math.max(10, posX - w - 10); if (y + h > window.innerHeight - 15) y = Math.max(10, posY - h - 10); t.style.left = x + 'px'; t.style.top = y + 'px'; }
    }
    async function fetchHoverItem(id) { if (!id) return null; const c = client(), uid = c && typeof c.getCurrentUserId === 'function' ? c.getCurrentUserId() : null; if (!uid) return null; try { return await api('Items/' + encodeURIComponent(id) + '?userId=' + encodeURIComponent(uid)); } catch { return null; } }
    async function showEpisodePopover(epData, posX, posY, sid, isInteractive = false, showActionButton = true) {
        if (isPopoverPinned && !isInteractive) return;
        ensureHoverStyle();
        const t = getTooltip(); let item = null;
        if (epData && epData.jfId) item = await fetchHoverItem(epData.jfId);
        const sNum = epData ? (epData.seasonNum || epData.snum) : null, eNum = epData ? (epData.epNum || epData.ep) : null;
        const seasonEpPrefix = (sNum && eNum) ? `S${sNum}E${eNum} • ` : (eNum ? `E${eNum} • ` : '');
        const title = (item && item.Name) || (epData && epData.name) || (sNum && eNum ? `Episode ${eNum}` : 'Episode');
        const ratingVal = (item && item.CommunityRating != null) ? item.CommunityRating : (epData ? epData.rating : null);
        const ratingStr = (toRating(ratingVal) != null) ? `⭐ ${Number(ratingVal).toFixed(1)}` : '';
        const yearStr = (item && item.ProductionYear) || (epData && epData.airDate ? (new Date(epData.airDate).getFullYear() || '') : '');
        const genresStr = (item && item.Genres && item.Genres.slice) ? item.Genres.slice(0, 3).join(', ') : '';
        const overviewStr = (item && item.Overview) || (epData && epData.overview) || 'No synopsis available.';
        t.textContent = '';
        if (isInteractive || window.innerWidth <= 600) {
            isPopoverPinned = true; t.classList.add('interactive');
            const closeBtn = document.createElement('button'); closeBtn.type = 'button'; closeBtn.className = 'jf-tooltip-close'; closeBtn.innerHTML = '&times;'; closeBtn.setAttribute('aria-label', 'Close');
            closeBtn.addEventListener('click', e => { e.stopPropagation(); hideTooltip(true); }); t.appendChild(closeBtn);
        } else { isPopoverPinned = false; t.classList.remove('interactive'); }
        const titleEl = document.createElement('div'); titleEl.className = 'jf-tooltip-title'; titleEl.textContent = seasonEpPrefix + title; t.appendChild(titleEl);
        const meta = document.createElement('div'); meta.className = 'jf-tooltip-meta';
        const parts = [yearStr, ratingStr, genresStr].filter(Boolean);
        parts.forEach((p, i) => { if (i) { const sep = document.createElement('span'); sep.className = 'jf-tooltip-sep'; sep.textContent = '|'; meta.appendChild(sep); } meta.appendChild(document.createTextNode(p)); });
        t.appendChild(meta);
        const overviewEl = document.createElement('div'); overviewEl.className = 'jf-tooltip-overview'; overviewEl.textContent = overviewStr; t.appendChild(overviewEl);
        const targetJfId = (item && item.Id) || (epData && epData.jfId), targetImdbId = epData && epData.imdbEpId;
        if (showActionButton && (targetJfId || targetImdbId)) {
            const actionDiv = document.createElement('div'); actionDiv.className = 'jf-tooltip-actions';
            const actionBtn = document.createElement('a'); actionBtn.className = 'jf-tooltip-btn emby-button button-submit';
            if (targetJfId && sid) { actionBtn.href = detailsUrl(targetJfId, sid); actionBtn.dataset.jfInternalId = targetJfId; actionBtn.textContent = '▶ View Episode'; actionBtn.addEventListener('click', () => hideTooltip(true)); }
            else if (targetImdbId) { actionBtn.href = 'https://www.imdb.com/title/' + encodeURIComponent(targetImdbId) + '/'; actionBtn.target = '_blank'; actionBtn.rel = 'noopener noreferrer'; actionBtn.textContent = '↗ Open on IMDb'; actionBtn.addEventListener('click', () => hideTooltip(true)); }
            actionDiv.appendChild(actionBtn); t.appendChild(actionDiv);
        }
        positionTooltip(t, posX, posY); t.classList.add('visible');
    }
    function bindCellHover(el, epData, sid) {
        if (!el || el.dataset.jfHoverBound === '1') return;
        el.dataset.jfHoverBound = '1';
        const jfId = typeof epData === 'string' ? epData : (epData && epData.jfId);
        const dataObj = typeof epData === 'object' && epData !== null ? epData : { jfId };
        el.addEventListener('mouseenter', e => { if (isPopoverPinned) return; hoverCard = el; hoverX = e.clientX; hoverY = e.clientY; clearTimeout(hoverTimer); hoverTimer = setTimeout(async () => { if (hoverCard !== el || isPopoverPinned) return; await showEpisodePopover(dataObj, hoverX, hoverY, sid, false, false); }, 500); });
        el.addEventListener('mousemove', e => { if (isPopoverPinned) return; hoverX = e.clientX; hoverY = e.clientY; const t = document.getElementById(HOVER_TOOLTIP_ID); if (t && t.classList.contains('visible')) positionTooltip(t, hoverX, hoverY); });
        el.addEventListener('mouseleave', () => { if (hoverCard === el) hoverCard = null; if (!isPopoverPinned) hideTooltip(); });
        el.addEventListener('click', async e => { if (window.innerWidth <= 600 || !dataObj.jfId) { await showEpisodePopover(dataObj, e.clientX, e.clientY, sid, true, false); } else { hideTooltip(true); } });
    }

    function clearAxisHighlight(scope) { qa('.jf-ieg-axis-match', scope).forEach(el => el.classList.remove('jf-ieg-axis-match')); }
    function setAxisHighlight(scope, snum, epnum) {
        clearAxisHighlight(scope);
        if (snum != null) { const x = q('[data-jf-axis-season="' + snum + '"]', scope); if (x) x.classList.add('jf-ieg-axis-match'); }
        if (epnum != null) { const x = q('[data-jf-axis-episode="' + epnum + '"]', scope); if (x) x.classList.add('jf-ieg-axis-match'); }
    }
    function bindAxisHover(el, scope, snum, epnum) {
        if (!el || el.dataset.jfAxisBound === '1') return;
        el.dataset.jfAxisBound = '1';
        el.addEventListener('mouseenter', () => setAxisHighlight(scope, snum, epnum));
        el.addEventListener('mouseleave', () => clearAxisHighlight(scope));
        el.addEventListener('focus', () => setAxisHighlight(scope, snum, epnum), true);
        el.addEventListener('blur', () => clearAxisHighlight(scope), true);
    }

    function bindInternalNav(root, sid) {
        root.addEventListener('click', e => { const off = e.target.closest && e.target.closest('a[aria-disabled="true"]'); if (off && root.contains(off)) { e.preventDefault(); e.stopPropagation(); return; } const a = e.target.closest('a[data-jf-internal-id]'); if (!a || !root.contains(a)) return; if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; const id = a.dataset.jfInternalId || ''; if (!id) return; e.preventDefault(); e.stopPropagation(); location.hash = detailsHash(id, sid); }, true);
    }

    function renderFallback(body, imdbId) {
        body.innerHTML = '';
        const a = document.createElement('a'); a.className = 'jf-ieg-link emby-button button-link'; a.href = 'https://www.imdb.com/title/' + encodeURIComponent(imdbId) + '/ratings/'; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.setAttribute('is', 'emby-linkbutton'); a.textContent = CFG.title; body.appendChild(a);
    }

    function renderGrid(body, seasons, imdbId, sid, seriesName) {
        body.innerHTML = '';
        const inverted = getInv();
        const allEpNums = [...new Set(seasons.flatMap(s => s.episodes.map(e => e.ep)).filter(n => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
        const scroll = document.createElement('div'); scroll.className = 'jf-ieg-scroll';
        const grid = document.createElement('div'); grid.className = 'jf-ieg-grid';
        grid.style.gridTemplateColumns = inverted ? 'var(--c1) repeat(' + allEpNums.length + ', var(--c1))' : 'var(--c2) repeat(' + seasons.length + ', var(--c1))';

        const corner = document.createElement('button');
        corner.type = 'button';
        corner.className = 'jf-ieg-cell jf-ieg-corner jf-ieg-corner-btn ' + (inverted ? 'jf-ieg-corner-compact' : 'jf-ieg-corner-wide');
        corner.setAttribute('aria-label', 'Invert grid axes');
        corner.innerHTML = '<svg class="jf-ieg-corner-icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="color:inherit"><path d="M2.5 4.5H11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M8.5 2L11 4.5 8.5 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.5 11.5H5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M7.5 9L5 11.5 7.5 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        grid.appendChild(corner);

        const mkSeason = s => {
            const a = document.createElement('a');
            a.className = 'jf-ieg-cell jf-ieg-season';
            a.textContent = 'S' + s.num;
            a.title = (seriesName || CFG.title) + ' - Saison ' + String(s.num).padStart(2, '0');
            a.dataset.jfAxisSeason = String(s.num);
            if (s.seasonJfId && sid) { a.href = detailsUrl(s.seasonJfId, sid); a.dataset.jfInternalId = s.seasonJfId; a.classList.add('emby-button', 'button-link'); }
            else { a.href = 'https://www.imdb.com/title/' + encodeURIComponent(imdbId) + '/episodes/?season=' + s.num; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.setAttribute('is', 'emby-linkbutton'); a.classList.add('emby-button', 'button-link'); }
            return a;
        };

        const mkEpHead = (n, sticky, compact) => {
            const d = document.createElement('div');
            d.className = 'jf-ieg-cell jf-ieg-episode' + (compact ? ' jf-ieg-episode-compact' : '') + (sticky ? ' jf-ieg-sticky-left' : '');
            d.textContent = 'E' + n;
            d.dataset.jfAxisEpisode = String(n);
            return d;
        };

        const mkGhost = () => { const d = document.createElement('div'); d.className = 'jf-ieg-cell jf-ieg-ghost'; d.setAttribute('aria-hidden', 'true'); return d; };

        const mkEmpty = (ep, snum) => {
            const a = document.createElement('a'); a.className = 'jf-ieg-cell jf-ieg-empty'; a.textContent = '-';
            if (ep.jfId && sid) { a.href = detailsUrl(ep.jfId, sid); a.dataset.jfInternalId = ep.jfId; a.classList.add('emby-button', 'button-link'); bindCellHover(a, ep.jfId); }
            else { a.href = ep.imdbEpId ? ('https://www.imdb.com/title/' + encodeURIComponent(ep.imdbEpId) + '/') : ('https://www.imdb.com/title/' + encodeURIComponent(imdbId) + '/episodes/?season=' + snum); a.target = '_blank'; a.rel = 'noopener noreferrer'; a.setAttribute('is', 'emby-linkbutton'); a.classList.add('emby-button', 'button-link'); }
            bindAxisHover(a, grid, snum, ep.ep);
            return a;
        };

        const mkRate = (ep, snum) => {
            if (!ep || ep.exists !== true) return mkGhost();
            if (toRating(ep.rating) == null) return mkEmpty(ep, snum);
            const a = document.createElement('a'); a.className = 'jf-ieg-cell jf-ieg-rating'; a.textContent = Number(ep.rating).toFixed(1); a.style.cssText = ratingStyle(ep.rating);
            if (ep.rating >= 9.8) a.classList.add('jf-ieg-rating-98plus');
            else if (ep.rating >= 9.7) a.classList.add('jf-ieg-rating-97');
            else if (ep.rating >= 9.6) a.classList.add('jf-ieg-rating-96');
            if (ep.jfId && sid) { a.href = detailsUrl(ep.jfId, sid); a.dataset.jfInternalId = ep.jfId; a.classList.add('emby-button', 'button-link'); bindCellHover(a, ep.jfId); }
            else { a.href = ep.imdbEpId ? ('https://www.imdb.com/title/' + encodeURIComponent(ep.imdbEpId) + '/') : ('https://www.imdb.com/title/' + encodeURIComponent(imdbId) + '/episodes/?season=' + snum); a.target = '_blank'; a.rel = 'noopener noreferrer'; a.setAttribute('is', 'emby-linkbutton'); a.classList.add('emby-button', 'button-link'); }
            bindAxisHover(a, grid, snum, ep.ep);
            return a;
        };

        if (!inverted) {
            for (const s of seasons) grid.appendChild(mkSeason(s));
            for (const n of allEpNums) {
                grid.appendChild(mkEpHead(n, true, false));
                for (const s of seasons) grid.appendChild(mkRate(s.episodes.find(e => e.ep === n), s.num));
            }
        } else {
            for (const n of allEpNums) grid.appendChild(mkEpHead(n, false, true));
            for (const s of seasons) {
                const sh = mkSeason(s); sh.classList.add('jf-ieg-sticky-left'); grid.appendChild(sh);
                for (const n of allEpNums) grid.appendChild(mkRate(s.episodes.find(e => e.ep === n), s.num));
            }
        }

        corner.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); setInv(!getInv()); renderGrid(body, seasons, imdbId, sid, seriesName); });
        scroll.appendChild(grid); body.appendChild(scroll); bindInternalNav(scroll, sid);
    }

    async function loadChartJs() {
        if (window.Chart) return window.Chart;
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/chart.js';
            s.onload = () => resolve(window.Chart);
            s.onerror = reject;
            document.head.appendChild(s);
        });
    }

    function calcTrend(data) {
        const n = data.length;
        if (n < 2) return data;
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        data.forEach(p => { sumX += p.x; sumY += p.y; sumXY += p.x * p.y; sumXX += p.x * p.x; });
        const denom = (n * sumXX - sumX * sumX);
        if (denom === 0) return data;
        const m = (n * sumXY - sumX * sumY) / denom;
        const b = (sumY - m * sumX) / n;
        return [{ x: data[0].x, y: m * data[0].x + b }, { x: data[n - 1].x, y: m * data[n - 1].x + b }];
    }

    function makeLegendIcon(shape, color) {
        const cx = 20, cy = 10;
        let p = '';
        switch (shape) {
            case 'triangle': p = `<polygon points="${cx},${cy - 5} ${cx - 4.5},${cy + 4.5} ${cx + 4.5},${cy + 4.5}" fill="${color}"/>`; break;
            case 'rect': p = `<rect x="${cx - 4}" y="${cy - 4}" width="8" height="8" fill="${color}"/>`; break;
            case 'rectRot': p = `<rect x="${cx - 4}" y="${cy - 4}" width="8" height="8" fill="${color}" transform="rotate(45 ${cx} ${cy})"/>`; break;
            case 'star': p = `<polygon points="${cx},${cy - 5} ${cx + 1.5},${cy - 1.5} ${cx + 5},${cy - 1.5} ${cx + 2},${cy + 1} ${cx + 3},${cy + 5} ${cx},${cy + 3} ${cx - 3},${cy + 5} ${cx - 2},${cy + 1} ${cx - 5},${cy - 1.5} ${cx - 1.5},${cy - 1.5}" fill="${color}"/>`; break;
            case 'cross': p = `<path d="M${cx - 4} ${cy - 1} h3 v-3 h2 v3 h3 v2 h-3 v3 h-2 v-3 h-3 z" fill="${color}"/>`; break;
            default: p = `<circle cx="${cx}" cy="${cy}" r="4" fill="${color}"/>`; break; // circle
        }
        const svg = `<svg width="40" height="20" xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="10" x2="40" y2="10" stroke="${color}" stroke-width="2" stroke-dasharray="4,4"/>${p}</svg>`;
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        return img;
    }

    function makeLineIcon(color) {
        const svg = `<svg width="40" height="20" xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="10" x2="40" y2="10" stroke="${color}" stroke-width="4"/></svg>`;
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        return img;
    }

    async function renderChart(container, seasons, imdbId, sid) {
        await loadChartJs();
        container.innerHTML = '<canvas></canvas>';
        const canvas = container.querySelector('canvas');
        const ctx = canvas.getContext('2d');

        let globalCount = 1;
        const allData = [];
        const datasets = [];
        const shapes = ['circle', 'triangle', 'rect', 'rectRot', 'star', 'cross'];

        seasons.forEach((s, i) => {
            const hue = (i * 137.5) % 360;
            const color = `hsl(${hue}, 70%, 65%)`;
            const sData = [];

            s.episodes.forEach(ep => {
                if (ep.rating != null) {
                    sData.push({
                        x: globalCount,
                        y: ep.rating,
                        name: ep.name || `S${s.num}E${ep.ep}`,
                        jfId: ep.jfId || '',
                        imdbEpId: ep.imdbEpId || '',
                        seasonNum: s.num,
                        epNum: ep.ep,
                        airDate: ep.airDate || ''
                    });
                }
                globalCount++;
            });

            if (sData.length > 0) {
                allData.push(...sData);

                const avg = (sData.reduce((acc, val) => acc + val.y, 0) / sData.length).toFixed(2);
                const shape = shapes[i % shapes.length];
                const customImg = makeLegendIcon(shape, color);

                datasets.push({
                    label: `Saison ${s.num} (Moy: ${avg})`,
                    data: sData,
                    backgroundColor: color,
                    borderColor: color,
                    type: 'scatter',
                    pointStyle: shape,
                    pointRadius: 5,
                    pointHoverRadius: 8,
                    customLegendImg: customImg
                });
                datasets.push({
                    label: `Tendance S${s.num}`,
                    data: calcTrend(sData),
                    type: 'line',
                    borderColor: color,
                    borderDash: [5, 5],
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: false
                });
            }
        });

        if (allData.length > 1) {
            const globalColor = 'rgba(255, 255, 255, 0.8)';
            datasets.push({
                label: 'Tendance Globale',
                data: calcTrend(allData),
                type: 'line',
                borderColor: globalColor,
                borderWidth: 4,
                pointRadius: 0,
                fill: false,
                customLegendImg: makeLineIcon(globalColor)
            });
        }

        new window.Chart(ctx, {
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                onHover: (event, chartElements, chart) => {
                    canvas.style.cursor = (chartElements && chartElements.length) ? 'pointer' : 'default';
                    if (isPopoverPinned) return;

                    if (chartElements && chartElements.length) {
                        const el = chartElements[0];
                        const dataset = chart.data.datasets[el.datasetIndex];
                        if (dataset && dataset.data) {
                            const pt = dataset.data[el.index];
                            if (pt && (pt.jfId || pt.imdbEpId || pt.seasonNum)) {
                                hoverX = event.native ? event.native.clientX : hoverX;
                                hoverY = event.native ? event.native.clientY : hoverY;
                                showEpisodePopover(pt, hoverX, hoverY, sid, false);
                                return;
                            }
                        }
                    }
                    if (!isPopoverPinned) hideTooltip();
                },
                onClick: (event, elements, chart) => {
                    if (!elements || !elements.length) {
                        hideTooltip(true);
                        return;
                    }
                    const el = elements[0];
                    const dataset = chart.data.datasets[el.datasetIndex];
                    if (!dataset || !dataset.data) return;
                    const pt = dataset.data[el.index];
                    if (!pt || (!pt.jfId && !pt.imdbEpId && !pt.seasonNum)) return;

                    const clickX = event.native ? event.native.clientX : hoverX;
                    const clickY = event.native ? event.native.clientY : hoverY;

                    showEpisodePopover(pt, clickX, clickY, sid, true);
                },
                plugins: {
                    tooltip: {
                        enabled: false
                    },
                    legend: {
                        labels: {
                            color: '#fff',
                            usePointStyle: true,
                            boxWidth: 45,
                            boxHeight: 20,
                            pointStyleWidth: 45,
                            padding: 25,
                            generateLabels: function (chart) {
                                const original = window.Chart.defaults.plugins.legend.labels.generateLabels(chart);
                                return original.filter(l => !l.text.startsWith('Tendance S')).map(l => {
                                    const ds = chart.data.datasets[l.datasetIndex];
                                    if (ds.customLegendImg) l.pointStyle = ds.customLegendImg;
                                    return l;
                                });
                            }
                        },
                        onClick: function (e, legendItem, legend) {
                            const index = legendItem.datasetIndex;
                            const chart = legend.chart;
                            const meta = chart.getDatasetMeta(index);
                            const ds = chart.data.datasets[index];

                            const isHidden = meta.hidden === null ? !ds.hidden : null;
                            meta.hidden = isHidden;

                            if (ds.label.startsWith('Saison')) {
                                const trendMeta = chart.getDatasetMeta(index + 1);
                                if (trendMeta && chart.data.datasets[index + 1].label.startsWith('Tendance S')) {
                                    trendMeta.hidden = isHidden;
                                }
                            }
                            chart.update();
                        }
                    }
                },
                scales: {
                    x: { type: 'linear', title: { display: true, text: 'Épisode (Cumulé)', color: '#fff' }, ticks: { color: '#bbb' } },
                    y: { title: { display: true, text: 'Note IMDb', color: '#fff' }, ticks: { color: '#bbb' }, min: Math.max(0, Math.min(...allData.map(d => d.y)) - 1), max: 10 }
                }
            }
        });
    }

    async function loadPanel(root) {
        if (root.dataset.loaded === '1' || root.dataset.loading === '1') return;
        root.dataset.loading = '1';
        const body = q('.jf-ieg-body', root); if (!body) { root.dataset.loading = '0'; return; }
        body.innerHTML = '<div class="jf-ieg-status">Loading…</div>';
        try {
            const imdbId = root.dataset.imdbId, seriesId = root.dataset.itemId, sid = root.dataset.serverId || '', seriesName = root.dataset.seriesName || '';
            const [jf, ds] = await Promise.all([fetchJf(seriesId).catch(() => ({ seasonsByNum: {}, seasonIds: {} })), fetchDataset(imdbId).catch(() => null)]);
            const seasons = mergeData(ds, jf);
            body.innerHTML = '';
            if (!seasons.length || !seasons.some(s => s.episodes.some(e => e.rating != null || e.name || e.jfId))) {
                renderFallback(body, imdbId);
            } else {
                body.innerHTML = `
        <div class="jf-ieg-tabs">
          <button type="button" class="jf-ieg-tab-btn active" data-target="grid">Grille</button>
          <button type="button" class="jf-ieg-tab-btn" data-target="chart">Graphique</button>
        </div>
        <div id="jf-ieg-grid-view" class="jf-ieg-tab-content"></div>
        <div id="jf-ieg-chart-view" class="jf-ieg-tab-content" hidden style="height: 500px; width: 100%;"></div>
      `;
                const gridView = body.querySelector('#jf-ieg-grid-view');
                const chartView = body.querySelector('#jf-ieg-chart-view');
                const tabs = body.querySelectorAll('.jf-ieg-tab-btn');

                renderGrid(gridView, seasons, imdbId, sid, seriesName);
                let chartRendered = false;

                tabs.forEach(btn => {
                    btn.addEventListener('click', async () => {
                        tabs.forEach(t => t.classList.remove('active'));
                        btn.classList.add('active');
                        if (btn.dataset.target === 'grid') {
                            gridView.hidden = false;
                            chartView.hidden = true;
                        } else {
                            gridView.hidden = true;
                            chartView.hidden = false;
                            if (!chartRendered) {
                                await renderChart(chartView, seasons, imdbId, sid);
                                chartRendered = true;
                            }
                        }
                    });
                });
            }
            root.dataset.loaded = '1';
        } catch (e) {
            console.warn('[JF-IEG] Panel load failed', e);
            renderFallback(body, root.dataset.imdbId);
            root.dataset.loaded = '1';
        } finally { root.dataset.loading = '0'; }
    }

    function createBlock(itemId, imdbId, sid, seriesName) {
        const root = document.createElement('section');
        root.setAttribute('data-jf-ieg-root', '1');
        root.dataset.itemId = itemId; root.dataset.imdbId = imdbId; root.dataset.serverId = sid || ''; root.dataset.seriesName = seriesName || ''; root.dataset.loaded = '0'; root.dataset.loading = '0';
        root.innerHTML = '<div class="jf-ieg-box"><button type="button" class="jf-ieg-toggle" aria-expanded="false"><span class="jf-ieg-toggle-label">' + CFG.title + '</span><span class="material-icons jf-ieg-toggle-icon" aria-hidden="true">expand_more</span></button><div class="jf-ieg-panel" hidden><div class="jf-ieg-body"></div></div></div>';
        const t = q('.jf-ieg-toggle', root), p = q('.jf-ieg-panel', root);
        t.addEventListener('click', () => { const ex = t.getAttribute('aria-expanded') === 'true', nx = !ex; t.setAttribute('aria-expanded', nx ? 'true' : 'false'); p.hidden = !nx; if (nx) loadPanel(root); });
        return root;
    }

    const currentBlock = id => qa(CFG.root).find(el => el.dataset.itemId === id) || null;
    const cleanup = id => qa(CFG.root).forEach(el => { if (el.dataset.itemId !== id) el.remove(); });
    const removeAll = () => qa(CFG.root).forEach(el => el.remove());
    const findInsertTarget = () => { const cast = best(qa('#castCollapsible')); if (cast && cast.parentNode) return { parent: cast.parentNode, before: cast }; const ph = best(qa('#peopleHeader')); const sec = ph ? ph.closest('.verticalSection, .detailVerticalSection, .emby-scroller-container') : null; return sec && sec.parentNode && visible(sec) ? { parent: sec.parentNode, before: sec } : null; };
    const findOfficialImdbLink = id => id ? best(qa('a[href*="imdb.com/title/"]').filter(a => a.isConnected && !a.closest(CFG.root) && visible(a) && ((a.getAttribute('href') || '').match(/imdb\.com\/(?:[a-z]{2}\/)?title\/(tt\d+)/i) || [])[1] === id)) : null;

    function ensureMounted(itemId, imdbId, sid, seriesName, target) {
        cleanup(itemId);
        let block = currentBlock(itemId);
        if (block && (block.dataset.imdbId !== imdbId || block.dataset.serverId !== sid)) { block.remove(); block = null; }
        if (!block) { block = createBlock(itemId, imdbId, sid, seriesName); target.parent.insertBefore(block, target.before); }
        else if (block.nextSibling !== target.before) target.parent.insertBefore(block, target.before);
    }

    async function run() {
        const seq = ++runSeq; injectStyle();
        if (!isDetails()) { burst.forEach(clearTimeout); burst = []; removeAll(); hideTooltip(true); return; }
        const itemId = itemIdFromUrl(); if (!itemId || retryBlocked(itemId)) return;
        let item; try { item = await fetchItem(itemId); } catch (e) { if (client()) { failedAt[itemId] = Date.now(); console.warn('[JF-IEG] Item request failed', e); } return; }
        if (seq !== runSeq || !item) return;
        if (item.Type !== 'Series') { removeAll(); hideTooltip(true); return; }
        const imdbId = imdbFromItem(item); if (!imdbId) { removeAll(); hideTooltip(true); return; }
        const sid = serverIdFromUrl(); if (!sid) return;
        const existing = currentBlock(itemId);
        if (existing && existing.dataset.imdbId === imdbId && existing.dataset.serverId === sid && existing.isConnected && visible(existing)) return;
        if (anchorItem !== itemId) { anchorItem = itemId; anchorSince = Date.now(); }
        const started = Date.now(); let target = null;
        while (Date.now() - started < CFG.maxWaitMs) {
            if (seq !== runSeq) return;
            if (itemIdFromUrl() !== itemId) return;
            target = findInsertTarget();
            const hasLink = findOfficialImdbLink(imdbId);
            if (target && hasLink) break;
            if (target && Date.now() - anchorSince >= CFG.readyAnchorWaitMs) break;
            await sleep(CFG.pollMs);
        }
        if (seq !== runSeq || !target) return;
        ensureMounted(itemId, imdbId, sid, item.Name || '', target);
    }

    window.addEventListener('hashchange', () => { hideTooltip(true); scheduleRun(0); }, true);
    window.addEventListener('popstate', () => { hideTooltip(true); scheduleRun(0); }, true);
    document.addEventListener('viewshow', () => { hideTooltip(true); scheduleRun(0); }, true);
    document.addEventListener('viewbeforeshow', () => { hideTooltip(true); scheduleRun(0); }, true);

    document.addEventListener('click', e => {
        const t = document.getElementById(HOVER_TOOLTIP_ID);
        if (!t || !t.classList.contains('visible')) return;
        if (t.contains(e.target)) return;
        if (e.target.closest && (e.target.closest('.jf-ieg-cell') || e.target.closest('canvas') || e.target.closest(CFG.root))) return;
        hideTooltip(true);
    }, true);

    let watchPending = null;
    const watchCheck = () => { watchPending = null; if (!isDetails()) return; const id = itemIdFromUrl() || ''; if (!id) return; const b = currentBlock(id); if (!b || !b.isConnected || !visible(b)) scheduleRun(CFG.reapplyDelayMs); };
    if (document.body) new MutationObserver(() => { if (watchPending) return; watchPending = setTimeout(watchCheck, CFG.observerIdleMs); }).observe(document.body, { childList: true, subtree: true });

    setInterval(() => { if (!isDetails()) return; const id = itemIdFromUrl() || '', b = id ? currentBlock(id) : null; if (id && id !== lastItemId) { lastItemId = id; scheduleBurst([0, 350, 900]); return; } if (id && (!b || !b.isConnected || !visible(b))) scheduleRun(CFG.reapplyDelayMs); }, CFG.watchDogMs);

    scheduleRun(0);
})();