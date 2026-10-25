window.ImdbHeatmapApp = window.ImdbHeatmapApp || {};

(function (app) {
    'use strict';

    function createCornerIcon(html) {
        return html`
            <svg class="jf-ieg-corner-icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="color:inherit">
                <path d="M2.5 4.5H11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                <path d="M8.5 2L11 4.5 8.5 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M13.5 11.5H5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                <path d="M7.5 9L5 11.5 7.5 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;
    }

    const RATING_COLORS = [
        { min: 9.5, h: 210, s: 90, l: 52 },
        { min: 9.0, h: 145, s: 72, l: 24 },
        { min: 8.0, h: 122, s: 58, l: 44 },
        { min: 7.0, h: 48, s: 90, l: 53 },
        { min: 6.0, h: 25, s: 88, l: 51 },
        { min: 5.0, h: 0, s: 78, l: 45 },
        { min: 0, h: 275, s: 55, l: 43 }
    ];

    function applyRatingStyleProperties(r) {
        const v = app.toRating(r);
        if (v == null) return {};
        const { h, s, l } = RATING_COLORS.find(c => v >= c.min);
        const borderL = Math.min(l + 18, 85);
        let glow = 'inset 0 1px 0 rgba(255,255,255,.06)';
        if (v >= 9.5) glow = '0 0 6px hsla(' + h + ',' + s + '%,' + (l + 10) + '%,.30),0 0 12px hsla(' + h + ',' + s + '%,' + (l + 10) + '%,.12),inset 0 1px 0 rgba(255,255,255,.10)';

        return {
            '--rhue': h.toString(),
            '--rs': s + '%',
            '--rl': l + '%',
            '--ra': '0.92',
            '--rb': borderL + '%',
            '--rg': glow
        };
    }

    const average = eps => {
        const rated = eps.map(e => app.toRating(e && e.rating)).filter(r => r != null);
        return rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null;
    };

    async function initHeatmapComponent() {
        const preact = await app.loadPreact();
        const { html, useState, useRef } = preact;

        function HeatmapGrid({ seasons, imdbId, sid, seriesName }) {
            const [inverted, setInverted] = useState(app.getInv());
            const gridRef = useRef(null);

            const toggleInvert = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const next = !inverted;
                setInverted(next);
                app.setInv(next);
            };

            const clearAxisHighlight = () => {
                if (!gridRef.current) return;
                const matches = gridRef.current.querySelectorAll('.jf-ieg-axis-match');
                matches.forEach(el => el.classList.remove('jf-ieg-axis-match'));
            };

            const setAxisHighlight = (snum, epnum) => {
                clearAxisHighlight();
                if (!gridRef.current) return;
                if (snum != null) {
                    const x = gridRef.current.querySelector('[data-jf-axis-season="' + snum + '"]');
                    if (x) x.classList.add('jf-ieg-axis-match');
                }
                if (epnum != null) {
                    const x = gridRef.current.querySelector('[data-jf-axis-episode="' + epnum + '"]');
                    if (x) x.classList.add('jf-ieg-axis-match');
                }
            };

            const allEpNums = [...new Set(seasons.flatMap(s => s.episodes.map(e => e.ep)).filter(n => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
            const gridStyle = {
                gridTemplateColumns: inverted ? 'var(--c1) repeat(' + (allEpNums.length + 1) + ', var(--c1))' : 'var(--c2) repeat(' + seasons.length + ', var(--c1))'
            };

            const renderSeasonHead = (s, isStickyLeft = false) => {
                const isJf = s.seasonJfId && sid;
                const href = isJf ? app.detailsUrl(s.seasonJfId, sid) : ('https://www.imdb.com/title/' + encodeURIComponent(imdbId) + '/episodes/?season=' + s.num);
                const titleText = (seriesName || app.i18n.Title) + ' - ' + (app.i18n.Season || 'Season') + ' ' + String(s.num).padStart(2, '0');
                const className = 'jf-ieg-cell jf-ieg-season emby-button button-link' + (isStickyLeft ? ' jf-ieg-sticky-left' : '');

                return html`
                    <a className=${className}
                       href=${href}
                       title=${titleText}
                       data-jf-axis-season=${String(s.num)}
                       data-jf-internal-id=${isJf ? s.seasonJfId : null}
                       target=${isJf ? null : '_blank'}
                       rel=${isJf ? null : 'noopener noreferrer'}>
                        ${(app.i18n.SeasonShort || 'S') + s.num}
                    </a>
                `;
            };

            const renderEpHead = (n, sticky = false, compact = false) => {
                const className = 'jf-ieg-cell jf-ieg-episode' + (compact ? ' jf-ieg-episode-compact' : '') + (sticky ? ' jf-ieg-sticky-left' : '');
                return html`
                    <div className=${className} data-jf-axis-episode=${String(n)}>
                        ${(app.i18n.EpisodeShort || 'E') + n}
                    </div>
                `;
            };

            const renderCell = (ep, snum) => {
                if (!ep || ep.exists !== true) {
                    return html`<div className="jf-ieg-cell jf-ieg-ghost" aria-hidden="true"></div>`;
                }

                const rVal = app.toRating(ep.rating);
                const isJf = ep.jfId && sid;
                const href = isJf ? app.detailsUrl(ep.jfId, sid) : (ep.imdbEpId ? ('https://www.imdb.com/title/' + encodeURIComponent(ep.imdbEpId) + '/') : ('https://www.imdb.com/title/' + encodeURIComponent(imdbId) + '/episodes/?season=' + snum));

                const epDataObj = { jfId: ep.jfId, imdbEpId: ep.imdbEpId, name: ep.name, seasonNum: snum, epNum: ep.ep, rating: ep.rating, airDate: ep.airDate };

                const handleMouseEnter = (e) => {
                    if (app.isPopoverPinned()) return;
                    app.showEpisodePopover(epDataObj, e.clientX, e.clientY, sid, false, false);
                };

                const handleMouseLeave = () => {
                    if (!app.isPopoverPinned() && !app.isMouseOverPopover()) {
                        app.scheduleHideTooltip(300);
                    }
                    clearAxisHighlight();
                };

                const handleClick = (e) => {
                    if (window.innerWidth <= 600 || !epDataObj.jfId) {
                        app.showEpisodePopover(epDataObj, e.clientX, e.clientY, sid, true, false);
                    } else {
                        app.hideTooltip(true);
                    }
                };

                if (rVal == null) {
                    return html`
                        <a className="jf-ieg-cell jf-ieg-empty emby-button button-link"
                           href=${href}
                           data-jf-internal-id=${isJf ? ep.jfId : null}
                           target=${isJf ? null : '_blank'}
                           rel=${isJf ? null : 'noopener noreferrer'}
                           onMouseEnter=${handleMouseEnter}
                           onMouseLeave=${handleMouseLeave}
                           onFocus=${() => setAxisHighlight(snum, ep.ep)}
                           onBlur=${clearAxisHighlight}
                           onClick=${handleClick}>
                            -
                        </a>
                    `;
                }

                const styleObj = applyRatingStyleProperties(ep.rating);

                return html`
                    <a className="jf-ieg-cell jf-ieg-rating emby-button button-link"
                       style=${styleObj}
                       href=${href}
                       data-jf-internal-id=${isJf ? ep.jfId : null}
                       target=${isJf ? null : '_blank'}
                       rel=${isJf ? null : 'noopener noreferrer'}
                       onMouseEnter=${(e) => { setAxisHighlight(snum, ep.ep); handleMouseEnter(e); }}
                       onMouseLeave=${handleMouseLeave}
                       onFocus=${() => setAxisHighlight(snum, ep.ep)}
                       onBlur=${clearAxisHighlight}
                       onClick=${handleClick}>
                        ${Number(ep.rating).toFixed(1)}
                    </a>
                `;
            };

            const renderAvgHead = (sticky = false, compact = false) => {
                const className = 'jf-ieg-cell jf-ieg-episode jf-ieg-avg-head' + (compact ? ' jf-ieg-episode-compact' : '') + (sticky ? ' jf-ieg-sticky-left' : '');
                return html`<div className=${className}>${app.i18n.Average || 'Avg'}</div>`;
            };

            const renderAvgCell = s => {
                const avg = average(s.episodes);
                if (avg == null) {
                    return html`<div className="jf-ieg-cell jf-ieg-empty jf-ieg-avg">-</div>`;
                }
                return html`
                    <div className="jf-ieg-cell jf-ieg-rating jf-ieg-avg"
                         style=${applyRatingStyleProperties(avg)}
                         title=${(app.i18n.Season || 'Season') + ' ' + s.num + ' - ' + (app.i18n.Average || 'Avg') + ': ' + avg.toFixed(2)}>
                        ${avg.toFixed(1)}
                    </div>
                `;
            };

            return html`
                <div className="jf-ieg-scroll">
                    <div ref=${gridRef} className="jf-ieg-grid" style=${gridStyle}>
                        <button type="button"
                                className=${"jf-ieg-cell jf-ieg-corner jf-ieg-corner-btn " + (inverted ? 'jf-ieg-corner-compact' : 'jf-ieg-corner-wide')}
                                aria-label=${app.i18n.InvertAxes}
                                onClick=${toggleInvert}>
                            ${createCornerIcon(html)}
                        </button>
                        ${!inverted ? html`
                            ${seasons.map(s => renderSeasonHead(s))}
                            ${allEpNums.map(n => html`
                                ${renderEpHead(n, true, false)}
                                ${seasons.map(s => renderCell(s.episodes.find(e => e.ep === n), s.num))}
                            `)}
                            ${renderAvgHead(true, false)}
                            ${seasons.map(s => renderAvgCell(s))}
                        ` : html`
                            ${allEpNums.map(n => renderEpHead(n, false, true))}
                            ${renderAvgHead(false, true)}
                            ${seasons.map(s => html`
                                ${renderSeasonHead(s, true)}
                                ${allEpNums.map(n => renderCell(s.episodes.find(e => e.ep === n), s.num))}
                                ${renderAvgCell(s)}
                            `)}
                        `}
                    </div>
                </div>
            `;
        }

        app.HeatmapGrid = HeatmapGrid;
    }

    initHeatmapComponent();
})(window.ImdbHeatmapApp);
