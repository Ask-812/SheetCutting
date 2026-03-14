/**
 * Advanced Sheet Cutting Optimizer
 * Genetic Algorithm + Simulated Annealing hybrid
 *
 * Research-grade metaheuristic for 2D auto-fill bin packing.
 * Uses MaxRects as a decoding heuristic within a GA+SA framework.
 *
 * References:
 *   Burke et al. (2004) – MaxRects placement heuristic
 *   Hopper & Turton (2001) – GA for 2D strip packing
 *   Alvarez-Valdés et al. (2009) – GRASP for 2D cutting
 */

class PackingOptimizer {
    constructor(params) {
        this.sheetW = params.sheetW;
        this.sheetH = params.sheetH;
        this.pieceSizes = params.pieceSizes;
        this.gap = params.gap || 0;
        this.kerf = params.kerf || 0;
        this.margin = params.boundaryMargin || 0;
        this.allowRotation = params.allowRotation !== false;

        this.usableW = this.sheetW - 2 * this.margin;
        this.usableH = this.sheetH - 2 * this.margin;
        this.extra = this.kerf + this.gap;

        this.numSizes = this.pieceSizes.length;

        // Pre-compute effective dimensions
        this.effSizes = this.pieceSizes.map(s => ({
            id: s.id, label: s.label, w: s.w, h: s.h,
            effW: s.w + this.extra,
            effH: s.h + this.extra,
            area: s.w * s.h
        }));

        // Chromosome length: enough genes to fill the sheet
        const minEffArea = Math.min(...this.effSizes.map(s =>
            Math.min(s.effW * s.effH, s.effH * s.effW)
        ));
        this.seqLen = Math.min(
            Math.ceil((this.usableW * this.usableH) / Math.max(minEffArea, 1)) * 1.3 + 10,
            500
        );
        this.seqLen = Math.max(this.seqLen | 0, this.numSizes * 4);

        // Early-exit threshold: if this many consecutive inserts fail, sheet is full
        this.failThreshold = this.numSizes * 3;

        // Cache for fitness evaluations
        this._evalCount = 0;
    }

    // ─── Decoder ─────────────────────────────────────────────────────────────
    // Takes a sequence of size-indices and a MaxRects heuristic,
    // places as many pieces as fit, returns a full layout result.

    decode(seq, heuristic) {
        if (this.usableW <= 0 || this.usableH <= 0) return this._emptyResult();

        const packer = new MaxRectsPacker(this.usableW, this.usableH, heuristic);
        const placements = [];
        const qtyMap = {};
        for (const s of this.pieceSizes) qtyMap[s.id] = 0;

        let pid = 1;
        let consecutiveFails = 0;

        for (let i = 0; i < seq.length; i++) {
            const idx = seq[i];
            if (idx < 0 || idx >= this.numSizes) continue;
            const s = this.effSizes[idx];

            const res = packer.insert(s.effW, s.effH, this.allowRotation);
            if (res) {
                consecutiveFails = 0;
                const w = res.rotated ? s.h : s.w;
                const h = res.rotated ? s.w : s.h;
                qtyMap[s.id]++;
                placements.push({
                    id: pid++, sizeId: s.id, label: s.label,
                    x: res.x + this.margin, y: res.y + this.margin,
                    w, h, rotated: res.rotated,
                    origW: s.w, origH: s.h
                });
            } else {
                consecutiveFails++;
                if (consecutiveFails >= this.failThreshold) break; // sheet is full
            }
        }

        const totalUsed = placements.reduce((a, p) => a + p.w * p.h, 0);
        const sheetArea = this.sheetW * this.sheetH;
        this._evalCount++;

        return {
            placements, quantities: qtyMap, totalUsed,
            waste: sheetArea - totalUsed,
            utilization: sheetArea > 0 ? (totalUsed / sheetArea) * 100 : 0,
            placedCount: placements.length,
            sizeCount: this.numSizes,
            sheetW: this.sheetW, sheetH: this.sheetH
        };
    }

    // Quick fitness-only evaluation (avoids building full placement list)
    fitness(seq, heuristic) {
        if (this.usableW <= 0 || this.usableH <= 0) return 0;

        const packer = new MaxRectsPacker(this.usableW, this.usableH, heuristic);
        let totalUsed = 0;
        let consecutiveFails = 0;

        for (let i = 0; i < seq.length; i++) {
            const idx = seq[i];
            if (idx < 0 || idx >= this.numSizes) continue;
            const s = this.effSizes[idx];

            const res = packer.insert(s.effW, s.effH, this.allowRotation);
            if (res) {
                consecutiveFails = 0;
                const w = res.rotated ? s.h : s.w;
                const h = res.rotated ? s.w : s.h;
                totalUsed += w * h;
            } else {
                consecutiveFails++;
                if (consecutiveFails >= this.failThreshold) break;
            }
        }

        this._evalCount++;
        return (totalUsed / (this.sheetW * this.sheetH)) * 100;
    }

