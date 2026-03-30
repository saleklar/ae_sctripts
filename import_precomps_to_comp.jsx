// Import Footage to Symbol Sequence
// Scans all project FootageItems, groups them by numeric ID,
// and places them directly into Symbol_Cell comps.
// Supports both simple IDs (e.g. 5_stat) and variant IDs (e.g. 13_1_stat).
// Variant clips (13_1..13_9) get a centered number overlay using blue_winter font.

(function () {

    if (!app.project) {
        alert("No project is open.");
        return;
    }

    // ----------------------------------------------------------------
    // Step 1: Scan footage and group by ID (same rules as make_symbol_precomps)
    // ----------------------------------------------------------------
    var groups  = {};
    var idOrder = [];

    for (var i = 1; i <= app.project.items.length; i++) {
        var fitem;
        try { fitem = app.project.items[i]; } catch (e) { continue; }
        if (!fitem || !(fitem instanceof FootageItem)) continue;
        // Skip solids, placeholders, and anything that isn't an actual file on disk
        if (!(fitem.mainSource instanceof FileSource)) continue;

        var fname   = fitem.name;
        var idMatch = fname.match(/(\d+)/);
        if (!idMatch) continue;

        var id    = idMatch[1];
        var lower = fname.toLowerCase();

        if (!groups[id]) {
            groups[id] = { stat: null, land: null, win: null, pop: null, empty: null };
            idOrder.push(id);
        }

        var isLand  = lower.indexOf("land")   !== -1;
        var isWin   = lower.indexOf("win")    !== -1;
        var isPop   = lower.indexOf("pop")    !== -1;
        var isEmpty = lower.indexOf("empty")  !== -1;
        var isStat  = lower.indexOf("stat")   !== -1 || lower.indexOf("idle") !== -1 || lower.indexOf("static") !== -1;

        if      (isEmpty) groups[id].empty = fitem;
        else if (isLand)  groups[id].land  = fitem;
        else if (isPop)   groups[id].pop   = fitem;
        else if (isWin)   groups[id].win   = fitem;
        else if (isStat)  groups[id].stat  = fitem;
        // Fallback: any remaining footage for this ID (e.g. plain PNG) treated as stat
        else if (!groups[id].stat) groups[id].stat = fitem;
    }

    // Keep only IDs that have at least one animation clip
    var validIds = [];
    for (var vi = 0; vi < idOrder.length; vi++) {
        var g = groups[idOrder[vi]];
        if (g.stat || g.land || g.win || g.pop || g.empty) validIds.push(idOrder[vi]);
    }

    // ----------------------------------------------------------------
    // Expand variant IDs: symbol 13 → 13_1 .. 13_9
    // All variants share the same footage; number overlay added when building comps.
    // ----------------------------------------------------------------
    var VARIANT_BASE    = "13";
    var VARIANT_COUNT   = 9;
    var variantBaseIdx  = validIds.indexOf(VARIANT_BASE);
    if (variantBaseIdx !== -1) {
        validIds.splice(variantBaseIdx, 1);   // remove plain "13"
        var variantInsert = [];
        for (var vn = 1; vn <= VARIANT_COUNT; vn++) {
            var vid = VARIANT_BASE + "_" + vn;
            groups[vid] = groups[VARIANT_BASE]; // same footage reference
            variantInsert.push(vid);
        }
        // Insert variants where "13" was
        Array.prototype.splice.apply(validIds, [variantBaseIdx, 0].concat(variantInsert));
    }

    if (validIds.length === 0) {
        alert("No footage with ID numbers found in the project.");
        return;
    }

    // ----------------------------------------------------------------
    // Step 2: Ask for canvas size and frame rate
    // ----------------------------------------------------------------
    var frInput = prompt("Enter frame rate:", "30");
    if (frInput === null) return;
    var fr = parseFloat(frInput);
    if (isNaN(fr) || fr <= 0) { alert("Invalid frame rate."); return; }

    var sizeInput = prompt(
        "Found " + validIds.length + " symbol group(s).\n\nEnter comp canvas size (px):", "246");
    if (sizeInput === null) return;
    var compSize = parseInt(sizeInput, 10);
    if (isNaN(compSize) || compSize <= 0) { alert("Invalid size."); return; }

    // ----------------------------------------------------------------
    // Step 3: Measure total duration — sum of every clip that exists
    // ----------------------------------------------------------------
    var totalDur = 0;
    var fd = 1 / fr;  // one frame
    for (var ti = 0; ti < validIds.length; ti++) {
        var tg = groups[validIds[ti]];
        if (tg.stat)  totalDur += Math.max(tg.stat.duration, fd);
        if (tg.land)  totalDur += Math.max(tg.land.duration, fd);
        if (tg.win)   totalDur += Math.max(tg.win.duration,  fd);
        if (tg.pop)   totalDur += Math.max(tg.pop.duration,  fd);
        if (tg.empty) totalDur += Math.max(tg.empty.duration, fd);
        else          totalDur += fd; // synthetic empty solid (1 frame)
    }
    if (totalDur <= 0) totalDur = 10;

    // ----------------------------------------------------------------
    // Step 4: Build 4 Symbol_Cell comps and stack them in reel_1
    // ----------------------------------------------------------------
    var cellCount = 4;
    var reelW     = compSize + 50;
    var reelH     = compSize * cellCount;

    try {
        app.beginUndoGroup("Import Footage to Symbol Sequence");

        // Remove existing Symbol_Cell_1..4 and reel_1
        for (var di = app.project.items.length; di >= 1; di--) {
            var ditem;
            try { ditem = app.project.items[di]; } catch (e) { continue; }
            if (!(ditem instanceof CompItem)) continue;
            var dn = ditem.name;
            if (dn === "reel_1" || dn === "shelf_reel_1" ||
                dn === "Symbol_Cell_1" || dn === "Symbol_Cell_2" ||
                dn === "Symbol_Cell_3" || dn === "Symbol_Cell_4") {
                try { ditem.remove(); } catch (e) {}
            }
        }

        // Create 4 identical Symbol_Cell comps
        // drawSize is the actual canvas — 50% larger than the spacing unit
        var drawSize = Math.round(compSize * 1.5);
        var cellComps = [];
        var cx = drawSize / 2, cy = drawSize / 2;

        for (var ci = 1; ci <= cellCount; ci++) {
            var seqComp = app.project.items.addComp(
                "Symbol_Cell_" + ci, drawSize, drawSize, 1, totalDur, fr);
            var cursor = 0;

            for (var si = 0; si < validIds.length; si++) {
                var grp = groups[validIds[si]];
                var order = ["stat", "land", "win", "pop", "empty"];

                for (var oi = 0; oi < order.length; oi++) {
                    var ftg = grp[order[oi]];
                    if (!ftg) continue;

                    // Still images report duration ~0 — clamp to at least 1 frame
                    var clipDur = Math.max(ftg.duration, fd);

                    var layer = seqComp.layers.add(ftg);
                    layer.startTime = cursor;
                    layer.outPoint  = cursor + clipDur;
                    layer.position.setValue([cx, cy]);
                    var clipName = validIds[si] + "_" + order[oi];
                    layer.name = clipName;
                    // Marker on seqComp at clip start — acts as lookup table for trigger expression
                    seqComp.markerProperty.setValueAtTime(cursor, new MarkerValue(clipName));

                    // Variant IDs (e.g. "13_1") get a number overlay using blue_winter font
                    var vParts = validIds[si].match(/^(\d+)_(\d+)$/);
                    if (vParts && order[oi] !== "empty") {
                        try {
                            var tl = seqComp.layers.addText(vParts[2]);
                            var tProp = tl.property("Source Text");
                            var tDoc  = tProp.value;
                            tDoc.font             = "blue_winter";
                            tDoc.fontSize         = 22;
                            tDoc.fillColor        = [1, 1, 1];
                            tDoc.applyFill        = true;
                            tDoc.strokeColor      = [0, 0, 0];
                            tDoc.strokeWidth      = 2;
                            tDoc.applyStroke      = true;
                            tDoc.justification    = ParagraphJustification.CENTER_JUSTIFY;
                            tProp.setValue(tDoc);
                            tl.position.setValue([cx, cy]);
                            tl.startTime = cursor;
                            tl.outPoint  = cursor + clipDur;
                            tl.name      = clipName + "_num";
                        } catch (te) { /* font not found — skip overlay */ }
                    }

                    cursor += clipDur;
                }

                // Synthetic empty clip: 1-frame transparent solid (always present even without footage)
                if (!grp.empty) {
                    var emptyClipName = validIds[si] + "_empty";
                    var emptyLayer = seqComp.layers.addSolid([0, 0, 0], emptyClipName, drawSize, drawSize, 1, fd);
                    emptyLayer.startTime = cursor;
                    emptyLayer.outPoint  = cursor + fd;
                    emptyLayer.property("Opacity").setValue(0);
                    emptyLayer.name = emptyClipName;
                    seqComp.markerProperty.setValueAtTime(cursor, new MarkerValue(emptyClipName));
                    cursor += fd;
                }
            }
            cellComps.push(seqComp);
        }

        // Build reel_1: compSize+50 wide, compSize*4 tall
        var reelComp = app.project.items.addComp("reel_1", reelW, reelH, 1, totalDur, fr);
        var reelCX   = reelW / 2;

        for (var ri = 0; ri < cellCount; ri++) {
            var cellLayer = reelComp.layers.add(cellComps[ri]);
            // Stack cells vertically; center each on its row (uses compSize spacing, not drawSize)
            var cellY = compSize * ri + compSize / 2;
            cellLayer.position.setValue([reelCX, cellY]);
            cellLayer.name = cellComps[ri].name;
        }

        reelComp.openInViewer();

        // Build shelf_reel_1: 4 cells all locked to symbol 13_1_stat (static, no spin)
        // Find 13_1_stat time in Symbol_Cell_1 markers (first variant)
        var shelf13Time = 0;
        var refMarkers = cellComps[0].markerProperty;
        for (var smi = 1; smi <= refMarkers.numKeys; smi++) {
            if (refMarkers.keyValue(smi).comment === "13_1_stat") {
                shelf13Time = refMarkers.keyTime(smi);
                break;
            }
        }

        var shelfComp = app.project.items.addComp("shelf_reel_1", reelW, reelH, 1, totalDur, fr);
        for (var shi = 0; shi < cellCount; shi++) {
            var shelfLayer = shelfComp.layers.add(cellComps[0]);  // all 4 use Symbol_Cell_1
            shelfLayer.position.setValue([reelCX, compSize * shi + compSize / 2]);
            shelfLayer.name = "shelf_cell_" + (shi + 1);
            shelfLayer.timeRemapEnabled = true;
            // Constant expression locks every cell to the 13_1_stat frame
            shelfLayer.property("Time Remap").expression = shelf13Time + ";";
        }

        // Build per-ID diagnostic
        var diagLines = [];
        for (var dgi = 0; dgi < validIds.length; dgi++) {
            var dg = groups[validIds[dgi]];
            diagLines.push(
                validIds[dgi] + ": " +
                "stat="  + (dg.stat  ? dg.stat.name : "—") + "  " +
                "land="  + (dg.land  ? "yes" : "—") + "  " +
                "win="   + (dg.win   ? "yes" : "—") + "  " +
                "pop="   + (dg.pop   ? "yes" : "—") + "  " +
                "empty=" + (dg.empty ? "yes" : "auto")
            );
        }

        alert(
            "Done!\n\n" +
            "4× Symbol_Cell comps created and stacked in \"reel_1\".\n" +
            "Cell canvas: " + drawSize + " × " + drawSize + " px  (spacing unit: " + compSize + " px)\n" +
            "reel_1 size: " + reelW + " × " + reelH + " px\n" +
            "Symbols: " + validIds.length + "  |  Total: " + totalDur.toFixed(2) + "s  (" + Math.round(totalDur * fr) + " frames)\n\n" +
            "Per-symbol:\n" + diagLines.join("\n")
        );

    } catch (e) {
        alert("Error: " + e.toString() + (e.line ? "\nLine: " + e.line : ""));
    } finally {
        app.endUndoGroup();
    }

})();
