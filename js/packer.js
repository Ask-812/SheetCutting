/**
 * 2D Sheet Cutting Optimizer
 * Implements MaxRects, Guillotine, and Shelf bin packing algorithms
 * with kerf constraint.
 */

// ─── Geometry Helpers ────────────────────────────────────────────────────────

function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
}

function rectContains(outer, inner) {
    return inner.x >= outer.x && inner.y >= outer.y &&
           inner.x + inner.w <= outer.x + outer.w &&
           inner.y + inner.h <= outer.y + outer.h;
}

// ─── MaxRects Algorithm ──────────────────────────────────────────────────────

class MaxRectsPacker {
    /**
     * @param {number} width      – usable sheet width  (after boundary margins)
     * @param {number} height     – usable sheet height (after boundary margins)
     * @param {string} heuristic  – BSSF | BLSF | BAF | BL | CP
     */
    constructor(width, height, heuristic = 'BSSF') {
        this.binW = width;
        this.binH = height;
        this.heuristic = heuristic;
        this.freeRects = [{ x: 0, y: 0, w: width, h: height }];
        this.placed = [];
    }

    /**
     * Try to insert a rectangle with effective dimensions (includes kerf).
     * Returns placement {x, y, w, h, rotated} or null.
     */
    insert(effW, effH, allowRotation) {
        let bestScore1 = Infinity, bestScore2 = Infinity;
        let bestRect = null;
        let bestIdx = -1;

        for (let i = 0; i < this.freeRects.length; i++) {
            const fr = this.freeRects[i];
            // Try without rotation
            if (effW <= fr.w && effH <= fr.h) {
                const scores = this._score(fr, effW, effH);
                if (scores[0] < bestScore1 || (scores[0] === bestScore1 && scores[1] < bestScore2)) {
                    bestScore1 = scores[0];
                    bestScore2 = scores[1];
                    bestRect = { x: fr.x, y: fr.y, w: effW, h: effH, rotated: false };
                    bestIdx = i;
                }
            }
            // Try with rotation
            if (allowRotation && effH <= fr.w && effW <= fr.h && effW !== effH) {
                const scores = this._score(fr, effH, effW);
                if (scores[0] < bestScore1 || (scores[0] === bestScore1 && scores[1] < bestScore2)) {
                    bestScore1 = scores[0];
                    bestScore2 = scores[1];
                    bestRect = { x: fr.x, y: fr.y, w: effH, h: effW, rotated: true };
                    bestIdx = i;
                }
            }
        }

        if (!bestRect) return null;

        this._splitFreeRects(bestRect);
        this._pruneFreeRects();
        this.placed.push(bestRect);
        return bestRect;
    }

    _score(freeRect, w, h) {
        switch (this.heuristic) {
            case 'BSSF': { // Best Short Side Fit
                const leftW = freeRect.w - w;
                const leftH = freeRect.h - h;
                return [Math.min(leftW, leftH), Math.max(leftW, leftH)];
            }
            case 'BLSF': { // Best Long Side Fit
                const leftW = freeRect.w - w;
                const leftH = freeRect.h - h;
                return [Math.max(leftW, leftH), Math.min(leftW, leftH)];
            }
            case 'BAF': { // Best Area Fit
                return [freeRect.w * freeRect.h - w * h, Math.min(freeRect.w - w, freeRect.h - h)];
            }
            case 'BL': { // Bottom-Left
                return [freeRect.y, freeRect.x];
            }
            case 'CP': { // Contact Point – maximize contact with placed rects / edges
                let contact = 0;
                if (freeRect.x === 0 || freeRect.x + w === this.binW) contact += h;
                if (freeRect.y === 0 || freeRect.y + h === this.binH) contact += w;
                for (const p of this.placed) {
                    if (Math.abs(p.x + p.w - freeRect.x) < 0.001 || Math.abs(freeRect.x + w - p.x) < 0.001) {
                        contact += Math.max(0, Math.min(freeRect.y + h, p.y + p.h) - Math.max(freeRect.y, p.y));
                    }
                    if (Math.abs(p.y + p.h - freeRect.y) < 0.001 || Math.abs(freeRect.y + h - p.y) < 0.001) {
                        contact += Math.max(0, Math.min(freeRect.x + w, p.x + p.w) - Math.max(freeRect.x, p.x));
                    }
                }
                return [-contact, 0]; // negative because we maximize
            }
            default:
                return [0, 0];
        }
    }