    _emptyResult() {
        const qtyMap = {};
        for (const s of this.pieceSizes) qtyMap[s.id] = 0;
        return {
            placements: [], quantities: qtyMap, totalUsed: 0,
            waste: this.sheetW * this.sheetH, utilization: 0,
            placedCount: 0, sizeCount: this.numSizes,
            sheetW: this.sheetW, sheetH: this.sheetH
        };
    }

    // ─── Sequence Generators ─────────────────────────────────────────────────

    randomSeq() {
        const seq = new Array(this.seqLen);
        for (let i = 0; i < this.seqLen; i++) {
            seq[i] = Math.floor(Math.random() * this.numSizes);
        }
        return seq;
    }

    // Ordered fill: repeat sizes in sorted order
    seededSeq(order) {
        const indices = this.effSizes.map((_, i) => i);
        switch (order) {
            case 'area':
                indices.sort((a, b) => this.effSizes[b].area - this.effSizes[a].area);
                break;
            case 'smallfirst':
                indices.sort((a, b) => this.effSizes[a].area - this.effSizes[b].area);
                break;
            case 'width':
                indices.sort((a, b) =>
                    Math.max(this.effSizes[b].w, this.effSizes[b].h) -
                    Math.max(this.effSizes[a].w, this.effSizes[a].h));
                break;
            case 'ratio':
                indices.sort((a, b) => {
                    const rA = Math.max(this.effSizes[a].w, this.effSizes[a].h) /
                               Math.min(this.effSizes[a].w, this.effSizes[a].h);
                    const rB = Math.max(this.effSizes[b].w, this.effSizes[b].h) /
                               Math.min(this.effSizes[b].w, this.effSizes[b].h);
                    return rA - rB; // squarest first
                });
                break;
            default: break;
        }
        const seq = [];
        while (seq.length < this.seqLen) {
            for (const idx of indices) {
                seq.push(idx);
                if (seq.length >= this.seqLen) break;
            }
        }
        return seq;
    }

    // Fill sequence prioritizing one size, then others
    prioritySeq(primaryIdx) {
        const seq = [];
        // Fill 60% with primary, rest random
        const primaryCount = Math.floor(this.seqLen * 0.6);
        for (let i = 0; i < primaryCount; i++) seq.push(primaryIdx);
        while (seq.length < this.seqLen) {
            seq.push(Math.floor(Math.random() * this.numSizes));
        }
        // Shuffle
        for (let i = seq.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [seq[i], seq[j]] = [seq[j], seq[i]];
        }
        return seq;
    }

    // ─── GENETIC ALGORITHM ───────────────────────────────────────────────────

