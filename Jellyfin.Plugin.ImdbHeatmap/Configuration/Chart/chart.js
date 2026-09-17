window.ImdbHeatmapApp = window.ImdbHeatmapApp || {};

(function (app) {
    'use strict';

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

    function makeLegendCanvas(shape, color, isDashedLine = true) {
        const canvas = document.createElement('canvas');
        canvas.width = 40;
        canvas.height = 20;
        const ctx = canvas.getContext('2d');
        if (!ctx) return canvas;

        if (isDashedLine) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(0, 10);
            ctx.lineTo(40, 10);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        ctx.fillStyle = color;
        const cx = 20, cy = 10;
        ctx.beginPath();
        if (shape === 'triangle') {
            ctx.moveTo(cx, cy - 5);
            ctx.lineTo(cx - 4.5, cy + 4.5);
            ctx.lineTo(cx + 4.5, cy + 4.5);
            ctx.closePath();
            ctx.fill();
        } else if (shape === 'rect') {
            ctx.fillRect(cx - 4, cy - 4, 8, 8);
        } else if (shape === 'rectRot') {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(Math.PI / 4);
            ctx.fillRect(-4, -4, 8, 8);
            ctx.restore();
        } else if (shape === 'star') {
            const points = [[0, -5], [1.5, -1.5], [5, -1.5], [2, 1], [3, 5], [0, 3], [-3, 5], [-2, 1], [-5, -1.5], [-1.5, -1.5]];
            ctx.moveTo(cx + points[0][0], cy + points[0][1]);
            for (let i = 1; i < points.length; i++) {
                ctx.lineTo(cx + points[i][0], cy + points[i][1]);
            }
            ctx.closePath();
            ctx.fill();
        } else if (shape === 'cross') {
            ctx.fillRect(cx - 4, cy - 1, 8, 2);
            ctx.fillRect(cx - 1, cy - 4, 2, 8);
        } else {
            ctx.arc(cx, cy, 4, 0, Math.PI * 2);
            ctx.fill();
        }
        return canvas;
    }

    function makeLineCanvas(color) {
        const canvas = document.createElement('canvas');
        canvas.width = 40;
        canvas.height = 20;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(0, 10);
            ctx.lineTo(40, 10);
            ctx.stroke();
        }
        return canvas;
    }

    async function initChartComponent() {
        const preact = await app.loadPreact();
        const { html, useEffect, useRef, useState } = preact;

        function RatingChart({ seasons, sid }) {
            const canvasRef = useRef(null);
            const legendContainerRef = useRef(null);
            const chartInstanceRef = useRef(null);
            const [legendItems, setLegendItems] = useState([]);
            const [minWidth, setMinWidth] = useState('100%');

            useEffect(() => {
                let isMounted = true;
                (async () => {
                    await loadChartJs();
                    if (!isMounted || !canvasRef.current) return;

                    let globalCount = 1;
                    const allData = [];
                    const datasets = [];
                    const items = [];
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

                            const seasonDsIndex = datasets.length;
                            const labelText = `${app.i18n.Season} ${s.num} (${app.i18n.Average}: ${avg})`;

                            datasets.push({
                                label: labelText,
                                data: sData,
                                backgroundColor: color,
                                borderColor: color,
                                type: 'scatter',
                                pointStyle: shape,
                                pointRadius: 5,
                                pointHoverRadius: 8
                            });

                            const trendDsIndex = datasets.length;
                            datasets.push({
                                label: `${app.i18n.Trend} S${s.num}`,
                                data: calcTrend(sData),
                                type: 'line',
                                borderColor: color,
                                borderDash: [5, 5],
                                borderWidth: 2,
                                pointRadius: 0,
                                fill: false
                            });

                            items.push({
                                datasetIndex: seasonDsIndex,
                                trendIndex: trendDsIndex,
                                label: labelText,
                                shape: shape,
                                color: color,
                                isGlobalLine: false,
                                active: true
                            });
                        }
                    });

                    if (allData.length > 1) {
                        const globalColor = 'rgba(255, 255, 255, 0.8)';
                        const globalDsIndex = datasets.length;
                        const globalLabel = app.i18n.GlobalTrend;

                        datasets.push({
                            label: globalLabel,
                            data: calcTrend(allData),
                            type: 'line',
                            borderColor: globalColor,
                            borderWidth: 4,
                            pointRadius: 0,
                            fill: false
                        });

                        items.push({
                            datasetIndex: globalDsIndex,
                            trendIndex: null,
                            label: globalLabel,
                            shape: null,
                            color: globalColor,
                            isGlobalLine: true,
                            active: true
                        });
                    }

                    const computedMinW = Math.max(700, allData.length * 18) + 'px';
                    setMinWidth(computedMinW);
                    setLegendItems(items);

                    if (chartInstanceRef.current) {
                        chartInstanceRef.current.destroy();
                    }

                    const ctx = canvasRef.current.getContext('2d');
                    chartInstanceRef.current = new window.Chart(ctx, {
                        data: { datasets },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            onHover: (event, chartElements, chart) => {
                                if (canvasRef.current) {
                                    canvasRef.current.style.cursor = (chartElements && chartElements.length) ? 'pointer' : 'default';
                                }
                                if (app.isPopoverPinned()) return;

                                if (chartElements && chartElements.length) {
                                    const el = chartElements[0];
                                    const dataset = chart.data.datasets[el.datasetIndex];
                                    if (dataset && dataset.data) {
                                        const pt = dataset.data[el.index];
                                        if (pt && (pt.jfId || pt.imdbEpId || pt.seasonNum)) {
                                            const hoverX = event.native ? event.native.clientX : 0;
                                            const hoverY = event.native ? event.native.clientY : 0;
                                            app.showEpisodePopover(pt, hoverX, hoverY, sid, false, true);
                                            return;
                                        }
                                    }
                                }
                                if (!app.isPopoverPinned() && !app.isMouseOverPopover()) {
                                    app.scheduleHideTooltip(400);
                                }
                            },
                            onClick: (event, elements, chart) => {
                                if (!elements || !elements.length) {
                                    app.hideTooltip(true);
                                    return;
                                }
                                const el = elements[0];
                                const dataset = chart.data.datasets[el.datasetIndex];
                                if (!dataset || !dataset.data) return;
                                const pt = dataset.data[el.index];
                                if (!pt || (!pt.jfId && !pt.imdbEpId && !pt.seasonNum)) return;

                                const clickX = event.native ? event.native.clientX : 0;
                                const clickY = event.native ? event.native.clientY : 0;

                                app.showEpisodePopover(pt, clickX, clickY, sid, true, true);
                            },
                            plugins: {
                                legend: { display: false },
                                tooltip: { enabled: false }
                            },
                            scales: {
                                x: { type: 'linear', title: { display: true, text: app.i18n.EpisodeCumulative, color: '#fff' }, ticks: { color: '#bbb' } },
                                y: { title: { display: true, text: app.i18n.ImdbRating, color: '#fff' }, ticks: { color: '#bbb' }, min: Math.max(0, Math.min(...allData.map(d => d.y)) - 1), max: 10 }
                            }
                        }
                    });
                })();

                return () => {
                    isMounted = false;
                    if (chartInstanceRef.current) {
                        chartInstanceRef.current.destroy();
                        chartInstanceRef.current = null;
                    }
                };
            }, [seasons, sid]);

            const toggleLegendItem = (itemIndex) => {
                const chart = chartInstanceRef.current;
                if (!chart) return;

                const item = legendItems[itemIndex];
                if (!item) return;

                const meta = chart.getDatasetMeta(item.datasetIndex);
                const ds = chart.data.datasets[item.datasetIndex];
                const isHidden = meta.hidden === null ? !ds.hidden : !meta.hidden;
                meta.hidden = isHidden;

                if (item.trendIndex !== null) {
                    const trendMeta = chart.getDatasetMeta(item.trendIndex);
                    if (trendMeta) {
                        trendMeta.hidden = isHidden;
                    }
                }

                chart.update();

                setLegendItems(prev => prev.map((it, idx) => idx === itemIndex ? { ...it, active: !isHidden } : it));
            };

            useEffect(() => {
                if (!legendContainerRef.current) return;
                const container = legendContainerRef.current;
                container.innerHTML = '';

                legendItems.forEach((item, index) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'jf-ieg-legend-btn' + (item.active ? '' : ' inactive');

                    const iconCanvas = item.isGlobalLine
                        ? makeLineCanvas(item.color)
                        : makeLegendCanvas(item.shape, item.color, true);
                    iconCanvas.className = 'jf-ieg-legend-icon';
                    btn.appendChild(iconCanvas);

                    const labelSpan = document.createElement('span');
                    labelSpan.textContent = item.label;
                    btn.appendChild(labelSpan);

                    btn.addEventListener('click', () => toggleLegendItem(index));
                    container.appendChild(btn);
                });
            }, [legendItems]);

            return html`
                <div class="jf-ieg-chart-container">
                    <div ref=${legendContainerRef} class="jf-ieg-chart-legend"></div>
                    <div class="jf-ieg-chart-scroll">
                        <div class="jf-ieg-chart-inner" style=${{ minWidth: minWidth }}>
                            <canvas ref=${canvasRef}></canvas>
                        </div>
                    </div>
                </div>
            `;
        }

        app.RatingChart = RatingChart;
    }

    initChartComponent();
})(window.ImdbHeatmapApp);