    _splitFreeRects(placed) {
        const newFree = [];
        for (let i = 0; i < this.freeRects.length; i++) {
            const fr = this.freeRects[i];
            if (!rectsOverlap(fr, placed)) {
                newFree.push(fr);
                continue;
            }
            // Split into up to 4 new free rects
            if (placed.x > fr.x) {
                newFree.push({ x: fr.x, y: fr.y, w: placed.x - fr.x, h: fr.h });
            }
            if (placed.x + placed.w < fr.x + fr.w) {
                newFree.push({ x: placed.x + placed.w, y: fr.y, w: fr.x + fr.w - placed.x - placed.w, h: fr.h });
            }
            if (placed.y > fr.y) {
                newFree.push({ x: fr.x, y: fr.y, w: fr.w, h: placed.y - fr.y });
            }
            if (placed.y + placed.h < fr.y + fr.h) {
                newFree.push({ x: fr.x, y: placed.y + placed.h, w: fr.w, h: fr.y + fr.h - placed.y - placed.h });
            }
        }
        this.freeRects = newFree;
    }

    _pruneFreeRects() {
        for (let i = 0; i < this.freeRects.length; i++) {
            for (let j = i + 1; j < this.freeRects.length; j++) {
                if (rectContains(this.freeRects[j], this.freeRects[i])) {
                    this.freeRects.splice(i, 1);
                    i--;
                    break;
                }
                if (rectContains(this.freeRects[i], this.freeRects[j])) {
                    this.freeRects.splice(j, 1);
                    j--;
                }
            }
        }
    }
}

// ─── Guillotine Algorithm ────────────────────────────────────────────────────

class GuillotinePacker {
    /**
     * @param {number} width
     * @param {number} height
     * @param {string} splitRule – SAS | LAS | SLS | LLS | MINAS | MAXAS
     * @param {string} rectChoice – BSSF | BLSF | BAF
     */
    constructor(width, height, splitRule = 'SAS', rectChoice = 'BAF') {
        this.binW = width;
        this.binH = height;
        this.splitRule = splitRule;
        this.rectChoice = rectChoice;
        this.freeRects = [{ x: 0, y: 0, w: width, h: height }];
        this.placed = [];
    }

    insert(effW, effH, allowRotation) {
        let bestScore = Infinity;
        let bestRect = null;
        let bestFreeIdx = -1;

        for (let i = 0; i < this.freeRects.length; i++) {
            const fr = this.freeRects[i];

            if (effW <= fr.w && effH <= fr.h) {
                const score = this._choiceScore(fr, effW, effH);
                if (score < bestScore) {
                    bestScore = score;
                    bestRect = { x: fr.x, y: fr.y, w: effW, h: effH, rotated: false };
                    bestFreeIdx = i;
                }
            }
            if (allowRotation && effH <= fr.w && effW <= fr.h && effW !== effH) {
                const score = this._choiceScore(fr, effH, effW);
                if (score < bestScore) {
                    bestScore = score;
                    bestRect = { x: fr.x, y: fr.y, w: effH, h: effW, rotated: true };
                    bestFreeIdx = i;
                }
            }
        }

        if (!bestRect) return null;

        const fr = this.freeRects[bestFreeIdx];
        this.freeRects.splice(bestFreeIdx, 1);

        // Split the free rect
        const rightW = fr.w - bestRect.w;
        const topH = fr.h - bestRect.h;

        const splitH = this._shouldSplitHorizontally(bestRect.w, bestRect.h, rightW, topH);

        if (splitH) {
            // Split horizontally: bottom-right and top
            if (rightW > 0) {
                this.freeRects.push({ x: fr.x + bestRect.w, y: fr.y, w: rightW, h: bestRect.h });
            }
            if (topH > 0) {
                this.freeRects.push({ x: fr.x, y: fr.y + bestRect.h, w: fr.w, h: topH });
            }
        } else {
            // Split vertically: right and bottom-top
            if (rightW > 0) {
                this.freeRects.push({ x: fr.x + bestRect.w, y: fr.y, w: rightW, h: fr.h });
            }
            if (topH > 0) {
                this.freeRects.push({ x: fr.x, y: fr.y + bestRect.h, w: bestRect.w, h: topH });
            }
        }

        this.placed.push(bestRect);
        return bestRect;
    }