    runGA(config = {}) {
        const {
            popSize = 100,
            generations = 200,
            tournamentSize = 5,
            crossoverRate = 0.85,
            mutationRate = 0.20,
            eliteCount = 3,
            onProgress = null
        } = config;

        const heuristics = ['BSSF', 'BLSF', 'BAF', 'BL', 'CP'];

        // ── Initialize population ──
        let pop = [];

        // Seed with deterministic good starting points
        const seedOrders = ['area', 'smallfirst', 'width', 'ratio'];
        for (const order of seedOrders) {
            for (const h of heuristics) {
                if (pop.length >= popSize) break;
                pop.push({
                    seq: this.seededSeq(order),
                    heur: h,
                    fit: -1
                });
            }
        }

        // Seed with priority sequences (one per size type)
        for (let s = 0; s < this.numSizes && pop.length < popSize; s++) {
            for (const h of ['BSSF', 'BAF']) {
                if (pop.length >= popSize) break;
                pop.push({
                    seq: this.prioritySeq(s),
                    heur: h,
                    fit: -1
                });
            }
        }

        // Fill rest with random
        while (pop.length < popSize) {
            pop.push({
                seq: this.randomSeq(),
                heur: heuristics[Math.floor(Math.random() * heuristics.length)],
                fit: -1
            });
        }

        // Evaluate initial pop
        for (const ind of pop) {
            ind.fit = this.fitness(ind.seq, ind.heur);
        }

        let bestEver = this._cloneBest(pop);
        let stagnation = 0;

        // ── Evolution loop ──
        for (let gen = 0; gen < generations; gen++) {
            pop.sort((a, b) => b.fit - a.fit);
            const newPop = [];

            // Elitism: preserve top individuals
            for (let i = 0; i < eliteCount && i < pop.length; i++) {
                newPop.push(this._cloneInd(pop[i]));
            }

            // Generate offspring
            while (newPop.length < popSize) {
                const p1 = this._tournament(pop, tournamentSize);
                const p2 = this._tournament(pop, tournamentSize);

                let child;
                if (Math.random() < crossoverRate) {
                    child = this._crossover(p1, p2);
                } else {
                    child = this._cloneInd(p1);
                }

                if (Math.random() < mutationRate) {
                    this._mutate(child);
                }

                child.fit = this.fitness(child.seq, child.heur);
                newPop.push(child);
            }

            pop = newPop;

            // Track best
            const genBest = this._cloneBest(pop);
            if (genBest.fit > bestEver.fit) {
                bestEver = genBest;
                stagnation = 0;
            } else {
                stagnation++;
            }

            // Adaptive restart: if stagnated, inject fresh diversity
            if (stagnation > 25) {
                const replaceCount = Math.floor(popSize * 0.3);
                pop.sort((a, b) => b.fit - a.fit);
                for (let i = popSize - replaceCount; i < popSize; i++) {
                    // Half: mutated copies of best, Half: random
                    if (Math.random() < 0.5) {
                        pop[i] = this._cloneInd(bestEver);
                        this._mutate(pop[i]);
                        this._mutate(pop[i]); // double-mutate for diversity
                        pop[i].fit = this.fitness(pop[i].seq, pop[i].heur);
                    } else {
                        pop[i] = {
                            seq: this.randomSeq(),
                            heur: heuristics[Math.floor(Math.random() * heuristics.length)],
                            fit: -1
                        };
                        pop[i].fit = this.fitness(pop[i].seq, pop[i].heur);
                    }
                }
                stagnation = 0;
            }

            if (onProgress) onProgress(gen + 1, generations, bestEver.fit);
        }

        return bestEver;
    }

    _cloneInd(ind) {
        return { seq: ind.seq.slice(), heur: ind.heur, fit: ind.fit };
    }

    _cloneBest(pop) {
        let best = pop[0];
        for (let i = 1; i < pop.length; i++) {
            if (pop[i].fit > best.fit) best = pop[i];
        }
        return this._cloneInd(best);
    }

    _tournament(pop, k) {
        let best = pop[Math.floor(Math.random() * pop.length)];
        for (let i = 1; i < k; i++) {
            const c = pop[Math.floor(Math.random() * pop.length)];
            if (c.fit > best.fit) best = c;
        }
        return best;
    }

    _crossover(p1, p2) {
        const len = this.seqLen;
        const child = new Array(len);

        // Two-point crossover
        let a = Math.floor(Math.random() * len);
        let b = Math.floor(Math.random() * len);
        if (a > b) [a, b] = [b, a];

        for (let i = 0; i < len; i++) {
            child[i] = (i >= a && i <= b) ? p2.seq[i] : p1.seq[i];
        }

        return {
            seq: child,
            heur: Math.random() < 0.5 ? p1.heur : p2.heur,
            fit: -1
        };
    }

    _mutate(ind) {
        const n = this.numSizes;
        const len = this.seqLen;
        const r = Math.random();

        if (r < 0.25) {
            // Multi-point mutation: change 1-4 random genes
            const count = 1 + Math.floor(Math.random() * 4);
            for (let i = 0; i < count; i++) {
                ind.seq[Math.floor(Math.random() * len)] = Math.floor(Math.random() * n);
            }
        } else if (r < 0.40) {
            // Swap mutation: swap 2 positions
            const i = Math.floor(Math.random() * len);
            const j = Math.floor(Math.random() * len);
            [ind.seq[i], ind.seq[j]] = [ind.seq[j], ind.seq[i]];
        } else if (r < 0.55) {
            // Segment shuffle: shuffle a random segment of 3-8 genes
            const start = Math.floor(Math.random() * (len - 3));
            const segLen = 3 + Math.floor(Math.random() * 6);
            const end = Math.min(start + segLen, len);
            for (let i = end - 1; i > start; i--) {
                const j = start + Math.floor(Math.random() * (i - start + 1));
                [ind.seq[i], ind.seq[j]] = [ind.seq[j], ind.seq[i]];
            }
        } else if (r < 0.70) {
            // Block fill: fill a segment with one size type
            const sizeIdx = Math.floor(Math.random() * n);
            const start = Math.floor(Math.random() * (len - 2));
            const blockLen = 2 + Math.floor(Math.random() * 5);
            for (let i = start; i < Math.min(start + blockLen, len); i++) {
                ind.seq[i] = sizeIdx;
            }
        } else if (r < 0.85) {
            // Inversion: reverse a random segment
            const start = Math.floor(Math.random() * (len - 2));
            const end = Math.min(start + 3 + Math.floor(Math.random() * 8), len);
            let l = start, rr = end - 1;
            while (l < rr) {
                [ind.seq[l], ind.seq[rr]] = [ind.seq[rr], ind.seq[l]];
                l++; rr--;
            }
        } else {
            // Heuristic mutation: change placement heuristic
            const heuristics = ['BSSF', 'BLSF', 'BAF', 'BL', 'CP'];
            ind.heur = heuristics[Math.floor(Math.random() * heuristics.length)];
        }
    }

