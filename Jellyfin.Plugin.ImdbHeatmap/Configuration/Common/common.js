window.ImdbHeatmapApp = window.ImdbHeatmapApp || {};

(function (app) {
    'use strict';

    let pluginConfig = {
        enableHeatmap: true,
        enableChart: true,
        datasetBaseUrl: 'https://cdn.jsdelivr.net/gh/ya0903/imdb-episode-dataset@main/data/shows',
        cacheTtlHours: 24,
        invertGridDefault: false,
        language: 'auto'
    };

    let i18n = {
        Title: "IMDb Episodes Grid",
        Grid: "Grid",
        Chart: "Chart",
        Season: "Season",
        SeasonShort: "S",
        EpisodeShort: "E",
        EpisodeCumulative: "Cumulative Episode",
        ImdbRating: "IMDb Rating",
        Average: "Avg",
        Trend: "Trend",
        GlobalTrend: "Global Trend",
        InvertAxes: "Invert grid axes",
        NoSynopsis: "No synopsis available.",
        Loading: "Loading...",
        ViewEpisode: "View Episode",
        OpenOnImdb: "Open on IMDb"
    };

    const CFG = {
        styleId: 'jf-imdb-episodes-grid-style-v8',
        root: '[data-jf-ieg-root="1"]',
        watchDogMs: 800,
        maxWaitMs: 12000,
        readyAnchorWaitMs: 2200,
        reapplyDelayMs: 250,
        pollMs: 250,
        maxSeasons: 500,
        maxEpisodeSpan: 200,
        observerIdleMs: 250,
        retryMs: 5000
    };

    const INV_KEY = 'jf-imdb-episodes-grid-inverted-v1';
    const HOVER_TOOLTIP_ID = 'jf-hover-tooltip';

    let scheduled = null, burst = [], runSeq = 0, lastItemId = '';
    let hoverTimer = null, hoverCard = null, hoverX = 0, hoverY = 0;
    let anchorItem = '', anchorSince = 0;

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const q = (s, r = document) => r.querySelector(s);
    const qa = (s, r = document) => Array.from(r.querySelectorAll(s));

    const getSubpath = () => {
        const m = String(location.pathname || '').match(/^(.*?)\/web\/(?:index\.html)?$/i);
        return m ? m[1] : '';
    };

    const client = () => {
        const c = window.ApiClient;
        return c && typeof c.getJSON === 'function' && typeof c.getUrl === 'function' && typeof c.accessToken === 'function' && c.accessToken() ? c : null;
    };

    const api = async path => {
        const c = client();
        if (!c) throw new Error('ApiClient not ready');
        return c.getJSON(c.getUrl(path));
    };

    function injectStylesheet() {
        if (document.getElementById(CFG.styleId)) return;
        const c = client();
        const href = c ? c.getUrl('ImdbHeatmap/style.css') : (getSubpath() + '/ImdbHeatmap/style.css');
        const link = document.createElement('link');
        link.id = CFG.styleId;
        link.rel = 'stylesheet';
        link.type = 'text/css';
        link.href = href;
        document.head.appendChild(link);
    }

    async function fetchPluginConfig() {
        try {
            const c = client();
            if (c) {
                const cfgUrl = c.getUrl('ImdbHeatmap/Config');
                const res = await c.getJSON(cfgUrl);
                if (res) {
                    pluginConfig.enableHeatmap = res.EnableHeatmap !== false;
                    pluginConfig.enableChart = res.EnableChart !== false;
                    if (res.DatasetBaseUrl) pluginConfig.datasetBaseUrl = res.DatasetBaseUrl.replace(/\/+$/, '');
                    if (res.CacheTtlHours) pluginConfig.cacheTtlHours = res.CacheTtlHours;
                    if (typeof res.InvertGridDefault === 'boolean') pluginConfig.invertGridDefault = res.InvertGridDefault;
                    if (res.Language) pluginConfig.language = res.Language;
                }

                const userLang = (pluginConfig.language && pluginConfig.language !== 'auto')
                    ? pluginConfig.language
                    : (navigator.language || 'en');

                const transUrl = c.getUrl('ImdbHeatmap/Translations?lang=' + encodeURIComponent(userLang));
                const transRes = await c.getJSON(transUrl);
                if (transRes && typeof transRes === 'object') {
                    Object.assign(i18n, transRes);
                }
            }
        } catch {
            // fallback defaults
        }
    }

    const cacheGet = k => {
        try {
            const o = JSON.parse(sessionStorage.getItem(k) || 'null');
            if (!o || Date.now() > o.e) return null;
            return o.v;
        } catch {
            return null;
        }
    };

    const cacheSet = (k, v, ttl = (pluginConfig.cacheTtlHours * 3600000)) => {
        try {
            sessionStorage.setItem(k, JSON.stringify({ v, e: Date.now() + ttl }));
        } catch { }
    };

    const normId = s => { s = String(s || '').trim(); return s ? (s.startsWith('tt') ? s : 'tt' + s) : ''; };
    const toRating = v => { const n = typeof v === 'string' ? parseFloat(v) : Number(v); return Number.isFinite(n) && n > 0 && n <= 10 ? n : null; };

    const getInv = () => {
        try {
            const val = localStorage.getItem(INV_KEY);
            if (val !== null) return val === 'true';
            return pluginConfig.invertGridDefault;
        } catch {
            return pluginConfig.invertGridDefault;
        }
    };
    const setInv = v => { try { localStorage.setItem(INV_KEY, v ? 'true' : 'false'); } catch { } };

    const scheduleRun = d => { if (scheduled) clearTimeout(scheduled); scheduled = setTimeout(() => { scheduled = null; run(); }, typeof d === 'number' ? d : 0); };
    const scheduleBurst = arr => { burst.forEach(clearTimeout); burst = []; (arr || [0]).forEach(d => burst.push(setTimeout(run, d || 0))); };

    const failedAt = {};
    const retryBlocked = id => !!failedAt[id] && (Date.now() - failedAt[id]) < CFG.retryMs;

    const itemIdFromUrl = () => { const u = new URL(location.href); return u.searchParams.get('id') || (((u.hash || '').match(/[?&]id=([^&]+)/) || [])[1] ? decodeURIComponent(((u.hash || '').match(/[?&]id=([^&]+)/) || [])[1]) : null); };
    const serverIdFromUrl = () => { const u = new URL(location.href); return u.searchParams.get('serverId') || (((u.hash || '').match(/[?&]serverId=([^&]+)/) || [])[1] ? decodeURIComponent(((u.hash || '').match(/[?&]serverId=([^&]+)/) || [])[1]) : ''); };
    const detailsHash = (id, sid) => '/details?id=' + encodeURIComponent(id) + '&serverId=' + encodeURIComponent(sid);
    const webRoot = () => { const m = String(location.pathname || '').match(/^(.*\/web\/)(?:index\.html)?$/i); return m ? m[1] : (getSubpath() + '/web/'); };
    const detailsUrl = (id, sid) => location.origin + webRoot() + '#' + detailsHash(id, sid);
    const visible = el => { if (!el || !el.isConnected) return false; const cs = getComputedStyle(el), r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0' && r.width > 2 && r.height > 2; };
    const best = els => { let b = null, a = 0; for (const el of els) { if (!visible(el)) continue; const r = el.getBoundingClientRect(), x = r.width * r.height; if (x > a) { a = x; b = el; } } return b || els[els.length - 1] || null; };
    const isDetails = () => { const h = String(location.hash || ''); return h.includes('/details') && (h.includes('id=') || new URL(location.href).searchParams.get('id')); };
    const imdbFromItem = item => { const ids = item && item.ProviderIds || {}; for (const k of Object.keys(ids)) if (String(k).toLowerCase() === 'imdb') return normId(ids[k]); return ''; };

    const inflight = {};
    function fetchItem(id) { const k = 'ieg_item_' + id, c = cacheGet(k); if (c) return Promise.resolve(c); if (inflight[k]) return inflight[k]; inflight[k] = api('Items/' + encodeURIComponent(id) + '?Fields=ProviderIds').then(v => { cacheSet(k, v); return v; }).finally(() => { delete inflight[k]; }); return inflight[k]; }

    async function fetchDataset(imdbId) {
        const k = 'ieg_ds_' + imdbId, c = cacheGet(k); if (c !== null) return c;
        const baseUrl = pluginConfig.datasetBaseUrl.replace(/\/+$/, '');
        const r = await fetch(baseUrl + '/' + encodeURIComponent(imdbId) + '.json', { credentials: 'omit' });
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

    // Preact Loader
    let preactModulePromise = null;
    async function loadPreact() {
        if (window.PreactHtm) return window.PreactHtm;
        if (preactModulePromise) return preactModulePromise;

        preactModulePromise = (async () => {
            try {
                const module = await import('https://unpkg.com/htm@3.1.1/preact/standalone.module.js');
                window.PreactHtm = module;
                return module;
            } catch {
                const module = await import('https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js');
                window.PreactHtm = module;
                return module;
            }
        })();
        return preactModulePromise;
    }

    // Popover / Tooltip state tracking
    let isPopoverPinned = false;
    let popoverSeq = 0;
    let isMouseOverPopover = false;
    let hideTimer = null;

    function scheduleHideTooltip(delayMs = 400) {
        if (isPopoverPinned || isMouseOverPopover) return;
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            hideTimer = null;
            if (!isMouseOverPopover && !isPopoverPinned) {
                hideTooltip();
            }
        }, delayMs);
    }

    function getTooltip() {
        let t = document.getElementById(HOVER_TOOLTIP_ID);
        if (!t) {
            t = document.createElement('div');
            t.id = HOVER_TOOLTIP_ID;
            t.addEventListener('mouseenter', () => {
                isMouseOverPopover = true;
                if (hideTimer) {
                    clearTimeout(hideTimer);
                    hideTimer = null;
                }
            });
            t.addEventListener('mouseleave', () => {
                isMouseOverPopover = false;
                if (!isPopoverPinned) {
                    scheduleHideTooltip(200);
                }
            });
            document.body.appendChild(t);
        }
        return t;
    }

    function hideTooltip(force = false) {
        if (!force && (isPopoverPinned || isMouseOverPopover)) return;
        popoverSeq++;
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
        }
        clearTimeout(hoverTimer);
        hoverTimer = null;
        hoverCard = null;
        isPopoverPinned = false;
        isMouseOverPopover = false;
        const t = document.getElementById(HOVER_TOOLTIP_ID);
        if (t) {
            t.classList.remove('visible');
            t.classList.remove('interactive');
            t.classList.remove('has-actions');
        }
    }

    function positionTooltip(t, customX, customY) {
        const posX = typeof customX === 'number' ? customX : hoverX;
        const posY = typeof customY === 'number' ? customY : hoverY;

        if (window.innerWidth <= 600) {
            t.style.left = '12px';
            t.style.right = '12px';
            t.style.bottom = '16px';
            t.style.top = 'auto';
            t.style.width = 'auto';
            t.style.margin = '0 auto';
        } else {
            t.style.bottom = 'auto';
            t.style.right = 'auto';
            t.style.width = '320px';
            t.style.margin = '0';

            let x = posX + 15, y = posY + 15;
            const w = 320, h = t.offsetHeight || 200;
            if (x + w > window.innerWidth - 15) x = Math.max(10, posX - w - 10);
            if (y + h > window.innerHeight - 15) y = Math.max(10, posY - h - 10);

            t.style.left = x + 'px';
            t.style.top = y + 'px';
        }
    }

    async function fetchHoverItem(id) {
        if (!id) return null;
        const c = client(), uid = c && typeof c.getCurrentUserId === 'function' ? c.getCurrentUserId() : null;
        if (!uid) return null;
        try {
            return await api('Items/' + encodeURIComponent(id) + '?userId=' + encodeURIComponent(uid));
        } catch {
            return null;
        }
    }

    async function showEpisodePopover(epData, posX, posY, sid, isInteractive = false, showActionButton = true) {
        if (isPopoverPinned && !isInteractive) return;
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
        }
        const seq = ++popoverSeq;
        if (isInteractive) {
            isPopoverPinned = true;
        }

        let item = null;
        if (epData && epData.jfId) {
            item = await fetchHoverItem(epData.jfId);
        }

        if (seq !== popoverSeq) return;
        if (isPopoverPinned && !isInteractive) return;

        const t = getTooltip();
        const sNum = epData ? (epData.seasonNum || epData.snum) : null;
        const eNum = epData ? (epData.epNum || epData.ep) : null;
        const seasonEpPrefix = (sNum && eNum) ? `S${sNum}E${eNum} • ` : (eNum ? `E${eNum} • ` : '');
        const title = (item && item.Name) || (epData && epData.name) || (sNum && eNum ? `Episode ${eNum}` : 'Episode');
        const ratingVal = (item && item.CommunityRating != null) ? item.CommunityRating : (epData ? epData.rating : null);
        const ratingStr = (toRating(ratingVal) != null) ? `⭐ ${Number(ratingVal).toFixed(1)}` : '';
        const yearStr = (item && item.ProductionYear) || (epData && epData.airDate ? (new Date(epData.airDate).getFullYear() || '') : '');
        const genresStr = (item && item.Genres && item.Genres.slice) ? item.Genres.slice(0, 3).join(', ') : '';
        const overviewStr = (item && item.Overview) || (epData && epData.overview) || i18n.NoSynopsis;

        while (t.firstChild) t.removeChild(t.firstChild);

        if (isInteractive || window.innerWidth <= 600) {
            isPopoverPinned = true;
            t.classList.add('interactive');

            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.className = 'jf-tooltip-close';
            closeBtn.innerHTML = '&times;';
            closeBtn.setAttribute('aria-label', 'Close');
            closeBtn.addEventListener('click', e => {
                e.stopPropagation();
                hideTooltip(true);
            });
            t.appendChild(closeBtn);
        } else {
            isPopoverPinned = false;
            t.classList.remove('interactive');
        }

        const titleEl = document.createElement('div');
        titleEl.className = 'jf-tooltip-title';
        titleEl.textContent = seasonEpPrefix + title;
        t.appendChild(titleEl);

        const meta = document.createElement('div');
        meta.className = 'jf-tooltip-meta';
        const parts = [yearStr, ratingStr, genresStr].filter(Boolean);
        parts.forEach((p, i) => {
            if (i) {
                const sep = document.createElement('span');
                sep.className = 'jf-tooltip-sep';
                sep.textContent = '|';
                meta.appendChild(sep);
            }
            meta.appendChild(document.createTextNode(p));
        });
        t.appendChild(meta);

        const overviewEl = document.createElement('div');
        overviewEl.className = 'jf-tooltip-overview';
        overviewEl.textContent = overviewStr;
        t.appendChild(overviewEl);

        const targetJfId = (item && item.Id) || (epData && epData.jfId);
        const targetImdbId = epData && epData.imdbEpId;

        if (showActionButton && (targetJfId || targetImdbId)) {
            t.classList.add('has-actions');
            const actionDiv = document.createElement('div');
            actionDiv.className = 'jf-tooltip-actions';

            const actionBtn = document.createElement('a');
            actionBtn.className = 'jf-tooltip-btn emby-button button-submit';

            if (targetJfId && sid) {
                actionBtn.href = detailsUrl(targetJfId, sid);
                actionBtn.dataset.jfInternalId = targetJfId;
                actionBtn.textContent = '▶ ' + (i18n.ViewEpisode || 'View Episode');
                actionBtn.addEventListener('click', () => hideTooltip(true));
            } else if (targetImdbId) {
                actionBtn.href = 'https://www.imdb.com/title/' + encodeURIComponent(targetImdbId) + '/';
                actionBtn.target = '_blank';
                actionBtn.rel = 'noopener noreferrer';
                actionBtn.textContent = '↗ ' + (i18n.OpenOnImdb || 'Open on IMDb');
                actionBtn.addEventListener('click', () => hideTooltip(true));
            }

            actionDiv.appendChild(actionBtn);
            t.appendChild(actionDiv);
        } else {
            t.classList.remove('has-actions');
        }

        positionTooltip(t, posX, posY);
        t.classList.add('visible');
    }

    // Root App Component
    function createHeatmapApp(preact) {
        const { html, useState, useEffect } = preact;

        return function HeatmapApp({ itemId, imdbId, sid, seriesName }) {
            const [expanded, setExpanded] = useState(false);
            const [loading, setLoading] = useState(false);
            const [seasonsData, setSeasonsData] = useState(null);
            const [activeTab, setActiveTab] = useState('grid');

            const showHeatmap = pluginConfig.enableHeatmap;
            const showChart = pluginConfig.enableChart;

            useEffect(() => {
                if (expanded && !seasonsData && !loading) {
                    setLoading(true);
                    (async () => {
                        try {
                            await fetchPluginConfig();
                            const [jf, ds] = await Promise.all([
                                fetchJf(itemId).catch(() => ({ seasonsByNum: {}, seasonIds: {} })),
                                fetchDataset(imdbId).catch(() => null)
                            ]);
                            const merged = mergeData(ds, jf);
                            setSeasonsData(merged);
                        } catch (e) {
                            console.warn('[JF-IEG] Load error', e);
                            setSeasonsData([]);
                        } finally {
                            setLoading(false);
                        }
                    })();
                }
            }, [expanded, seasonsData, loading, itemId, imdbId]);

            const hasValidData = seasonsData && seasonsData.length > 0 && seasonsData.some(s => s.episodes.some(e => e.rating != null || e.name || e.jfId));

            const toggleExpand = () => setExpanded(!expanded);

            return html`
                <div class="jf-ieg-box">
                    <button type="button" class="jf-ieg-toggle" aria-expanded="${expanded}" onClick=${toggleExpand}>
                        <span class="jf-ieg-toggle-label">${i18n.Title}</span>
                        <span class="material-icons jf-ieg-toggle-icon" aria-hidden="true">expand_more</span>
                    </button>
                    ${expanded && html`
                        <div class="jf-ieg-panel">
                            <div class="jf-ieg-body">
                                ${loading && html`<div class="jf-ieg-status">${i18n.Loading}</div>`}
                                ${!loading && seasonsData && !hasValidData && html`
                                    <a class="jf-ieg-link emby-button button-link" href="https://www.imdb.com/title/${encodeURIComponent(imdbId)}/ratings/" target="_blank" rel="noopener noreferrer" is="emby-linkbutton">
                                        ${i18n.Title}
                                    </a>
                                `}
                                ${!loading && hasValidData && html`
                                    <div>
                                        ${showHeatmap && showChart && html`
                                            <div class="jf-ieg-tabs">
                                                <button type="button" class="jf-ieg-tab-btn ${activeTab === 'grid' ? 'active' : ''}" onClick=${() => setActiveTab('grid')}>
                                                    ${i18n.Grid}
                                                </button>
                                                <button type="button" class="jf-ieg-tab-btn ${activeTab === 'chart' ? 'active' : ''}" onClick=${() => setActiveTab('chart')}>
                                                    ${i18n.Chart}
                                                </button>
                                            </div>
                                        `}
                                        ${(showHeatmap && (!showChart || activeTab === 'grid')) && html`
                                            <div id="jf-ieg-grid-view" class="jf-ieg-tab-content">
                                                <${app.HeatmapGrid} seasons=${seasonsData} imdbId=${imdbId} sid=${sid} seriesName=${seriesName} />
                                            </div>
                                        `}
                                        ${(showChart && (!showHeatmap || activeTab === 'chart')) && html`
                                            <div id="jf-ieg-chart-view" class="jf-ieg-tab-content jf-ieg-chart-container">
                                                <${app.RatingChart} seasons=${seasonsData} imdbId=${imdbId} sid=${sid} />
                                            </div>
                                        `}
                                    </div>
                                `}
                            </div>
                        </div>
                    `}
                </div>
            `;
        };
    }

    async function mountRoot(target, itemId, imdbId, sid, seriesName) {
        cleanup(itemId);
        let block = currentBlock(itemId);
        if (block && (block.dataset.imdbId !== imdbId || block.dataset.serverId !== sid)) {
            block.remove();
            block = null;
        }
        if (!block) {
            block = document.createElement('section');
            block.setAttribute('data-jf-ieg-root', '1');
            block.dataset.itemId = itemId;
            block.dataset.imdbId = imdbId;
            block.dataset.serverId = sid || '';
            block.dataset.seriesName = seriesName || '';
            target.parent.insertBefore(block, target.before);

            const preact = await loadPreact();
            const AppComp = createHeatmapApp(preact);
            preact.render(preact.html`<${AppComp} itemId=${itemId} imdbId=${imdbId} sid=${sid} seriesName=${seriesName} />`, block);
        } else if (block.nextSibling !== target.before) {
            target.parent.insertBefore(block, target.before);
        }
    }

    const currentBlock = id => qa(CFG.root).find(el => el.dataset.itemId === id) || null;
    const cleanup = id => qa(CFG.root).forEach(el => { if (el.dataset.itemId !== id) el.remove(); });
    const removeAll = () => qa(CFG.root).forEach(el => el.remove());
    const findInsertTarget = () => {
        const cast = best(qa('#castCollapsible'));
        if (cast && cast.parentNode) return { parent: cast.parentNode, before: cast };
        const ph = best(qa('#peopleHeader'));
        const sec = ph ? ph.closest('.verticalSection, .detailVerticalSection, .emby-scroller-container') : null;
        return sec && sec.parentNode && visible(sec) ? { parent: sec.parentNode, before: sec } : null;
    };
    const findOfficialImdbLink = id => id ? best(qa('a[href*="imdb.com/title/"]').filter(a => a.isConnected && !a.closest(CFG.root) && visible(a) && ((a.getAttribute('href') || '').match(/imdb\.com\/(?:[a-z]{2}\/)?title\/(tt\d+)/i) || [])[1] === id)) : null;

    async function run() {
        const seq = ++runSeq;
        injectStylesheet();
        if (!isDetails()) {
            burst.forEach(clearTimeout);
            burst = [];
            removeAll();
            hideTooltip(true);
            return;
        }
        const itemId = itemIdFromUrl();
        if (!itemId || retryBlocked(itemId)) return;
        let item;
        try {
            item = await fetchItem(itemId);
        } catch (e) {
            if (client()) {
                failedAt[itemId] = Date.now();
                console.warn('[JF-IEG] Item request failed', e);
            }
            return;
        }
        if (seq !== runSeq || !item) return;
        if (item.Type !== 'Series') {
            removeAll();
            hideTooltip(true);
            return;
        }
        const imdbId = imdbFromItem(item);
        if (!imdbId) {
            removeAll();
            hideTooltip(true);
            return;
        }
        const sid = serverIdFromUrl();
        if (!sid) return;

        const existing = currentBlock(itemId);
        if (existing && existing.dataset.imdbId === imdbId && existing.dataset.serverId === sid && existing.isConnected && visible(existing)) return;

        if (anchorItem !== itemId) {
            anchorItem = itemId;
            anchorSince = Date.now();
        }
        const started = Date.now();
        let target = null;
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
        await mountRoot(target, itemId, imdbId, sid, item.Name || '');
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

    document.addEventListener('click', e => {
        const off = e.target.closest && e.target.closest('a[aria-disabled="true"]');
        if (off) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        const a = e.target.closest('a[data-jf-internal-id]');
        if (!a) return;
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        const id = a.dataset.jfInternalId || '';
        if (!id) return;
        e.preventDefault();
        e.stopPropagation();
        const sid = serverIdFromUrl();
        location.hash = detailsHash(id, sid);
    }, true);

    let watchPending = null;
    const watchCheck = () => {
        watchPending = null;
        if (!isDetails()) return;
        const id = itemIdFromUrl() || '';
        if (!id) return;
        const b = currentBlock(id);
        if (!b || !b.isConnected || !visible(b)) scheduleRun(CFG.reapplyDelayMs);
    };
    if (document.body) new MutationObserver(() => {
        if (watchPending) return;
        watchPending = setTimeout(watchCheck, CFG.observerIdleMs);
    }).observe(document.body, { childList: true, subtree: true });

    setInterval(() => {
        if (!isDetails()) return;
        const id = itemIdFromUrl() || '', b = id ? currentBlock(id) : null;
        if (id && id !== lastItemId) {
            lastItemId = id;
            scheduleBurst([0, 350, 900]);
            return;
        }
        if (id && (!b || !b.isConnected || !visible(b))) scheduleRun(CFG.reapplyDelayMs);
    }, CFG.watchDogMs);

    // Export shared functions for Heatmap and Chart components
    app.i18n = i18n;
    app.getInv = getInv;
    app.setInv = setInv;
    app.toRating = toRating;
    app.detailsUrl = detailsUrl;
    app.loadPreact = loadPreact;
    app.showEpisodePopover = showEpisodePopover;
    app.hideTooltip = hideTooltip;
    app.scheduleHideTooltip = scheduleHideTooltip;
    app.isPopoverPinned = () => isPopoverPinned;
    app.isMouseOverPopover = () => isMouseOverPopover;

    scheduleRun(0);
})(window.ImdbHeatmapApp);