    _choiceScore(fr, w, h) {
        switch (this.rectChoice) {
            case 'BSSF': return Math.min(fr.w - w, fr.h - h);
            case 'BLSF': return Math.max(fr.w - w, fr.h - h);
            case 'BAF': return fr.w * fr.h - w * h;
            default: return 0;
        }
    }

    _shouldSplitHorizontally(placedW, placedH, rightW, topH) {
        switch (this.splitRule) {
            case 'SAS': return placedW * topH <= placedH * rightW; // shorter axis split
            case 'LAS': return placedW * topH > placedH * rightW;  // longer axis split
            case 'SLS': return rightW < topH;  // shorter leftover split
            case 'LLS': return rightW >= topH; // longer leftover split
            case 'MINAS': return rightW * placedH < topH * placedW;
            case 'MAXAS': return rightW * placedH >= topH * placedW;
            default: return true;
        }
    }
}

// ─── Shelf Algorithm ─────────────────────────────────────────────────────────

class ShelfPacker {
    /**
     * @param {number} width
     * @param {number} height
     * @param {string} heuristic – NF (Next Fit) | FF (First Fit) | BF (Best Fit)
     */
    constructor(width, height, heuristic = 'FF') {
        this.binW = width;
        this.binH = height;
        this.heuristic = heuristic;
        this.shelves = []; // { y, h, usedW }
        this.placed = [];
    }

    insert(effW, effH, allowRotation) {
        let bestRect = null;

        // Try both orientations
        const orientations = [{ w: effW, h: effH, rot: false }];
        if (allowRotation && effW !== effH) {
            orientations.push({ w: effH, h: effW, rot: true });
        }

        for (const ori of orientations) {
            const result = this._tryPlace(ori.w, ori.h, ori.rot);
            if (result) {
                if (!bestRect || this._isBetter(result, bestRect)) {
                    bestRect = result;
                }
            }
        }

        if (bestRect) {
            this.placed.push(bestRect.rect);
            return bestRect.rect;
        }
        return null;
    }

    _tryPlace(w, h, rotated) {
        switch (this.heuristic) {
            case 'NF': return this._nextFit(w, h, rotated);
            case 'FF': return this._firstFit(w, h, rotated);
            case 'BF': return this._bestFit(w, h, rotated);
            default: return this._firstFit(w, h, rotated);
        }
    }

    _nextFit(w, h, rotated) {
        if (this.shelves.length > 0) {
            const shelf = this.shelves[this.shelves.length - 1];
            if (shelf.usedW + w <= this.binW && h <= shelf.h) {
                const rect = { x: shelf.usedW, y: shelf.y, w, h, rotated };
                shelf.usedW += w;
                return { rect, waste: (shelf.h - h) * w };
            }
        }
        return this._newShelf(w, h, rotated);
    }

    _firstFit(w, h, rotated) {
        for (const shelf of this.shelves) {
            if (shelf.usedW + w <= this.binW && h <= shelf.h) {
                const rect = { x: shelf.usedW, y: shelf.y, w, h, rotated };
                shelf.usedW += w;
                return { rect, waste: (shelf.h - h) * w };
            }
        }
        return this._newShelf(w, h, rotated);
    }

    _bestFit(w, h, rotated) {
        let bestShelf = null;
        let bestWaste = Infinity;
        for (const shelf of this.shelves) {
            if (shelf.usedW + w <= this.binW && h <= shelf.h) {
                const waste = (shelf.h - h) * w;
                if (waste < bestWaste) {
                    bestWaste = waste;
                    bestShelf = shelf;
                }
            }
        }
        if (bestShelf) {
            const rect = { x: bestShelf.usedW, y: bestShelf.y, w, h, rotated };
            bestShelf.usedW += w;
            return { rect, waste: bestWaste };
        }
        return this._newShelf(w, h, rotated);
    }