    // ─── SIMULATED ANNEALING ─────────────────────────────────────────────────

    runSA(initial, config = {}) {
        const {
            iterations = 40000,
            initialTemp = 8.0,
            coolingRate = 0.99985,
            onProgress = null
        } = config;

        const n = this.numSizes;
        const len = this.seqLen;

        // Work on mutable copy
        const curSeq = initial.seq.slice();
        let curHeur = initial.heur;
        let curFit = this.fitness(curSeq, curHeur);

        const bestSeq = curSeq.slice();
        let bestHeur = curHeur;
        let bestFit = curFit;

        let temp = initialTemp;

        for (let i = 0; i < iterations; i++) {
            // Generate neighbor in-place, save undo info
            const moveType = Math.random();
            let undo;

            if (moveType < 0.35) {
                // Swap two positions
                const a = Math.floor(Math.random() * len);
                const b = Math.floor(Math.random() * len);
                undo = { type: 'swap', a, b };
                [curSeq[a], curSeq[b]] = [curSeq[b], curSeq[a]];
            } else if (moveType < 0.70) {
                // Point change
                const pos = Math.floor(Math.random() * len);
                const oldVal = curSeq[pos];
                curSeq[pos] = Math.floor(Math.random() * n);
                undo = { type: 'point', pos, oldVal };
            } else if (moveType < 0.85) {
                // Block fill
                const sizeIdx = Math.floor(Math.random() * n);
                const start = Math.floor(Math.random() * (len - 2));
                const blockLen = 1 + Math.floor(Math.random() * 3);
                const end = Math.min(start + blockLen, len);
                const saved = curSeq.slice(start, end);
                for (let j = start; j < end; j++) curSeq[j] = sizeIdx;
                undo = { type: 'block', start, saved };
            } else {
                // Segment reverse
                const start = Math.floor(Math.random() * (len - 2));
                const end = Math.min(start + 2 + Math.floor(Math.random() * 5), len);
                let l = start, r = end - 1;
                while (l < r) {
                    [curSeq[l], curSeq[r]] = [curSeq[r], curSeq[l]];
                    l++; r--;
                }
                undo = { type: 'reverse', start, end };
            }

            const newFit = this.fitness(curSeq, curHeur);
            const delta = newFit - curFit;

            if (delta > 0 || Math.random() < Math.exp(delta / temp)) {
                curFit = newFit;
                if (curFit > bestFit) {
                    bestFit = curFit;
                    for (let j = 0; j < len; j++) bestSeq[j] = curSeq[j];
                    bestHeur = curHeur;
                }
            } else {
                // Revert
                this._undoMove(curSeq, undo);
            }

            temp *= coolingRate;

            if (onProgress && (i & 0xFFF) === 0) { // every 4096 iterations
                onProgress(i, iterations, bestFit);
            }
        }

        return { seq: bestSeq, heur: bestHeur, fit: bestFit };
    }

    _undoMove(seq, undo) {
        switch (undo.type) {
            case 'swap':
                [seq[undo.a], seq[undo.b]] = [seq[undo.b], seq[undo.a]];
                break;
            case 'point':
                seq[undo.pos] = undo.oldVal;
                break;
            case 'block':
                for (let j = 0; j < undo.saved.length; j++) {
                    seq[undo.start + j] = undo.saved[j];
                }
                break;
            case 'reverse':
                let l = undo.start, r = undo.end - 1;
                while (l < r) {
                    [seq[l], seq[r]] = [seq[r], seq[l]];
                    l++; r--;
                }
                break;
        }
    }

    // ─── ITERATED LOCAL SEARCH ───────────────────────────────────────────────
    // Fast hill-climbing refinement on top of SA/GA output

