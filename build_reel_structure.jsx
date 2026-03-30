// Build Reel Structure
// Scans footage by ID, builds Pair_/Solo_ precomps, reel comps,
// Reels_Group, Master comp with Reel_Control null, and Visible_Area_Matte.
// Stops at the matte — no background image, no timeline markers.

(function () {

    if (!app.project) {
        alert("No project is open. Please open your AE project first.");
        return;
    }

    try {
        app.beginUndoGroup("Build Reel Structure");

        // ----------------------------------------------------------------
        // Step 0: Optional cleanup of previous run
        // ----------------------------------------------------------------
        var doCleanup = confirm("Remove compositions from a previous run before continuing?\n\nOK = clean up first, Cancel = skip.");

        var cleanupPatterns = [/^Pair_/, /^Solo_/, /^reel_\d+$/, /^Reels_Group$/, /^Master$/];

        function matchesCleanup(name) {
            for (var ci = 0; ci < cleanupPatterns.length; ci++) {
                if (cleanupPatterns[ci].test(name)) return true;
            }
            return false;
        }

        if (doCleanup) {
            var toRemove = [];
            for (var di = 1; di <= app.project.items.length; di++) {
                var item = app.project.items[di];
                if (item && (item instanceof CompItem) && matchesCleanup(item.name))
                    toRemove.push(item);
            }
            var order = ["^Master$", "^Reels_Group$", "^reel_\\d+$", "^Pair_", "^Solo_"];
            toRemove.sort(function (a, b) {
                function rank(n) {
                    for (var oi = 0; oi < order.length; oi++)
                        if (new RegExp(order[oi]).test(n)) return oi;
                    return order.length;
                }
                return rank(a.name) - rank(b.name);
            });
            for (var ri = 0; ri < toRemove.length; ri++) {
                try { toRemove[ri].remove(); } catch (e) {}
            }
        }

        // ----------------------------------------------------------------
        // Step 1: Scan footage and group by ID
        // ----------------------------------------------------------------
        var layerGroups = {};
        var idOrder     = [];

        for (var i = 1; i <= app.project.items.length; i++) {
            var fitem;
            try { fitem = app.project.items[i]; } catch (e) { continue; }
            if (!fitem || !(fitem instanceof FootageItem)) continue;

            var iname    = fitem.name;
            var idMatch  = iname.match(/(\d+)/);
            if (!idMatch) continue;

            var id = idMatch[1];
            if (iname.toLowerCase().indexOf("stat") !== -1) continue;  // stat PNGs handled separately

            if (!layerGroups[id]) {
                layerGroups[id] = { land: null, win: null, pop: null };
                idOrder.push(id);
            }
            var lower = iname.toLowerCase();
            if      (lower.indexOf("land") !== -1) layerGroups[id].land = fitem;
            else if (lower.indexOf("win")  !== -1) layerGroups[id].win  = fitem;
            else if (lower.indexOf("pop")  !== -1) layerGroups[id].pop  = fitem;
        }

        var pairs = [], solos = [];
        for (var k = 0; k < idOrder.length; k++) {
            var g = layerGroups[idOrder[k]];
            if (g.land && g.win) {
                pairs.push({ id: idOrder[k], land: g.land, win: g.win, pop: g.pop });
            } else if (g.win)  {
                solos.push({ id: idOrder[k], layer: g.win,  type: "win"  });
            } else if (g.land) {
                solos.push({ id: idOrder[k], layer: g.land, type: "land" });
            } else if (g.pop)  {
                solos.push({ id: idOrder[k], layer: g.pop,  type: "pop"  });
            }
        }

        var totalSlots = pairs.length + solos.length;
        if (totalSlots === 0) {
            var ftgList = [];
            for (var di2 = 1; di2 <= app.project.items.length; di2++) {
                try { var d = app.project.items[di2]; if (d instanceof FootageItem) ftgList.push(d.name); } catch (e) {}
            }
            alert("No footage with ID numbers found.\n\nItems found:\n" + (ftgList.length ? ftgList.join("\n") : "(none)"));
            app.endUndoGroup();
            return;
        }

        // ----------------------------------------------------------------
        // Step 2: Frame rate + symbol size
        // ----------------------------------------------------------------
        var frInput = prompt("Enter composition frame rate:", "30");
        if (frInput === null) { app.endUndoGroup(); return; }
        var fr = parseFloat(frInput);
        if (isNaN(fr) || fr <= 0) { alert("Invalid frame rate."); app.endUndoGroup(); return; }

        var fixedDur = 1000 / fr;

        var sizeInput = prompt(
            "Found " + pairs.length + " pair(s) and " + solos.length + " solo(s).\n" +
            "Total precomps: " + totalSlots + "\n\nEnter symbol visible area size (px):", "164");
        if (sizeInput === null) { app.endUndoGroup(); return; }
        var symSize = parseInt(sizeInput, 10);
        if (isNaN(symSize) || symSize <= 0) { alert("Invalid size."); app.endUndoGroup(); return; }

        var compSize = Math.round(symSize * 1.5);  // precomp canvas 150% of symbol slot

        // ----------------------------------------------------------------
        // Step 3: Compute normalized phase durations
        // ----------------------------------------------------------------
        var maxLandDurSec = 0, maxWinDurSec = 0;
        for (var pi2 = 0; pi2 < pairs.length; pi2++) {
            if (pairs[pi2].land.duration > maxLandDurSec) maxLandDurSec = pairs[pi2].land.duration;
            if (pairs[pi2].win.duration  > maxWinDurSec)  maxWinDurSec  = pairs[pi2].win.duration;
        }
        var normStatDurSec = maxLandDurSec;
        var normLandDurSec = maxLandDurSec;
        var normWinDurSec  = maxWinDurSec;

        // ----------------------------------------------------------------
        // Helper: find stat PNG FootageItem by ID
        // ----------------------------------------------------------------
        function findStatByID(id) {
            var idPat = new RegExp('(^|[^\\d])' + id + '([^\\d]|$)');
            for (var fi = 1; fi <= app.project.items.length; fi++) {
                var f = app.project.items[fi];
                if (!(f instanceof FootageItem)) continue;
                var fn = f.name.toLowerCase();
                if (fn.indexOf('stat') === -1) continue;
                if (!idPat.test(fn)) continue;
                return f;
            }
            return null;
        }

        // ----------------------------------------------------------------
        // Step 4: Build Pair_ precomps  (stat → land → win [→ pop])
        // ----------------------------------------------------------------
        var precompItems = [];

        for (var p = 0; p < pairs.length; p++) {
            var pair   = pairs[p];
            var landFtg = pair.land, winFtg = pair.win, popFtg = pair.pop;
            var statFtg = findStatByID(pair.id);

            var pc = app.project.items.addComp("Pair_" + pair.id, compSize, compSize, 1, fixedDur, fr);

            if (statFtg) {
                var sl = pc.layers.add(statFtg);
                sl.startTime = 0;
                sl.outPoint  = normStatDurSec;
                sl.position.setValue([compSize / 2, compSize / 2]);
            }

            var ll = pc.layers.add(landFtg);
            ll.startTime = normStatDurSec;
            ll.outPoint  = normStatDurSec + normLandDurSec;
            ll.position.setValue([compSize / 2, compSize / 2]);
            ll.timeRemapEnabled = true;
            ll.property("Time Remap").expression =
                'Math.min(time - ' + normStatDurSec + ', ' + (landFtg.duration - 1/fr) + ');';

            var wl = pc.layers.add(winFtg);
            wl.startTime = normStatDurSec + normLandDurSec;
            wl.outPoint  = popFtg ? (normStatDurSec + normLandDurSec + normWinDurSec) : fixedDur;
            wl.position.setValue([compSize / 2, compSize / 2]);
            wl.timeRemapEnabled = true;
            wl.property("Time Remap").expression =
                'Math.min(time - ' + (normStatDurSec + normLandDurSec) + ', ' + (winFtg.duration - 1/fr) + ');';

            if (popFtg) {
                var pl = pc.layers.add(popFtg);
                pl.startTime = normStatDurSec + normLandDurSec + normWinDurSec;
                pl.outPoint  = fixedDur;
                pl.position.setValue([compSize / 2, compSize / 2]);
                pl.timeRemapEnabled = true;
                pl.property("Time Remap").expression =
                    'Math.min(time - ' + (normStatDurSec + normLandDurSec + normWinDurSec) + ', ' + (popFtg.duration - 1/fr) + ');';
            }

            precompItems.push(pc);
        }

        // ----------------------------------------------------------------
        // Step 4b: Build Solo_ precomps  (stat → animation)
        // ----------------------------------------------------------------
        for (var s = 0; s < solos.length; s++) {
            var solo    = solos[s];
            var soloFtg = solo.layer;
            var soloStat = findStatByID(solo.id);

            var spc = app.project.items.addComp("Solo_" + solo.id, compSize, compSize, 1, fixedDur, fr);

            // Stat PNG (or frozen first frame) covers both stat + land phases
            if (soloStat) {
                var ss = spc.layers.add(soloStat);
                ss.startTime = 0;
                ss.outPoint  = normStatDurSec + normLandDurSec;
                ss.position.setValue([compSize / 2, compSize / 2]);
            } else {
                var sp = spc.layers.add(soloFtg);
                sp.startTime = 0;
                sp.outPoint  = normStatDurSec + normLandDurSec;
                sp.position.setValue([compSize / 2, compSize / 2]);
                sp.timeRemapEnabled = true;
                sp.property("Time Remap").expression = '0;';
            }

            var sa = spc.layers.add(soloFtg);
            sa.startTime = normStatDurSec + normLandDurSec;
            sa.outPoint  = fixedDur;
            sa.position.setValue([compSize / 2, compSize / 2]);
            sa.timeRemapEnabled = true;
            sa.property("Time Remap").expression =
                'Math.min(time - ' + (normStatDurSec + normLandDurSec) + ', ' + (soloFtg.duration - 1/fr) + ');';

            precompItems.push(spc);
        }

        // ----------------------------------------------------------------
        // Step 5: Build reel comps  (5 cells per reel, 5 reels)
        // ----------------------------------------------------------------
        var CELLS_PER_REEL = 5;
        var numReels       = 5;
        var numSymbols     = precompItems.length;
        var spinDurS       = 20 / fr;

        function buildReel(name, landingIdx, reelNum) {
            var rH   = symSize * CELLS_PER_REEL;
            var reel = app.project.items.addComp(name, compSize, rH, 1, fixedDur, fr);
            var n    = numSymbols;

            reel.markerProperty.setValueAtTime(0, new MarkerValue("spin_start"));

            // Shuffle non-landing cells
            var otherIdxs = [];
            for (var oi = 0; oi < n; oi++) { if (oi !== landingIdx) otherIdxs.push(oi); }
            for (var fy = otherIdxs.length - 1; fy > 0; fy--) {
                var fyj = Math.floor(Math.random() * (fy + 1));
                var fyt = otherIdxs[fy]; otherIdxs[fy] = otherIdxs[fyj]; otherIdxs[fyj] = fyt;
            }

            var cellSymIdx = [], poolPick = 0;
            for (var cx = 0; cx < CELLS_PER_REEL; cx++) {
                if (cx === 2) cellSymIdx.push(landingIdx);
                else { cellSymIdx.push(otherIdxs[poolPick % otherIdxs.length]); poolPick++; }
            }

            for (var ci = 0; ci < CELLS_PER_REEL; ci++) {
                var visIdx = cellSymIdx[ci];
                var baseY  = symSize * 0.5 + ci * symSize;

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
                    'if (spinStart < 0 || time <= spinStart) { [x, baseY]; } else {' +
                    '  var t = Math.min(time - spinStart, dur) / dur;' +
                    '  var ease = 1 - Math.pow(1 - t, 3);' +
                    '  var scroll = ease * (nc * sym * 3);' +
                    '  var y = ((baseY - sym * 0.5 + scroll) % (nc * sym)) + sym * 0.5;' +
                    '  [x, y];' +
                    '}';

                var cellLabels = [1, 2, 3, 4, 5];

                for (var si = 0; si < n; si++) {
                    var rl = reel.layers.add(precompItems[si]);
                    rl.label = cellLabels[ci % cellLabels.length];
                    rl.position.setValue([compSize / 2, baseY]);

                    if (ci === 1) {
                        rl.opacity.setValue(100);
                        rl.opacity.expression =
                            'var sym = Math.round(comp("Master").layer("Reel_Control")' +
                            '.effect("Reel ' + reelNum + ' Above")("Slider")); sym === ' + si + ' ? 100 : 0;';
                    } else if (ci === 2) {
                        rl.opacity.setValue(100);
                        rl.opacity.expression =
                            'var sym = Math.round(comp("Master").layer("Reel_Control")' +
                            '.effect("Reel ' + reelNum + ' Symbol")("Slider")); sym === ' + si + ' ? 100 : 0;';
                    } else if (ci === 3) {
                        rl.opacity.setValue(100);
                        rl.opacity.expression =
                            'var sym = Math.round(comp("Master").layer("Reel_Control")' +
                            '.effect("Reel ' + reelNum + ' Below")("Slider")); sym === ' + si + ' ? 100 : 0;';
                    } else {
                        rl.opacity.setValue(si === visIdx ? 100 : 0);
                    }

                    rl.position.expression = posExpr;

                    // Outer buffer cells (ci=0, ci=4) are outside the matte — freeze at t=0.
                    // Visible rows ci=1,2,3 animate freely via Time Remap on the reel layer.
                    if (ci === 0 || ci === 4) {
                        rl.timeRemapEnabled = true;
                        rl.property("Time Remap").expression = '0;';
                    }
                }
            }
            return reel;
        }

        var landingIdxArr = [];
        for (var ldi = 0; ldi < numReels; ldi++) landingIdxArr.push(ldi % numSymbols);

        var reelComps = [];
        for (var reelIdx = 0; reelIdx < numReels; reelIdx++)
            reelComps.push(buildReel("reel_" + (reelIdx + 1), landingIdxArr[reelIdx], reelIdx + 1));

        // ----------------------------------------------------------------
        // Step 6: Reels_Group  (all 5 reels side by side)
        // ----------------------------------------------------------------
        var reelH        = symSize * CELLS_PER_REEL;
        var groupW       = Math.round(symSize * (2 * numReels - 1) * 1.2);
        var reelCenterOff = (numReels - 1) / 2;

        var reelsGroup = app.project.items.addComp("Reels_Group", groupW, reelH, 1, fixedDur, fr);

        for (var rgi = 0; rgi < reelComps.length; rgi++) {
            var rgl = reelsGroup.layers.add(reelComps[rgi]);
            rgl.position.setValue([groupW / 2 + (rgi - reelCenterOff) * symSize, reelH / 2]);
            rgl.position.expression =
                'var sep  = comp("Master").layer("Reel_Control").effect("Separator Width")("Slider");' +
                'var step = ' + symSize + ' + sep;' +
                'var x    = ' + groupW + ' / 2 + (' + rgi + ' - ' + reelCenterOff + ') * step;' +
                '[x, ' + (reelH / 2) + '];';

            rgl.timeRemapEnabled = true;
            rgl.property("Time Remap").expression =
                'var spins = [], wins = [];' +
                'var mm = comp("Master").marker;' +
                'for (var mi = 1; mi <= mm.numKeys; mi++) {' +
                '  var c = mm.key(mi).comment;' +
                '  if (c == "spin_start") spins[spins.length] = mm.key(mi).time;' +
                '  if (c == "win_play")   wins[wins.length]   = mm.key(mi).time;' +
                '}' +
                'var rc    = comp("Master").layer("Reel_Control");' +
                'var winOn = rc.effect("Reel ' + (rgi + 1) + ' Win")("Checkbox");' +
                'var delay = ' + rgi + ' * rc.effect("Spin Delay")("Slider") * thisComp.frameDuration;' +
                'var sdur   = ' + spinDurS + ';' +
                'var statPh = ' + normStatDurSec + ';' +
                'var landPh = ' + normLandDurSec + ';' +
                'var winPh  = ' + normWinDurSec  + ';' +
                'var activeSS = -1, activeIdx = -1;' +
                'for (var si = 0; si < spins.length; si++) {' +
                '  var ss = spins[si] + delay;' +
                '  if (time >= ss) { activeSS = ss; activeIdx = si; }' +
                '}' +
                'var src = 0;' +
                'if (activeSS >= 0) {' +
                '  var se = activeSS + sdur;' +
                '  if (time < se)                        src = time - activeSS;' +
                '  if (time >= se && time < se + landPh) src = statPh + (time - se);' +
                '  if (time >= se + landPh)              src = statPh + landPh - 2 * thisComp.frameDuration;' +
                '  var wp = (activeIdx >= 0 && activeIdx < wins.length) ? wins[activeIdx] : -1;' +
                '  if (winOn && wp >= se + landPh && time >= wp && time < wp + winPh) src = statPh + landPh + (time - wp);' +
                '  if (winOn && wp >= se + landPh && time >= wp + winPh)              src = statPh + landPh + winPh - 2 * thisComp.frameDuration;' +
                '}' +
                'src;';
        }

        // ----------------------------------------------------------------
        // Step 7: Master comp + Reel_Control null + Visible_Area_Matte
        // ----------------------------------------------------------------
        var masterW = 5 * symSize;
        var masterH = 3 * symSize;
        var masterComp = app.project.items.addComp("Master", masterW, masterH, 1, fixedDur, fr);
        masterComp.openInViewer();

        // Reel_Control null
        var nullLayer = masterComp.layers.addNull();
        nullLayer.name = "Reel_Control";
        nullLayer.position.setValue([masterW / 2, masterH / 2]);

        function addSlider(name, val) {
            var fx = nullLayer.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
            fx.name = name;
            fx.property("ADBE Slider Control-0001").setValue(val);
            return fx;
        }
        function addCheckbox(name, val) {
            var fx = nullLayer.property("ADBE Effect Parade").addProperty("ADBE Checkbox Control");
            fx.name = name;
            fx.property("ADBE Checkbox Control-0001").setValue(val);
            return fx;
        }

        addSlider("Separator Width", 12);
        addSlider("Spin Delay", 2);

        for (var rni = 1; rni <= numReels; rni++) {
            var landing = landingIdxArr[rni - 1];
            addSlider("Reel " + rni + " Above",  (landing - 1 + numSymbols) % numSymbols);
            addSlider("Reel " + rni + " Symbol", landing);
            addSlider("Reel " + rni + " Below",  (landing + 1) % numSymbols);
            addCheckbox("Reel " + rni + " Win", 1);
        }

        // Reels_Group layer
        var reelsGroupLayer = masterComp.layers.add(reelsGroup);
        reelsGroupLayer.position.setValue([masterW / 2, masterH / 2]);

        // Visible_Area_Matte solid  (5×3 symbol slots, 20% wider for sep headroom)
        var matteW = Math.round(5 * symSize * 1.2);
        var matteH = 3 * symSize;
        var solid = masterComp.layers.addSolid([1, 1, 1], "Visible_Area_Matte", matteW, matteH, 1);
        solid.moveToBeginning();
        solid.position.setValue([masterW / 2, masterH / 2]);
        solid.scale.expression =
            'var sep = thisComp.layer("Reel_Control").effect("Separator Width")("Slider");' +
            'var newW = ' + matteW + ' + ' + (numReels - 1) + ' * sep;' +
            '[newW / ' + matteW + ' * 100, 100];';

        reelsGroupLayer.trackMatteType = TrackMatteType.LUMA;

        // Parent matte + Reels_Group to Reel_Control null
        solid.parent           = nullLayer;
        reelsGroupLayer.parent = nullLayer;

        alert(
            "Done!\n\n" +
            "Pairs      : " + pairs.length  + "\n" +
            "Solos      : " + solos.length  + "\n" +
            "Precomps   : " + precompItems.length + "\n\n" +
            "Symbol slot : " + symSize  + " px\n" +
            "Precomp     : " + compSize + " × " + compSize + " px\n" +
            "Reel        : " + compSize + " × " + reelH    + " px\n" +
            "Reels_Group : " + groupW   + " × " + reelH    + " px\n" +
            "Master      : " + masterW  + " × " + masterH  + " px  (5×3 slots)\n" +
            "Matte       : " + matteW   + " × " + matteH   + " px\n\n" +
            "Add spin_start and win_play markers to Master to drive the reels.\n" +
            "Background layer not added — drag one in manually if needed."
        );

    } catch (e) {
        alert("Error: " + e.toString() + (e.line ? "\nLine: " + e.line : ""));
    } finally {
        app.endUndoGroup();
    }

})();
