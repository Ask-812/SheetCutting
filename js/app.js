/**
 * Sheet Cutting Optimizer – Application Logic & UI
 * Auto-fill mode: user provides piece sizes, algorithm decides quantities.
 * Supports multiple master sheets.
 */

document.addEventListener('DOMContentLoaded', () => {
    const state = {
        sheets: [],       // master sheet definitions [{id, w, h, label}]
        nextSheetId: 1,
        pieceSizes: [],   // unique piece size definitions
        nextId: 1,
        results: [],      // array of {sheet, layouts[]}
        activeSheet: 0,
        activeLayout: null
    };

    // ─── DOM References ──────────────────────────────────────────────────────
    const sheetWInput      = document.getElementById('sheetW');
    const sheetHInput      = document.getElementById('sheetH');
    const sheetLabelInput  = document.getElementById('sheetLabel');
    const addSheetBtn      = document.getElementById('addSheet');
    const sheetTableBody   = document.getElementById('sheetTableBody');
    const kerfInput        = document.getElementById('kerf');
    const rotationInput    = document.getElementById('allowRotation');
    const rectWInput       = document.getElementById('rectW');
    const rectHInput       = document.getElementById('rectH');
    const rectLabelInput   = document.getElementById('rectLabel');
    const addRectBtn       = document.getElementById('addRect');
    const clearRectsBtn    = document.getElementById('clearRects');
    const rectTableBody    = document.getElementById('rectTableBody');
    const optimizeBtn      = document.getElementById('optimizeBtn');
    const resultsDiv       = document.getElementById('results');
    const layoutListDiv    = document.getElementById('layoutList');
    const canvasWrap       = document.getElementById('canvasWrap');
    const canvas           = document.getElementById('packingCanvas');
    const ctx              = canvas.getContext('2d');
    const layoutInfo       = document.getElementById('layoutInfo');
    const placementTable   = document.getElementById('placementTableBody');
    const topNInput        = document.getElementById('topN');
    const quantitySummary  = document.getElementById('quantitySummary');

    // ─── Sheet Management ────────────────────────────────────────────────────

    addSheetBtn.addEventListener('click', () => {
        const w = parseFloat(sheetWInput.value);
        const h = parseFloat(sheetHInput.value);
        const label = sheetLabelInput.value.trim();

        if (!w || w <= 0 || !h || h <= 0) {
            showToast('Enter valid sheet width and height.', 'error');
            return;
        }

        state.sheets.push({
            id: state.nextSheetId++,
            w, h,
            label: label || `Sheet ${state.nextSheetId - 1}`
        });

        renderSheetTable();
        sheetWInput.value = '';
        sheetHInput.value = '';
        sheetLabelInput.value = '';
        sheetLabelInput.focus();
    });

    [sheetWInput, sheetHInput, sheetLabelInput].forEach(el => {
        el.addEventListener('keydown', e => {
            if (e.key === 'Enter') addSheetBtn.click();
        });
    });

    function renderSheetTable() {
        sheetTableBody.innerHTML = '';
        if (state.sheets.length === 0) {
            sheetTableBody.innerHTML = '<tr><td colspan="6" class="empty-msg">No master sheets added yet.</td></tr>';
            return;
        }
        state.sheets.forEach((s, i) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${s.id}</td>
                <td>${sanitize(s.label)}</td>
                <td>${s.w}</td>
                <td>${s.h}</td>
                <td>${(s.w * s.h).toLocaleString()}</td>
                <td><button class="btn btn-sm btn-danger" data-idx="${i}">&times;</button></td>
            `;
            tr.querySelector('button').addEventListener('click', () => {
                state.sheets.splice(i, 1);
                renderSheetTable();
            });
            sheetTableBody.appendChild(tr);
        });
    }

    // ─── Piece Size Management ───────────────────────────────────────────────

    addRectBtn.addEventListener('click', () => {
        const w = parseFloat(rectWInput.value);
        const h = parseFloat(rectHInput.value);
        const label = rectLabelInput.value.trim();

        if (!w || w <= 0 || !h || h <= 0) {
            showToast('Enter valid width and height.', 'error');
            return;
        }

        // Check for duplicate size
        const dup = state.pieceSizes.find(s => s.w === w && s.h === h);
        if (dup) {
            showToast(`Size ${w}×${h} already exists as "${dup.label}".`, 'error');
            return;
        }

        state.pieceSizes.push({
            id: state.nextId++,
            w,
            h,
            label: label || `Size ${state.nextId - 1}`
        });

        renderRectTable();
        rectWInput.value = '';
        rectHInput.value = '';
        rectLabelInput.value = '';
        rectWInput.focus();
    });

    // Allow Enter key to add
    [rectWInput, rectHInput, rectLabelInput].forEach(el => {
        el.addEventListener('keydown', e => {
            if (e.key === 'Enter') addRectBtn.click();
        });
    });

    clearRectsBtn.addEventListener('click', () => {
        state.pieceSizes = [];
        state.nextId = 1;
        renderRectTable();
        resultsDiv.classList.add('hidden');
    });

    function renderRectTable() {
        rectTableBody.innerHTML = '';
        if (state.pieceSizes.length === 0) {
            rectTableBody.innerHTML = '<tr><td colspan="6" class="empty-msg">No piece sizes added yet.</td></tr>';
            return;
        }
        state.pieceSizes.forEach((r, i) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${r.id}</td>
                <td>${sanitize(r.label)}</td>
                <td>${r.w}</td>
                <td>${r.h}</td>
                <td>${(r.w * r.h).toLocaleString()}</td>
                <td><button class="btn btn-sm btn-danger" data-idx="${i}">&times;</button></td>
            `;
            tr.querySelector('button').addEventListener('click', () => {
                state.pieceSizes.splice(i, 1);
                renderRectTable();
            });
            rectTableBody.appendChild(tr);
        });
    }

    // ─── Optimization ────────────────────────────────────────────────────────

    const algoModeSelect = document.getElementById('algoMode');
    const progressOverlay = document.getElementById('progressOverlay');
    const progressBar     = document.getElementById('progressBar');
    const progressTitle   = document.getElementById('progressTitle');
    const progressDetail  = document.getElementById('progressDetail');
    const progressFitness = document.getElementById('progressFitness');

    optimizeBtn.addEventListener('click', () => {
        const kerf = parseFloat(kerfInput.value) || 0;
        const allowRotation = rotationInput.checked;
        const topN = parseInt(topNInput.value, 10) || 10;
        const mode = algoModeSelect.value;

        if (state.sheets.length === 0) {
            showToast('Add at least one master sheet.', 'error');
            return;
        }
        if (state.pieceSizes.length === 0) {
            showToast('Add at least one piece size.', 'error');
            return;
        }

        const pieceSizesCopy = state.pieceSizes.map(r => ({ id: r.id, w: r.w, h: r.h, label: r.label }));

        optimizeBtn.disabled = true;

        if (mode === 'advanced') {
            progressOverlay.classList.remove('hidden');
            progressBar.style.width = '0%';
            progressTitle.textContent = 'Initializing...';
            progressDetail.textContent = '';
            progressFitness.textContent = '';

            setTimeout(() => {
                try {
                    const allResults = [];
                    const totalSheets = state.sheets.length;

                    state.sheets.forEach((sheet, si) => {
                        const params = {
                            sheetW: sheet.w, sheetH: sheet.h,
                            pieceSizes: pieceSizesCopy,
                            kerf, allowRotation
                        };

                        const optimizer = new PackingOptimizer(params);
                        const layouts = optimizer.optimize({
                            topN,
                            onProgress: (phase, pct, fit, msg) => {
                                const phaseWeights = { ga: 0.45, sa: 0.30, ils: 0.05, sa2: 0.10, heuristics: 0.05, done: 0.05 };
                                const phaseStarts = { ga: 0, sa: 0.45, ils: 0.75, sa2: 0.80, heuristics: 0.90, done: 0.95 };
                                const sheetPct = ((phaseStarts[phase] || 0) + (phaseWeights[phase] || 0) * pct);
                                const totalPct = ((si + sheetPct) / totalSheets) * 100;
                                progressBar.style.width = Math.min(totalPct, 100) + '%';

                                const phaseNames = {
                                    ga: 'Genetic Algorithm',
                                    sa: 'Simulated Annealing',
                                    ils: 'Local Search',
                                    sa2: 'Exploring Alternatives',
                                    heuristics: 'Heuristic Sweep',
                                    done: 'Complete'
                                };
                                progressTitle.textContent = `${sanitize(sheet.label)}: ${phaseNames[phase] || phase}`;
                                progressDetail.textContent = msg || '';
                                if (fit > 0) {
                                    progressFitness.textContent = `Best utilization: ${fit.toFixed(2)}%`;
                                }
                            }
                        });

                        allResults.push({ sheet, layouts });
                    });

                    state.results = allResults;
                    state.activeSheet = 0;
                    renderSheetTabs();
                    switchSheet(0);
                    resultsDiv.classList.remove('hidden');
                    setTimeout(() => resultsDiv.scrollIntoView({ behavior: 'smooth' }), 100);
                } catch (err) {
                    showToast('Optimization failed: ' + err.message, 'error');
                    console.error(err);
                } finally {
                    progressOverlay.classList.add('hidden');
                    optimizeBtn.disabled = false;
                    optimizeBtn.textContent = 'Fill & Optimize';
                }
            }, 80);

        } else {
            optimizeBtn.textContent = 'Filling sheets...';
            setTimeout(() => {
                try {
                    const allResults = [];

                    state.sheets.forEach(sheet => {
                        const params = {
                            sheetW: sheet.w, sheetH: sheet.h,
                            pieceSizes: pieceSizesCopy,
                            kerf, allowRotation
                        };
                        const layouts = generateTopLayouts(params, topN);
                        allResults.push({ sheet, layouts });
                    });

                    state.results = allResults;
                    state.activeSheet = 0;
                    renderSheetTabs();
                    switchSheet(0);
                    resultsDiv.classList.remove('hidden');
                    resultsDiv.scrollIntoView({ behavior: 'smooth' });
                } catch (err) {
                    showToast('Optimization failed: ' + err.message, 'error');
                    console.error(err);
                } finally {
                    optimizeBtn.disabled = false;
                    optimizeBtn.textContent = 'Fill & Optimize';
                }
            }, 50);
        }
    });

    // ─── Sheet Tabs & Results Rendering ─────────────────────────────────────

    function renderSheetTabs() {
        let tabBar = document.getElementById('sheetTabBar');
        if (!tabBar) {
            tabBar = document.createElement('div');
            tabBar.id = 'sheetTabBar';
            tabBar.className = 'sheet-tab-bar';
            // Insert above the results-container
            const container = document.querySelector('.results-container');
            container.parentNode.insertBefore(tabBar, container);
        }
        tabBar.innerHTML = '';

        if (state.results.length <= 1) {
            // Single sheet – no tabs needed, just show sheet label
            if (state.results.length === 1) {
                const label = document.createElement('div');
                label.className = 'sheet-tab-single';
                label.textContent = sanitize(state.results[0].sheet.label) +
                    ` (${state.results[0].sheet.w} × ${state.results[0].sheet.h})`;
                tabBar.appendChild(label);
            }
        } else {
            state.results.forEach((r, i) => {
                const tab = document.createElement('button');
                tab.className = 'sheet-tab' + (i === state.activeSheet ? ' active' : '');
                tab.textContent = sanitize(r.sheet.label);
                tab.title = `${r.sheet.w} × ${r.sheet.h}`;
                tab.addEventListener('click', () => switchSheet(i));
                tabBar.appendChild(tab);
            });
        }
    }

    function switchSheet(sheetIdx) {
        state.activeSheet = sheetIdx;
        // Update tab active state
        document.querySelectorAll('.sheet-tab').forEach((t, i) => {
            t.classList.toggle('active', i === sheetIdx);
        });
        const sheetResult = state.results[sheetIdx];
        renderResults(sheetResult.layouts);
        if (sheetResult.layouts.length > 0) selectLayout(0);
    }

    function renderResults(layouts) {
        layoutListDiv.innerHTML = '';
        layouts.forEach((layout, i) => {
            const card = document.createElement('div');
            card.className = 'layout-card' + (i === 0 ? ' active' : '');
            card.dataset.idx = i;
            card.innerHTML = `
                <div class="layout-rank">#${i + 1}</div>
                <div class="layout-stats">
                    <strong>${layout.utilization.toFixed(1)}%</strong> utilization<br>
                    <small>${layout.placedCount} pieces cut</small><br>
                    <small class="strategy">${sanitize(layout.strategyLabel)}</small>
                </div>
            `;
            card.addEventListener('click', () => selectLayout(i));
            layoutListDiv.appendChild(card);
        });
    }

    function selectLayout(idx) {
        state.activeLayout = idx;
        document.querySelectorAll('.layout-card').forEach((c, i) => {
            c.classList.toggle('active', i === idx);
        });
        const sheetResult = state.results[state.activeSheet];
        const layout = sheetResult.layouts[idx];
        renderCanvas(layout);
        renderLayoutInfo(layout);
        renderPlacementTable(layout);
    }

    // ─── Canvas Hover Tooltip ─────────────────────────────────────────────────

    let canvasScale = 1;
    let canvasLayout = null;

    // Create tooltip element
    const tooltip = document.createElement('div');
    tooltip.className = 'canvas-tooltip hidden';
    canvasWrap.style.position = 'relative';
    canvasWrap.appendChild(tooltip);

    canvas.addEventListener('mousemove', (e) => {
        if (!canvasLayout) return;
        const rect = canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left) / canvasScale;
        const my = (e.clientY - rect.top) / canvasScale;
        const layout = canvasLayout;

        // Check if hovering over a placed piece
        let hoveredPiece = null;
        for (let i = layout.placements.length - 1; i >= 0; i--) {
            const p = layout.placements[i];
            if (mx >= p.x && mx <= p.x + p.w && my >= p.y && my <= p.y + p.h) {
                hoveredPiece = p;
                break;
            }
        }

        if (hoveredPiece) {
            const p = hoveredPiece;
            tooltip.innerHTML = `<strong>${sanitize(p.label)}</strong><br>` +
                `Size: ${p.w} × ${p.h}<br>` +
                `Position: (${p.x.toFixed(1)}, ${p.y.toFixed(1)})` +
                (p.rotated ? '<br><span class="tip-rotated">Rotated 90°</span>' : '');
            tooltip.classList.remove('hidden');
        } else if (mx >= 0 && mx <= layout.sheetW && my >= 0 && my <= layout.sheetH) {
            // Hovering over empty/waste space — compute gap dimensions
            const gap = computeGapAt(mx, my, layout);
            if (gap) {
                tooltip.innerHTML = `<span class="tip-gap">Gap / Waste</span><br>` +
                    `Width: ${gap.w.toFixed(1)}<br>` +
                    `Height: ${gap.h.toFixed(1)}<br>` +
                    `Area: ${(gap.w * gap.h).toFixed(0)}`;
                tooltip.classList.remove('hidden');
            } else {
                tooltip.classList.add('hidden');
            }
        } else {
            tooltip.classList.add('hidden');
        }

        // Position tooltip near cursor
        const tx = e.clientX - rect.left + 12;
        const ty = e.clientY - rect.top - 10;
        tooltip.style.left = Math.min(tx, canvas.width - tooltip.offsetWidth - 5) + 'px';
        tooltip.style.top = Math.min(ty, canvas.height - tooltip.offsetHeight - 5) + 'px';
    });

    canvas.addEventListener('mouseleave', () => {
        tooltip.classList.add('hidden');
    });

    function computeGapAt(mx, my, layout) {
        // Find the bounding box of free space at (mx, my)
        // by scanning outward to nearest piece edges or sheet edges
        let left = 0, right = layout.sheetW, top = 0, bottom = layout.sheetH;

        for (const p of layout.placements) {
            // Pieces that constrain horizontally (same vertical band)
            if (my >= p.y && my < p.y + p.h) {
                if (p.x + p.w <= mx) left = Math.max(left, p.x + p.w);
                if (p.x >= mx) right = Math.min(right, p.x);
            }
        }

        for (const p of layout.placements) {
            // Pieces that constrain vertically (within our horizontal band)
            if (p.x < right && p.x + p.w > left) {
                if (p.y + p.h <= my) top = Math.max(top, p.y + p.h);
                if (p.y >= my) bottom = Math.min(bottom, p.y);
            }
        }

        const w = right - left;
        const h = bottom - top;
        if (w > 0.5 && h > 0.5) {
            return { x: left, y: top, w, h };
        }
        return null;
    }

    // ─── Canvas Rendering ────────────────────────────────────────────────────

    function renderCanvas(layout) {
        const maxCanvasW = canvasWrap.clientWidth - 20;
        const maxCanvasH = 600;
        const scale = Math.min(maxCanvasW / layout.sheetW, maxCanvasH / layout.sheetH);

        canvasScale = scale;
        canvasLayout = layout;

        canvas.width = Math.ceil(layout.sheetW * scale);
        canvas.height = Math.ceil(layout.sheetH * scale);

        // Sheet background
        ctx.fillStyle = '#e8e8e8';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Sheet border
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

        // Draw placed rectangles – color by size type
        const sizeIds = [...new Set(layout.placements.map(p => p.sizeId))];
        const colorMap = {};
        const colors = generateColors(sizeIds.length);
        sizeIds.forEach((sid, i) => { colorMap[sid] = colors[i]; });

        layout.placements.forEach((p) => {
            const x = p.x * scale;
            const y = p.y * scale;
            const w = p.w * scale;
            const h = p.h * scale;

            // Fill
            ctx.fillStyle = colorMap[p.sizeId] || '#ccc';
            ctx.fillRect(x, y, w, h);

            // Border
            ctx.strokeStyle = '#222';
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, w, h);

            // Label
            ctx.fillStyle = '#000';
            const fontSize = Math.max(9, Math.min(14, Math.min(w, h) * 0.3));
            ctx.font = `bold ${fontSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const label = p.label;
            const dims = `${p.w}×${p.h}`;
            if (h > fontSize * 3 && w > 30) {
                ctx.fillText(label, x + w / 2, y + h / 2 - fontSize * 0.6);
                ctx.font = `${fontSize * 0.8}px sans-serif`;
                ctx.fillText(dims, x + w / 2, y + h / 2 + fontSize * 0.6);
                if (p.rotated) {
                    ctx.font = `${fontSize * 0.7}px sans-serif`;
                    ctx.fillStyle = '#c00';
                    ctx.fillText('(rotated)', x + w / 2, y + h / 2 + fontSize * 1.5);
                }
            } else if (w > 20 && h > fontSize) {
                ctx.fillText(label, x + w / 2, y + h / 2);
            }
        });
    }

    function generateColors(n) {
        const colors = [];
        for (let i = 0; i < Math.max(n, 1); i++) {
            const hue = (i * 137.508) % 360; // golden angle
            colors.push(`hsla(${hue}, 60%, 70%, 0.85)`);
        }
        return colors;
    }

    // ─── Layout Info Panel ───────────────────────────────────────────────────

    function renderLayoutInfo(layout) {
        layoutInfo.innerHTML = `
            <div class="info-grid">
                <div class="info-item">
                    <span class="info-label">Sheet Size</span>
                    <span class="info-value">${layout.sheetW} × ${layout.sheetH}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Sheet Area</span>
                    <span class="info-value">${(layout.sheetW * layout.sheetH).toLocaleString()}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Used Area</span>
                    <span class="info-value">${layout.totalUsed.toLocaleString()}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Waste Area</span>
                    <span class="info-value">${layout.waste.toLocaleString()}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Utilization</span>
                    <span class="info-value highlight">${layout.utilization.toFixed(2)}%</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Total Pieces Cut</span>
                    <span class="info-value">${layout.placedCount}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Strategy</span>
                    <span class="info-value">${sanitize(layout.strategyLabel)}</span>
                </div>
            </div>
        `;

        // Render quantity summary
        const qtyRows = state.pieceSizes.map(s => {
            const count = layout.quantities[s.id] || 0;
            return `<tr>
                <td>${sanitize(s.label)}</td>
                <td>${s.w} × ${s.h}</td>
                <td><strong>${count}</strong></td>
                <td>${(count * s.w * s.h).toLocaleString()}</td>
            </tr>`;
        }).join('');

        quantitySummary.innerHTML = `
            <h3>Quantity Breakdown (auto-filled)</h3>
            <table class="qty-table">
                <thead>
                    <tr><th>Size</th><th>Dimensions</th><th>Qty</th><th>Total Area</th></tr>
                </thead>
                <tbody>${qtyRows}</tbody>
            </table>
        `;
    }

    function renderPlacementTable(layout) {
        placementTable.innerHTML = '';
        if (layout.placements.length === 0) {
            placementTable.innerHTML = '<tr><td colspan="6" class="empty-msg">No pieces placed.</td></tr>';
            return;
        }
        layout.placements.forEach(p => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${p.id}</td>
                <td>${sanitize(p.label)}</td>
                <td>(${p.x.toFixed(2)}, ${p.y.toFixed(2)})</td>
                <td>${p.w} × ${p.h}</td>
                <td>${p.rotated ? 'Yes' : 'No'}</td>
                <td>${(p.w * p.h).toLocaleString()}</td>
            `;
            placementTable.appendChild(tr);
        });
    }

    // ─── Export ───────────────────────────────────────────────────────────────

    document.getElementById('exportCSV').addEventListener('click', () => {
        if (!state.results.length) return;
        const sheetResult = state.results[state.activeSheet];
        const layout = sheetResult.layouts[state.activeLayout || 0];
        let csv = 'ID,Label,X,Y,Width,Height,Rotated,Area\n';
        layout.placements.forEach(p => {
            csv += `${p.id},"${p.label}",${p.x.toFixed(2)},${p.y.toFixed(2)},${p.w},${p.h},${p.rotated},${p.w * p.h}\n`;
        });
        downloadFile(`layout_${sanitize(sheetResult.sheet.label)}_${(state.activeLayout || 0) + 1}.csv`, csv, 'text/csv');
    });

    document.getElementById('exportPNG').addEventListener('click', () => {
        if (!state.results.length) return;
        const sheetResult = state.results[state.activeSheet];
        const link = document.createElement('a');
        link.download = `layout_${sanitize(sheetResult.sheet.label)}_${(state.activeLayout || 0) + 1}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    });

    document.getElementById('exportAllCSV').addEventListener('click', () => {
        if (!state.results.length) return;
        let csv = 'Sheet,SheetSize,Layout#,Utilization%,PlacedCount,Strategy,ID,Label,X,Y,Width,Height,Rotated,Area\n';
        state.results.forEach(sr => {
            sr.layouts.forEach((layout, li) => {
                layout.placements.forEach(p => {
                    csv += `"${sr.sheet.label}","${sr.sheet.w}x${sr.sheet.h}",${li + 1},${layout.utilization.toFixed(2)},${layout.placedCount},"${layout.strategyLabel}",${p.id},"${p.label}",${p.x.toFixed(2)},${p.y.toFixed(2)},${p.w},${p.h},${p.rotated},${p.w * p.h}\n`;
                });
            });
        });
        downloadFile('all_layouts.csv', csv, 'text/csv');
    });

    function downloadFile(name, content, type) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function sanitize(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function showToast(msg, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ─── Demo Sizes ────────────────────────────────────────────────────────────

    document.getElementById('loadDemo').addEventListener('click', () => {
        state.pieceSizes = [
            { id: 1, w: 200, h: 100, label: 'Large' },
            { id: 2, w: 150, h: 75,  label: 'Medium' },
            { id: 3, w: 100, h: 50,  label: 'Small' },
            { id: 4, w: 60,  h: 40,  label: 'Tiny' },
        ];
        state.nextId = 5;

        state.sheets = [
            { id: 1, w: 1000, h: 600, label: 'Standard Sheet' }
        ];
        state.nextSheetId = 2;

        kerfInput.value = 3;
        rotationInput.checked = true;

        renderSheetTable();
        renderRectTable();
        showToast('Demo sizes loaded — 4 sizes on 1 sheet.');
    });

    // ─── Sample Project ──────────────────────────────────────────────────────

    document.getElementById('loadSample').addEventListener('click', () => {
        state.sheets = [
            { id: 1, w: 2440, h: 1220, label: 'Plywood 8×4' },
            { id: 2, w: 1830, h: 915,  label: 'MDF 6×3' },
        ];
        state.nextSheetId = 3;

        kerfInput.value = 4;
        rotationInput.checked = true;

        state.pieceSizes = [
            { id: 1, w: 600, h: 400, label: 'Door Panel' },
            { id: 2, w: 500, h: 300, label: 'Side Panel' },
            { id: 3, w: 400, h: 200, label: 'Shelf' },
            { id: 4, w: 300, h: 150, label: 'Drawer Front' },
            { id: 5, w: 200, h: 100, label: 'Divider' },
            { id: 6, w: 150, h: 80,  label: 'Bracket' },
        ];
        state.nextId = 7;
        renderSheetTable();
        renderRectTable();
        showToast('Sample project loaded — 6 sizes on 2 sheets (Plywood + MDF).');
    });

    // Initial render
    renderSheetTable();
    renderRectTable();
});