    _newShelf(w, h, rotated) {
        const shelfY = this.shelves.length === 0 ? 0 :
            this.shelves[this.shelves.length - 1].y + this.shelves[this.shelves.length - 1].h;
        if (shelfY + h > this.binH || w > this.binW) return null;
        const shelf = { y: shelfY, h, usedW: w };
        this.shelves.push(shelf);
        const rect = { x: 0, y: shelfY, w, h, rotated };
        return { rect, waste: 0 };
    }

    _isBetter(a, b) {
        return a.waste < b.waste;
    }
}

// ─── Layout Generator (Auto-Fill Mode) ───────────────────────────────────────

/**
 * Auto-fill the sheet with pieces from the given size catalogue.
 * Repeats pieces as many times as they fit. Algorithm decides quantities.
 *
 * @param {Object} params
 * @param {number} params.sheetW           – full sheet width
 * @param {number} params.sheetH           – full sheet height
 * @param {Array}  params.pieceSizes       – [{id, w, h, label}]  (unique sizes, not qty)
 * @param {number} params.kerf             – cutting kerf width
 * @param {boolean} params.allowRotation
 * @param {string} params.algorithm        – 'maxrects' | 'guillotine' | 'shelf'
 * @param {string} params.heuristic        – algorithm-specific heuristic
 * @param {string} params.fillOrder        – 'area' | 'height' | 'width' | 'perimeter' | 'maxside' | 'cycle'
 * @param {string} [params.splitRule]      – for guillotine
 * @returns {Object} layout result
 */
function generateLayout(params) {
    const {
        sheetW, sheetH, pieceSizes,
        kerf,
        allowRotation, algorithm, heuristic,
        fillOrder, splitRule
    } = params;

    const usableW = sheetW;
    const usableH = sheetH;

    if (usableW <= 0 || usableH <= 0) {
        return { placements: [], totalUsed: 0, waste: sheetW * sheetH, utilization: 0, quantities: {} };
    }

    const extra = kerf || 0;

    // Sort piece sizes to determine insertion priority
    let sorted = pieceSizes.map(p => ({ ...p }));
    switch (fillOrder) {
        case 'area':
            sorted.sort((a, b) => (b.w * b.h) - (a.w * a.h));
            break;
        case 'height':
            sorted.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));
            break;
        case 'width':
            sorted.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));
            break;
        case 'perimeter':
            sorted.sort((a, b) => (2 * b.w + 2 * b.h) - (2 * a.w + 2 * a.h));
            break;
        case 'maxside':
            sorted.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));
            break;
        case 'smallfirst':
            sorted.sort((a, b) => (a.w * a.h) - (b.w * b.h));
            break;
        default:
            break;
    }

    // Create packer
    let packer;
    switch (algorithm) {
        case 'maxrects':
            packer = new MaxRectsPacker(usableW, usableH, heuristic);
            break;
        case 'guillotine':
            packer = new GuillotinePacker(usableW, usableH, splitRule || 'SAS', heuristic);
            break;
        case 'shelf':
            packer = new ShelfPacker(usableW, usableH, heuristic);
            break;
        default:
            packer = new MaxRectsPacker(usableW, usableH, heuristic);
    }

    const placements = [];
    const quantities = {};  // sizeId -> count
    let pieceCounter = 1;

    // Initialize quantity counts
    for (const s of sorted) {
        quantities[s.id] = 0;
    }

    if (fillOrder === 'cycle') {
        // Round-robin: try each size in turn, keep cycling until none fit
        let anyPlaced = true;
        while (anyPlaced) {
            anyPlaced = false;
            for (const size of sorted) {
                const effW = size.w + extra;
                const effH = size.h + extra;
                const result = packer.insert(effW, effH, allowRotation);
                if (result) {
                    const actualW = result.rotated ? size.h : size.w;
                    const actualH = result.rotated ? size.w : size.h;
                    quantities[size.id]++;
                    placements.push({
                        id: pieceCounter++,
                        sizeId: size.id,
                        label: size.label,
                        x: result.x,
                        y: result.y,
                        w: actualW,
                        h: actualH,
                        rotated: result.rotated,
                        origW: size.w,
                        origH: size.h
                    });
                    anyPlaced = true;
                }
            }
        }
    } else {
        // Priority fill: exhaust largest/priority sizes first, then smaller
        // For each size, place as many as will fit, then move to next
        for (const size of sorted) {
            const effW = size.w + extra;
            const effH = size.h + extra;
            let placed = true;
            while (placed) {
                const result = packer.insert(effW, effH, allowRotation);
                if (result) {
                    const actualW = result.rotated ? size.h : size.w;
                    const actualH = result.rotated ? size.w : size.h;
                    quantities[size.id]++;
                    placements.push({
                        id: pieceCounter++,
                        sizeId: size.id,
                        label: size.label,
                        x: result.x,
                        y: result.y,
                        w: actualW,
                        h: actualH,
                        rotated: result.rotated,
                        origW: size.w,
                        origH: size.h
                    });
                } else {
                    placed = false;
                }
            }
        }

        // Second pass: after all priority sizes are exhausted, try smaller sizes
        // again in remaining gaps
        let anyMore = true;
        while (anyMore) {
            anyMore = false;
            for (const size of sorted) {
                const effW = size.w + extra;
                const effH = size.h + extra;
                const result = packer.insert(effW, effH, allowRotation);
                if (result) {
                    const actualW = result.rotated ? size.h : size.w;
                    const actualH = result.rotated ? size.w : size.h;
                    quantities[size.id]++;
                    placements.push({
                        id: pieceCounter++,
                        sizeId: size.id,
                        label: size.label,
                        x: result.x,
                        y: result.y,
                        w: actualW,
                        h: actualH,
                        rotated: result.rotated,
                        origW: size.w,
                        origH: size.h
                    });
                    anyMore = true;
                }
            }
        }
    }

    const totalUsed = placements.reduce((sum, p) => sum + p.w * p.h, 0);
    const sheetArea = sheetW * sheetH;
    const waste = sheetArea - totalUsed;
    const utilization = sheetArea > 0 ? (totalUsed / sheetArea) * 100 : 0;

    return {
        placements,
        quantities,
        totalUsed,
        waste,
        utilization,
        sheetW,
        sheetH,
        algorithm,
        heuristic,
        fillOrder,
        splitRule: splitRule || '',
        placedCount: placements.length,
        sizeCount: pieceSizes.length
    };
}

