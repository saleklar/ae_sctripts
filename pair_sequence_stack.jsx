// Pair, Sequence & Stack Script
// Scans the Project panel footage for ID numbers in names,
// groups them into land/win/pop sets and builds sequenced precomps.
// No active composition required.

(function () {

    app.beginUndoGroup("Pair Sequence Stack");

    try {

        // ----------------------------------------------------------------
        // Step 0: Optionally remove items created by a previous run
        // ----------------------------------------------------------------
        var doCleanup = confirm("Remove compositions from a previous script run before continuing?\n\nClick OK to clean up first, Cancel to skip cleanup and continue.");

        var cleanupPatterns = [
            /^Pair_/,
            /^Solo_/,
            /^reel_\d+$/,
            /^Reels_Group$/,
            /^Master$/
        ];

        function matchesCleanup(name) {
            for (var ci = 0; ci < cleanupPatterns.length; ci++) {
                if (cleanupPatterns[ci].test(name)) return true;
            }
            return false;
        }

        // Collect first, then remove — avoids invalidated references mid-loop.
        // Remove in dependency order: containers before the precomps they use.
        if (doCleanup) {
            var toRemove = [];
            for (var di = 1; di <= app.project.items.length; di++) {
                var item = app.project.items[di];
                if (item && (item instanceof CompItem) && matchesCleanup(item.name)) {
                    toRemove.push(item);
                }
            }

            // Sort so that "outer" comps are removed first (Master, Reels_Group,
            // reel_N) before the inner precomps (Pair_, Solo_) they reference.
            var order = ["^Master$", "^Reels_Group$", "^reel_\\d+$", "^Pair_", "^Solo_"];
            toRemove.sort(function (a, b) {
                function rank(name) {
                    for (var oi = 0; oi < order.length; oi++) {
                        if (new RegExp(order[oi]).test(name)) return oi;
                    }
                    return order.length;
                }
                return rank(a.name) - rank(b.name);
            });

            for (var ri = 0; ri < toRemove.length; ri++) {
                try { toRemove[ri].remove(); } catch (ignore) {}
            }
        }

        // ----------------------------------------------------------------
        // Step 1: Scan project panel FootageItems and group by ID number
        // ----------------------------------------------------------------
        var layerGroups = {};  // id -> { land, win, pop }  (FootageItems)
        var idOrder     = [];  // preserves encounter order

        for (var i = 1; i <= app.project.items.length; i++) {
            var item;
            try { item = app.project.items[i]; } catch (e) { continue; }
            if (!item || !(item instanceof FootageItem)) continue;

            var iname = item.name;
            var idMatch = iname.match(/(\d+)/);
            if (!idMatch) continue;

            var id = idMatch[1];

            // Skip stat PNGs — they are handled separately
            if (iname.toLowerCase().indexOf("stat") !== -1) continue;

            if (!layerGroups[id]) {
                layerGroups[id] = { land: null, win: null, pop: null };
                idOrder.push(id);
            }

            var lower = iname.toLowerCase();
            if (lower.indexOf("land") !== -1) {
                layerGroups[id].land = item;
            } else if (lower.indexOf("win") !== -1) {
                layerGroups[id].win = item;
            } else if (lower.indexOf("pop") !== -1) {
                layerGroups[id].pop = item;
            }
        }

        // Groups:
        //  - full: has land + win (pop optional)
        //  - solo: only win (stat->win), only land, or only pop
        var pairs = [];
        var solos = [];
        for (var k = 0; k < idOrder.length; k++) {
            var g = layerGroups[idOrder[k]];
            if (g.land && g.win) {
                pairs.push({ id: idOrder[k], land: g.land, win: g.win, pop: g.pop });
            } else if (g.win) {
                solos.push({ id: idOrder[k], layer: g.win, type: "win" });
            } else if (g.land) {
                solos.push({ id: idOrder[k], layer: g.land, type: "land" });
            } else if (g.pop) {
                solos.push({ id: idOrder[k], layer: g.pop, type: "pop" });
            }
        }

        var totalSlots = pairs.length + solos.length;

        if (totalSlots === 0) {
            alert("No layers with ID numbers found.\nLayer names must contain a number AND optionally 'land' or 'win'.");
            app.endUndoGroup();
            return;
        }

        // ----------------------------------------------------------------
        // Step 2: Ask for frame rate and symbol visible area size
        // ----------------------------------------------------------------
        var frInput = prompt("Enter composition frame rate:", "30");
        if (frInput === null) { app.endUndoGroup(); return; }
        var fr = parseFloat(frInput);
        if (isNaN(fr) || fr <= 0) { alert("Invalid frame rate."); app.endUndoGroup(); return; }

        // All compositions are fixed at 1000 frames
        var fixedDur = 1000 / fr;

        var sizeInput = prompt(
            "Found " + pairs.length + " land/win pair(s) and " + solos.length + " solo layer(s).\n" +
            "Total precomps: " + totalSlots + "\n\nEnter symbol visible area size (px):",
            "164"
        );

        if (sizeInput === null) {
            app.endUndoGroup();
            return;
        }

        var symSize = parseInt(sizeInput, 10);

        if (isNaN(symSize) || symSize <= 0) {
            alert("Invalid size. Please enter a positive integer.");
            app.endUndoGroup();
            return;
        }

        // compSize is 50% larger — used for precomp and master width so layers are never cropped.
        // symSize is still used for stacking step and master height (the reel slot size).
        var compSize = Math.round(symSize * 1.5);

        // ----------------------------------------------------------------
        // Pre-scan: compute normalized phase durations so every precomp has
        // an identical timeline layout → time remap on reel layer works uniformly.
        //   Stat phase  = normStatDurSec  (at t=0 in every precomp)
        //   Land phase  = normLandDurSec  (starts at normStatDurSec)
        //   Win  phase  = normWinDurSec   (starts at normStatDurSec + normLandDurSec)
        // ----------------------------------------------------------------
        var maxLandDurSec = 0, maxWinDurSec = 0;
        for (var pi2 = 0; pi2 < pairs.length; pi2++) {
            if (pairs[pi2].land.duration > maxLandDurSec) maxLandDurSec = pairs[pi2].land.duration;
            if (pairs[pi2].win.duration  > maxWinDurSec)  maxWinDurSec  = pairs[pi2].win.duration;
        }
        // No buffer — phases are exact lengths; hold-last-frame via Time Remap on each layer.
        var normStatDurSec = maxLandDurSec;  // stat phase = same length as longest land
        var normLandDurSec = maxLandDurSec;  // land phase
        var normWinDurSec  = maxWinDurSec;   // win  phase

        // ----------------------------------------------------------------
        // Helper: find a stat FootageItem by ID — looks for any FootageItem
        // whose name contains the id number AND the word "stat" (case-insensitive).
        // Skips items whose name also contains land/win/pop so we don't
        // accidentally match a land/win layer that has "stat" in its path.
        // ----------------------------------------------------------------
        function findFootageByID(id) {
            // Pattern: id digits surrounded by non-digit boundaries, plus "stat"
            var idPattern  = new RegExp('(^|[^\\d])' + id + '([^\\d]|$)');
            var results = [];
            for (var fi = 1; fi <= app.project.items.length; fi++) {
                var fitem = app.project.items[fi];
                if (!(fitem instanceof FootageItem)) continue;
                var fn = fitem.name.toLowerCase();
                if (fn.indexOf('stat') === -1) continue;
                if (!idPattern.test(fn)) continue;
                results.push(fitem);
            }
            if (results.length === 0) return null;
            // Prefer exact match where 'stat' and id are closest together
            return results[0];
        }

        // ----------------------------------------------------------------
        // Step 3: Create a precomp per pair: stat -> land -> win [-> pop]
        // ----------------------------------------------------------------
        var precompItems = [];

        for (var p = 0; p < pairs.length; p++) {
            var pair      = pairs[p];
            var landFtg   = pair.land;   // FootageItem
            var winFtg    = pair.win;
            var popFtg    = pair.pop;    // may be null

            var landDur  = landFtg.duration;
            var winDur   = winFtg.duration;
            var popDur   = popFtg ? popFtg.duration : 0;

            var statFootage = findFootageByID(pair.id);
            var statDur     = statFootage ? landDur : 0;
            var totalDur    = statDur + landDur + winDur + popDur;

            var pcName = "Pair_" + pair.id;
            var pc = app.project.items.addComp(pcName, compSize, compSize, 1, fixedDur, fr);

            // --- Stat PNG at t=0 ---
            if (statFootage) {
                var statInPc = pc.layers.add(statFootage);
                statInPc.startTime = 0;
                statInPc.outPoint  = normStatDurSec;  // covers full stat phase
                statInPc.position.setValue([compSize / 2, compSize / 2]);
            }

            // --- Land: hold last frame for full phase via Time Remap ---
            var landInPc = pc.layers.add(landFtg);
            landInPc.startTime = normStatDurSec;
            landInPc.outPoint  = normStatDurSec + normLandDurSec;
            landInPc.position.setValue([compSize / 2, compSize / 2]);
            landInPc.timeRemapEnabled = true;
            landInPc.property("Time Remap").expression =
                'Math.min(time - ' + normStatDurSec + ', ' + (landFtg.duration - 1/fr) + ');';

            // --- Win: hold last frame via Time Remap; extend to end if no pop follows ---
            var winInPc = pc.layers.add(winFtg);
            winInPc.startTime = normStatDurSec + normLandDurSec;
            winInPc.outPoint  = popFtg ? (normStatDurSec + normLandDurSec + normWinDurSec) : fixedDur;
            winInPc.position.setValue([compSize / 2, compSize / 2]);
            winInPc.timeRemapEnabled = true;
            winInPc.property("Time Remap").expression =
                'Math.min(time - ' + (normStatDurSec + normLandDurSec) + ', ' + (winFtg.duration - 1/fr) + ');';

            // --- Pop after win (if present): hold last frame and extend to end of comp ---
            if (popFtg) {
                var popInPc = pc.layers.add(popFtg);
                popInPc.startTime = normStatDurSec + normLandDurSec + normWinDurSec;
                popInPc.outPoint  = fixedDur;
                popInPc.position.setValue([compSize / 2, compSize / 2]);
                popInPc.timeRemapEnabled = true;
                popInPc.property("Time Remap").expression =
                    'Math.min(time - ' + (normStatDurSec + normLandDurSec + normWinDurSec) + ', ' + (popFtg.duration - 1/fr) + ');';
            }

            precompItems.push(pc);
        }

        // ----------------------------------------------------------------
        // Step 3b: Solo precomps
        //   win-only  → stat -> win
        //   land-only → stat -> land
        //   pop-only  → stat -> pop
        // ----------------------------------------------------------------
        for (var s = 0; s < solos.length; s++) {
            var solo     = solos[s];
            var soloFtg  = solo.layer;   // FootageItem
            var soloDur  = soloFtg.duration;

            var soloStatFootage = findFootageByID(solo.id);
            var soloStatDur     = soloStatFootage ? soloDur : 0;
            var soloTotalDur    = soloStatDur + soloDur;

            var spc = app.project.items.addComp("Solo_" + solo.id, compSize, compSize, 1, fixedDur, fr);

            // --- Stat PNG before footage (covers full stat phase) ---
            if (soloStatFootage) {
                var soloStatInPc = spc.layers.add(soloStatFootage);
                soloStatInPc.startTime = 0;
                soloStatInPc.outPoint  = normStatDurSec;
                soloStatInPc.position.setValue([compSize / 2, compSize / 2]);
            }

            var soloInPc = spc.layers.add(soloFtg);
            soloInPc.startTime = normStatDurSec;
            soloInPc.outPoint  = fixedDur;  // freeze last frame to end of comp
            soloInPc.position.setValue([compSize / 2, compSize / 2]);
            soloInPc.timeRemapEnabled = true;
            soloInPc.property("Time Remap").expression =
                'Math.min(time - ' + normStatDurSec + ', ' + (soloFtg.duration - 1/fr) + ');';

            precompItems.push(spc);
        }

        // ----------------------------------------------------------------
        // Helper: Fisher-Yates shuffle — returns a NEW shuffled copy of arr
        // ----------------------------------------------------------------
        function shuffled(arr) {
            var copy = arr.slice();
            for (var n = copy.length - 1; n > 0; n--) {
                var rndIdx = Math.floor(Math.random() * (n + 1));
                var tmp    = copy[n];
                copy[n]    = copy[rndIdx];
                copy[rndIdx] = tmp;
            }
            return copy;
        }

        // Each reel has exactly CELLS_PER_REEL (5) cells so reel height is always
        // 5 × symSize — keeping Motion Tile output buffer well under AE's 30000px limit.
        //
        // landingIdx: index into orderedItems for the symbol that appears in the
        // CENTER cell (cell 2, 0-based).  Surrounding cells get adjacent symbols
        // (wrapped) so the reel looks varied while spinning.
        var CELLS_PER_REEL = 5;
        function buildReel(name, orderedItems, landingIdx) {
            var rH       = symSize * CELLS_PER_REEL;
            var reel     = app.project.items.addComp(name, compSize, rH, 1, fixedDur, fr);
            var n        = orderedItems.length;
            var spinDurS = 20 / fr;

            // Spin-start marker at reel-comp t=0.
            // The per-cell position expression reads thisComp.marker so it has no
            // cross-comp references and works at any nesting depth.
            reel.markerProperty.setValueAtTime(0, new MarkerValue("spin_start"));

            // Build a random symbol assignment for this reel's cells:
            //   - cell 2 (center/landing) always gets landingIdx
            //   - the other 4 cells are filled with a shuffled selection of the
            //     remaining symbols, so every cell shows something different and
            //     the overall reel looks varied rather than sequential.
            var otherIdxs = [];
            for (var oi = 0; oi < n; oi++) {
                if (oi !== landingIdx) otherIdxs.push(oi);
            }
            // Fisher-Yates shuffle the pool
            for (var fy = otherIdxs.length - 1; fy > 0; fy--) {
                var fyj = Math.floor(Math.random() * (fy + 1));
                var fyt = otherIdxs[fy]; otherIdxs[fy] = otherIdxs[fyj]; otherIdxs[fyj] = fyt;
            }
            // Map cell index → symbol index
            //   ci=0,1,3,4 pull from otherIdxs in order; ci=2 always landingIdx
            var cellSymIdx = [];
            var poolPick = 0;
            for (var cx = 0; cx < CELLS_PER_REEL; cx++) {
                if (cx === 2) {
                    cellSymIdx.push(landingIdx);
                } else {
                    // Wrap pool if n < CELLS_PER_REEL (fewer symbols than cells)
                    cellSymIdx.push(otherIdxs[poolPick % otherIdxs.length]);
                    poolPick++;
                }
            }

            for (var ci = 0; ci < CELLS_PER_REEL; ci++) {
                var visIdx = cellSymIdx[ci];
                var baseY  = symSize * 0.5 + ci * symSize;

                // Position expression: the cell scrolls downward (conveyor-belt) during
                // the spin phase and wraps seamlessly within the reel comp height.
                // After 3 full rotations (15 × symSize) every cell is back at its
                // original position, so no drift accumulates across spins.
                // Uses only thisComp.time and thisComp.marker — no parent-comp refs.
                var posExpr =
                    'var ci = ' + ci + ';' +
                    'var sym = ' + symSize + ';' +
                    'var nc  = ' + CELLS_PER_REEL + ';' +
                    'var dur = ' + spinDurS + ';' +
                    'var baseY = sym * 0.5 + ci * sym;' +
                    'var spinStart = -1;' +
                    'for (var mi = 1; mi <= thisComp.marker.numKeys; mi++) {' +
                    '  if (thisComp.marker.key(mi).comment === "spin_start") {' +
                    '    spinStart = thisComp.marker.key(mi).time; break;' +
                    '  }' +
                    '}' +
                    'var x = ' + (compSize / 2) + ';' +
                    'if (spinStart < 0 || time <= spinStart) {' +
                    '  [x, baseY];' +
                    '} else {' +
                    '  var t = Math.min(time - spinStart, dur) / dur;' +
                    // ease-out cubic: fast start, smooth deceleration like a real reel
                    '  var ease = 1 - Math.pow(1 - t, 3);' +
                    '  var scroll = ease * (nc * sym * 3);' +  // 3 full rotations
                    // wrap within [sym*0.5 … nc*sym - sym*0.5]
                    '  var y = ((baseY - sym * 0.5 + scroll) % (nc * sym)) + sym * 0.5;' +
                    '  [x, y];' +
                    '}';

                // Label colors per cell: 1=Red, 2=Yellow, 3=Aqua, 4=Pink, 5=Lavender
                var cellLabels = [1, 2, 3, 4, 5];

                for (var si = 0; si < n; si++) {
                    var rl = reel.layers.add(orderedItems[si]);
                    rl.label = cellLabels[ci % cellLabels.length];
                    rl.position.setValue([compSize / 2, baseY]);
                    rl.opacity.setValue(si === visIdx ? 100 : 0);
                    rl.position.expression = posExpr;

                    // Non-center cells must never animate — freeze them at t=0 (stat frame).
                    // Only the center cell (ci===2) plays land/win, driven by the outer
                    // Time Remap on the reel layer in Reels_Group.
                    if (ci !== 2) {
                        rl.timeRemapEnabled = true;
                        rl.property("Time Remap").expression = '0;';
                    }
                }
            }
            return reel;
        }

        // ----------------------------------------------------------------
        // Step 4: Build 5 reel compositions, each with exactly 5 cells.
        //   The landing symbol for each reel (cell 2, center row) is set
        //   by the "Reel N Symbol" slider — read at SCRIPT RUN TIME below.
        //   Other cells get adjacent symbols for visual spin variety.
        // ----------------------------------------------------------------
        var reelH    = symSize * CELLS_PER_REEL;   // FIXED: 5 cells × symSize
        var numReels = 5;

        // Default landing symbols: reel 1 → symbol 0, reel 2 → symbol 1, etc.
        // After the script runs, the "Reel N Symbol" sliders on Reel_Control show
        // which symbol is in each reel's landing cell.  Change and re-run to update.
        var reelComps = [];
        for (var reelIdx = 0; reelIdx < numReels; reelIdx++) {
            var landingIdx = reelIdx % precompItems.length;
            reelComps.push(buildReel("reel_" + (reelIdx + 1), precompItems, landingIdx));
        }

        // ----------------------------------------------------------------
        // Step 5: Create Reels_Group precomp — all reels side by side
        //   Width is made wide enough for max separator (up to symSize each gap)
        //   Reel positions use expressions driven by the Separator Width slider
        // ----------------------------------------------------------------
        // Max sep = symSize → total width = numReels*symSize + (numReels-1)*symSize
        var groupW   = Math.round(symSize * (2 * numReels - 1) * 1.2);
        var groupDur = fixedDur;

        var reelsGroup = app.project.items.addComp("Reels_Group", groupW, reelH, 1, groupDur, fr);
        // Reel centres are anchored around the middle of the comp (groupW/2).
        // X: spreads outward symmetrically via Separator Width slider.
        // Y: scrolls downward for 3 full spins, each reel delayed by Spin Delay slider (frames).
        var reelCenterOffset = (numReels - 1) / 2;  // = 2 for 5 reels
        var spins = 3;
        var spinDist = reelH * spins;

        for (var rgi = 0; rgi < reelComps.length; rgi++) {
            var rgl = reelsGroup.layers.add(reelComps[rgi]);

            // No Motion Tile needed: the conveyor-belt scroll is now driven by
            // per-cell position expressions INSIDE the reel comp.  Each cell
            // wraps within the reel comp's own height — the reel layer itself
            // stays fixed in Reels_Group.

            var spinDurSec = 20 / fr;

            // Position: X only — live separator spread.  Y is always reelH/2 (fixed).
            // This expression is at Reels_Group level → comp("Master") is safe (1 deep).
            rgl.position.setValue([groupW / 2 + (rgi - reelCenterOffset) * symSize, reelH / 2]);
            rgl.position.expression =
                'var sep  = comp("Master").layer("Reel_Control").effect("Separator Width")("Slider");' +
                'var step = ' + symSize + ' + sep;' +
                'var x    = ' + groupW + ' / 2 + (' + rgi + ' - ' + reelCenterOffset + ') * step;' +
                '[x, ' + (reelH / 2) + '];';

            // Time Remap: drives what moment of the reel comp is shown in master time.
            //
            // Reel comp timeline layout (all symbols start at t=0 in reel comp):
            //   t = 0 … sdur          → spin phase  (position expression scrolls cells)
            //   t = statPh … +landPh  → land animation plays in Pair_/Solo_ precomps
            //   t = statPh+landPh … +winPh → win animation
            //
            // Mapping:
            //   Before spin:   src = 0         (reel comp held at t=0, shows stat)
            //   During spin:   src advances 0 → sdur  (cell positions animate)
            //   After spin:    src = statPh     (jump past stat phase to land start)
            //                 then advances through landPh
            //   Post land:     src = 0          (back to stat)
            //   Win:           src = statPh+landPh, advances through winPh
            //   Post win:      src = 0
            //
            // Reading comp("Master") here is safe: this expression lives in
            // Reels_Group which is one level below Master — no circular dependency.
            rgl.timeRemapEnabled = true;
            rgl.property("Time Remap").expression =
                // Build sorted arrays of all spin_start and win_play marker times.
                'var spins = [], wins = [];' +
                'var mm = comp("Master").marker;' +
                'for (var mi = 1; mi <= mm.numKeys; mi++) {' +
                '  var c = mm.key(mi).comment;' +
                '  if (c == "spin_start") spins[spins.length] = mm.key(mi).time;' +
                '  if (c == "win_play")   wins[wins.length]   = mm.key(mi).time;' +
                '}' +
                'var rc     = comp("Master").layer("Reel_Control");' +
                'var winOn  = rc.effect("Reel ' + (rgi + 1) + ' Win")("Checkbox");' +
                'var delay  = ' + rgi + ' * rc.effect("Spin Delay")("Slider") * thisComp.frameDuration;' +
                'var sdur   = ' + spinDurSec + ';' +
                'var statPh = ' + normStatDurSec + ';' +
                'var landPh = ' + normLandDurSec + ';' +
                'var winPh  = ' + normWinDurSec  + ';' +
                // Find the LATEST spin_start (+ reel delay) that has already passed.
                // This isolates us to exactly one spin cycle — no cross-cycle overwrites.
                'var activeSS = -1, activeIdx = -1;' +
                'for (var si = 0; si < spins.length; si++) {' +
                '  var ss = spins[si] + delay;' +
                '  if (time >= ss) { activeSS = ss; activeIdx = si; }' +
                '}' +
                'var src = 0;' +
                'if (activeSS >= 0) {' +
                '  var se = activeSS + sdur;' +
                // Spin phase: reel-comp time 0→sdur
                '  if (time < se)                        src = time - activeSS;' +
                // Land phase: reel-comp statPh→statPh+landPh
                '  if (time >= se && time < se + landPh) src = statPh + (time - se);' +
                // Stat hold
                '  if (time >= se + landPh)              src = 0;' +
                // Win: use the win_play marker paired to this spin by index.
                // win_play markers are matched to spin_start markers in chronological order.
                // A win_play marker only fires if it falls AFTER this spin's land ends.
                '  var wp = (activeIdx >= 0 && activeIdx < wins.length) ? wins[activeIdx] : -1;' +
                '  if (winOn && wp >= se + landPh && time >= wp && time < wp + winPh) src = statPh + landPh + (time - wp);' +
                '  if (winOn && wp >= se + landPh && time >= wp + winPh)              src = 0;' +
                '}' +
                'src;';
        }

        // ----------------------------------------------------------------
        // Step 6: Ask for background image (needed for master comp size)
        // ----------------------------------------------------------------
        var bgFile    = File.openDialog("Select background image", "Image Files:*.png,*.jpg,*.jpeg,*.tif,*.tiff,*.bmp,*.psd;*.png;*.jpg;*.jpeg;*.tif;*.tiff;*.bmp;*.psd");
        var bgFootage = null;

        var masterW, masterH;
        if (bgFile) {
            var importOpts = new ImportOptions(bgFile);
            bgFootage      = app.project.importFile(importOpts);
            // Master comp is half the background size
            masterW        = Math.round(bgFootage.width  / 2);
            masterH        = Math.round(bgFootage.height / 2);
        } else {
            // Fallback if no background selected
            masterW = 5 * symSize;
            masterH = 3 * symSize;
        }

        // ----------------------------------------------------------------
        // Step 7: Create Master precomp at background size
        //   Contains: Reels_Group layer + white solid matte on top
        // ----------------------------------------------------------------
        var masterComp = app.project.items.addComp("Master", masterW, masterH, 1, groupDur, fr);
        masterComp.openInViewer();

        // Add "spin_start" marker (frame 10) — move to control when reels begin.
        var spinMarker = new MarkerValue("spin_start");
        masterComp.markerProperty.setValueAtTime(10 / fr, spinMarker);

        // "win_play" marker — all winning symbols play win animation simultaneously.
        // Default: placed just after the last reel's land animation completes.
        // (spin_start@10fr + 4 reels × 2fr delay + 20fr spin + land phase + 4fr buffer)
        var defaultLastReelEnd = (10 + 4 * 2 + 20) / fr + normLandDurSec;
        var winPlayTime = defaultLastReelEnd + 4 / fr;
        var winMarker = new MarkerValue("win_play");
        masterComp.markerProperty.setValueAtTime(winPlayTime, winMarker);

        // Second "spin_start" marker — placed after win animation completes.
        // Move it anywhere in the timeline; the reels will spin again from there.
        var spin2Time = winPlayTime + normWinDurSec + 10 / fr;
        var spinMarker2 = new MarkerValue("spin_start");
        masterComp.markerProperty.setValueAtTime(spin2Time, spinMarker2);

        // ----------------------------------------------------------------
        // Step 7: Build Master comp layer stack
        //   Null must be created FIRST so expressions can resolve "Reel_Control"
        // ----------------------------------------------------------------

        // --- 7a: Null with Separator Width slider (created before anything else) ---
        var nullLayer = masterComp.layers.addNull();
        nullLayer.name = "Reel_Control";
        nullLayer.position.setValue([masterW / 2, masterH / 2]);

        var sliderFx = nullLayer.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
        sliderFx.name = "Separator Width";
        sliderFx.property("ADBE Slider Control-0001").setValue(12);

        // Spin Delay slider — frames of delay between each reel's spin start
        var spinDelayFx = nullLayer.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
        spinDelayFx.name = "Spin Delay";
        spinDelayFx.property("ADBE Slider Control-0001").setValue(2);

        // Spin 2 Offset slider — extra cells to advance each reel during spin 2
        // (1 = next symbol, 2 = two symbols ahead, etc. — wraps every 5 cells)
        var spin2OffsetFx = nullLayer.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
        spin2OffsetFx.name = "Spin 2 Offset";
        spin2OffsetFx.property("ADBE Slider Control-0001").setValue(2);

        // Per-reel controls: Symbol (which precomp occupies the landing cell, 0-based)
        // and Win (checkbox enables the win animation for that reel).
        // Symbol is READ AT SCRIPT RUN TIME — change slider then re-run to update.
        // Win checkbox is LIVE — toggle in Master comp to enable/disable win per reel.
        for (var rni = 1; rni <= numReels; rni++) {
            var reelSymFx = nullLayer.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
            reelSymFx.name = "Reel " + rni + " Symbol";
            // Default matches what buildReel used: reel 1 → sym 0, reel 2 → sym 1, …
            reelSymFx.property("ADBE Slider Control-0001").setValue((rni - 1) % precompItems.length);

            var reelWinFx = nullLayer.property("ADBE Effect Parade").addProperty("ADBE Checkbox Control");
            reelWinFx.name = "Reel " + rni + " Win";
            reelWinFx.property("ADBE Checkbox Control-0001").setValue(1);   // default: all win
        }

        // --- 7b: Reels_Group layer — static centre; internal expressions handle spreading ---
        var reelsGroupLayer = masterComp.layers.add(reelsGroup);
        reelsGroupLayer.position.setValue([masterW / 2, masterH / 2]);

        // --- 7c: White solid matte (5×3 symbol slots), width scales with sep ---
        // matteW is 20% wider than the 5-symbol base so reels are never clipped at sep=0
        var matteW = Math.round(5 * symSize * 1.2);
        var matteH = 3 * symSize;
        var solid = masterComp.layers.addSolid(
            [1, 1, 1],
            "Visible_Area_Matte",
            matteW,
            matteH,
            1
        );
        solid.moveToBeginning();
        solid.position.setValue([masterW / 2, masterH / 2]);
        // Expression: at sep=0 scale=100% (solid is already 20% wider);
        // as sep grows the matte widens further by 4*sep on top of matteW base
        solid.scale.expression =
            'var sep = thisComp.layer("Reel_Control").effect("Separator Width")("Slider");' +
            'var newW = ' + matteW + ' + ' + (numReels - 1) + ' * sep;' +
            '[newW / ' + matteW + ' * 100, 100];';

        // Set Reels_Group layer to use the solid above it as a Luma matte
        reelsGroupLayer.trackMatteType = TrackMatteType.LUMA;

        // --- 7d: Background as bottom layer ---
        if (bgFootage) {
            var bgLayer = masterComp.layers.add(bgFootage);
            bgLayer.moveToEnd();
            bgLayer.scale.setValue([50, 50]);
            bgLayer.position.setValue([masterW / 2, masterH / 2]);
        }

        // --- 7e: Parent solid and Reels_Group to null ---
        solid.parent           = nullLayer;
        reelsGroupLayer.parent = nullLayer;

        // Build stat diagnostic string
        var statReport = "Stat PNGs found:\n";
        for (var sri = 0; sri < pairs.length; sri++) {
            var sf = findFootageByID(pairs[sri].id);
            statReport += "  Pair " + pairs[sri].id + ": " + (sf ? sf.name : "NOT FOUND") + "\n";
        }
        for (var ssi = 0; ssi < solos.length; ssi++) {
            var ssf = findFootageByID(solos[ssi].id);
            statReport += "  Solo " + solos[ssi].id + ": " + (ssf ? ssf.name : "NOT FOUND") + "\n";
        }

        alert(
            "Done!\n\n" +
            "Pairs (land+win)  : " + pairs.length + "\n" +
            "Solo precomps     : " + solos.length + "\n" +
            "Total precomps    : " + precompItems.length + "\n" +
            statReport + "\n" +
            "Symbol slot size  : " + symSize + " px\n" +
            "Precomp size      : " + compSize + " x " + compSize + " px (150%)\n" +
            "Reel size         : " + compSize + " x " + reelH + " px\n" +
            "Reels created     : reel_1 … reel_5\n" +
            "Reels_Group size  : " + groupW + " x " + reelH + " px\n" +
            "Master comp size  : " + masterW + " x " + masterH + " px" + (bgFootage ? " (from background)" : " (fallback 5×3 slots)") + "\n" +
            "Matte size        : " + matteW + " x " + matteH + " px (5×3 symbol slots)\n\n" +
            "Solid 'Visible_Area_Matte' is the Luma matte for Reels_Group.\n" +
            "Null 'Reel_Control' controls both." +
            (bgFile ? "\nBackground image added as bottom layer." : "\nNo background image selected.")
        );

    } catch (e) {
        alert("Error: " + e.toString() + (e.line ? "\nLine: " + e.line : ""));
    } finally {
        app.endUndoGroup();
    }

})();