    runILS(initial, config = {}) {
        const { iterations = 5000 } = config;
        const n = this.numSizes;
        const len = this.seqLen;

        const seq = initial.seq.slice();
        let heur = initial.heur;
        let fit = this.fitness(seq, heur);

        for (let i = 0; i < iterations; i++) {
            const pos = Math.floor(Math.random() * len);
            const oldVal = seq[pos];
            const newVal = Math.floor(Math.random() * n);
            seq[pos] = newVal;

            const newFit = this.fitness(seq, heur);
            if (newFit >= fit) {
                fit = newFit;
            } else {
                seq[pos] = oldVal; // revert
            }
        }

        return { seq, heur, fit };
    }

    // ─── FULL OPTIMIZATION PIPELINE ──────────────────────────────────────────

    optimize(config = {}) {
        const {
            topN = 10,
            gaPopSize = 100,
            gaGenerations = 200,
            saIterations = 40000,
            ilsIterations = 5000,
            onProgress = null
        } = config;

        this._evalCount = 0;
        const results = [];
        const seen = new Set();

        const addResult = (result, label) => {
            const fp = result.placements
                .map(p => `${p.sizeId}:${p.x.toFixed(1)},${p.y.toFixed(1)},${p.w},${p.h}`)
                .sort().join('|');
            if (!seen.has(fp)) {
                seen.add(fp);
                result.strategyLabel = label;
                results.push(result);
            }
        };

        // ── Phase 1: Genetic Algorithm ──
        if (onProgress) onProgress('ga', 0, 0, 'Running Genetic Algorithm...');
        const gaBest = this.runGA({
            popSize: gaPopSize,
            generations: gaGenerations,
            onProgress: onProgress ?
                (gen, total, fit) => onProgress('ga', gen / total, fit, `GA generation ${gen}/${total}`) : null
        });
        const gaResult = this.decode(gaBest.seq, gaBest.heur);
        addResult(gaResult, `GA best (${gaGenerations} gen, ${gaBest.heur})`);

        // ── Phase 2: Simulated Annealing from GA's best ──
        if (onProgress) onProgress('sa', 0, gaBest.fit, 'Running Simulated Annealing...');
        const saBest = this.runSA(gaBest, {
            iterations: saIterations,
            onProgress: onProgress ?
                (iter, total, fit) => onProgress('sa', iter / total, fit, `SA iteration ${iter}/${total}`) : null
        });
        const saResult = this.decode(saBest.seq, saBest.heur);
        addResult(saResult, `GA→SA hybrid (${saBest.heur})`);

        // ── Phase 3: Iterated Local Search refinement ──
        if (onProgress) onProgress('ils', 0, saBest.fit, 'Running Local Search...');
        const ilsBest = this.runILS(saBest, { iterations: ilsIterations });
        const ilsResult = this.decode(ilsBest.seq, ilsBest.heur);
        addResult(ilsResult, `GA→SA→ILS (${ilsBest.heur})`);

        // ── Phase 4: Multiple SA restarts from diverse seeds ──
        if (onProgress) onProgress('sa2', 0, ilsBest.fit, 'Exploring alternatives...');
        const heuristics = ['BSSF', 'BLSF', 'BAF', 'BL', 'CP'];
        const seeds = ['area', 'smallfirst', 'width', 'ratio'];
        for (let i = 0; i < Math.min(4, seeds.length); i++) {
            const seedSeq = this.seededSeq(seeds[i]);
            const seedHeur = heuristics[i % heuristics.length];
            const sa2 = this.runSA(
                { seq: seedSeq, heur: seedHeur, fit: 0 },
                { iterations: Math.floor(saIterations / 3) }
            );
            const sa2Result = this.decode(sa2.seq, sa2.heur);
            addResult(sa2Result, `SA-restart (${seeds[i]}, ${sa2.heur})`);
        }

        // ── Phase 5: Include heuristic baseline results for diversity ──
        if (onProgress) onProgress('heuristics', 0, 0, 'Running heuristic baselines...');
        const heuristicResults = generateTopLayouts({
            sheetW: this.sheetW, sheetH: this.sheetH,
            pieceSizes: this.pieceSizes,
            gap: this.gap, kerf: this.kerf,
            boundaryMargin: this.margin,
            allowRotation: this.allowRotation
        }, topN);
        for (const hr of heuristicResults) {
            addResult(hr, hr.strategyLabel);
        }

        // Sort by utilization
        results.sort((a, b) => b.utilization - a.utilization);

        if (onProgress) {
            const best = results[0];
            onProgress('done', 1, best ? best.utilization : 0,
                `Done! ${this._evalCount.toLocaleString()} evaluations`);
        }

        return results.slice(0, topN);
    }
}