// ─── Multi-layout Generator ─────────────────────────────────────────────────

/**
 * Generate multiple auto-fill layouts using different strategy combos,
 * return the top N unique layouts by utilization.
 */
function generateTopLayouts(params, topN = 10) {
    const strategies = [];

    const mrHeuristics = ['BSSF', 'BLSF', 'BAF', 'BL', 'CP'];
    const guiSplits = ['SAS', 'LAS', 'SLS', 'LLS', 'MINAS', 'MAXAS'];
    const guiChoices = ['BSSF', 'BLSF', 'BAF'];
    const shelfHeuristics = ['NF', 'FF', 'BF'];
    const fillOrders = ['area', 'height', 'width', 'perimeter', 'maxside', 'smallfirst', 'cycle'];

    for (const h of mrHeuristics) {
        for (const f of fillOrders) {
            strategies.push({ algorithm: 'maxrects', heuristic: h, fillOrder: f });
        }
    }
    for (const split of guiSplits) {
        for (const choice of guiChoices) {
            for (const f of fillOrders) {
                strategies.push({ algorithm: 'guillotine', heuristic: choice, fillOrder: f, splitRule: split });
            }
        }
    }
    for (const h of shelfHeuristics) {
        for (const f of fillOrders) {
            strategies.push({ algorithm: 'shelf', heuristic: h, fillOrder: f });
        }
    }

    const results = [];
    const seen = new Set();

    for (const strat of strategies) {
        const layout = generateLayout({ ...params, ...strat });

        // Fingerprint by quantities + positions
        const fingerprint = layout.placements
            .map(p => `${p.sizeId}:${p.x.toFixed(1)},${p.y.toFixed(1)},${p.w},${p.h}`)
            .sort()
            .join('|');

        if (!seen.has(fingerprint)) {
            seen.add(fingerprint);
            layout.strategyLabel = `${strat.algorithm}/${strat.heuristic}` +
                (strat.splitRule ? `/${strat.splitRule}` : '') +
                ` fill:${strat.fillOrder}`;
            results.push(layout);
        }
    }

    // Best utilization first
    results.sort((a, b) => b.utilization - a.utilization);

    return results.slice(0, topN);
}
