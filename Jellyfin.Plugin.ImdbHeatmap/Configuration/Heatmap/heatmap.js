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

    function applyRatingStyleProperties(r) {
        const v = app.toRating(r);
        if (v == null) return {};
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
        const borderL = Math.min(light + (v >= 7 ? 18 : 10), v >= 7 ? 85 : 34);
        let glow = 'inset 0 1px 0 rgba(255,255,255,.06)';
        if (v >= 9.8) glow = '0 0 8px rgba(255,240,28,.24),0 0 16px rgba(255,240,28,.12),inset 0 1px 0 rgba(255,255,255,.12)';
        else if (v >= 9.7) glow = '0 0 8px rgba(146,255,74,.28),0 0 16px rgba(146,255,74,.13),inset 0 1px 0 rgba(255,255,255,.11)';
        else if (v >= 9.6) glow = '0 0 6px rgba(86,255,72,.22),0 0 12px rgba(86,255,72,.10),inset 0 1px 0 rgba(255,255,255,.10)';
        else if (v >= 9.0) glow = '0 0 5px hsla(' + h + ',' + s + '%,' + (light + 8) + '%,.28),inset 0 1px 0 rgba(255,255,255,.08)';

        return {
            '--rh': h.toString(),
            '--rs': s + '%',
            '--rl': light + '%',
            '--ra': a.toString(),
            '--rb': borderL + '%',
            '--rg': glow
        };
    }

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
                gridTemplateColumns: inverted ? 'var(--c1) repeat(' + allEpNums.length + ', var(--c1))' : 'var(--c2) repeat(' + seasons.length + ', var(--c1))'
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
                       rel=${isJf ? null : 'noopener noreferrer'}
                       is=${isJf ? null : 'emby-linkbutton'}>
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
                           is=${isJf ? null : 'emby-linkbutton'}
                           onMouseEnter=${handleMouseEnter}
                           onMouseLeave=${handleMouseLeave}
                           onFocus=${() => setAxisHighlight(snum, ep.ep)}
                           onBlur=${clearAxisHighlight}
                           onClick=${handleClick}>
                            -
                        </a>
                    `;
                }

                let extraClass = '';
                if (ep.rating >= 9.8) extraClass = ' jf-ieg-rating-98plus';
                else if (ep.rating >= 9.7) extraClass = ' jf-ieg-rating-97';
                else if (ep.rating >= 9.6) extraClass = ' jf-ieg-rating-96';

                const styleObj = applyRatingStyleProperties(ep.rating);

                return html`
                    <a className=${"jf-ieg-cell jf-ieg-rating emby-button button-link" + extraClass}
                       style=${styleObj}
                       href=${href}
                       data-jf-internal-id=${isJf ? ep.jfId : null}
                       target=${isJf ? null : '_blank'}
                       rel=${isJf ? null : 'noopener noreferrer'}
                       is=${isJf ? null : 'emby-linkbutton'}
                       onMouseEnter=${(e) => { setAxisHighlight(snum, ep.ep); handleMouseEnter(e); }}
                       onMouseLeave=${handleMouseLeave}
                       onFocus=${() => setAxisHighlight(snum, ep.ep)}
                       onBlur=${clearAxisHighlight}
                       onClick=${handleClick}>
                        ${Number(ep.rating).toFixed(1)}
                    </a>
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
                        ` : html`
                            ${allEpNums.map(n => renderEpHead(n, false, true))}
                            ${seasons.map(s => html`
                                ${renderSeasonHead(s, true)}
                                ${allEpNums.map(n => renderCell(s.episodes.find(e => e.ep === n), s.num))}
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
