// Import Footage to Symbol Sequence
// Scans all project FootageItems, groups them by numeric ID,
// and places them directly into a single new "Symbol_Cell_1" comp
// in the order:  stat → land → win → pop  for each ID,
// then moves to the next ID.  No sub-precomps are created.

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
            groups[id] = { stat: null, land: null, win: null, pop: null };
            idOrder.push(id);
        }

        var isLand = lower.indexOf("land") !== -1;
        var isWin  = lower.indexOf("win")  !== -1;
        var isPop  = lower.indexOf("pop")  !== -1;
        var isStat = lower.indexOf("stat") !== -1 || lower.indexOf("idle") !== -1 || lower.indexOf("static") !== -1;

        if      (isLand) groups[id].land = fitem;
        else if (isPop)  groups[id].pop  = fitem;
        else if (isWin)  groups[id].win  = fitem;
        else if (isStat) groups[id].stat = fitem;
        // Fallback: any remaining footage for this ID (e.g. plain PNG) treated as stat
        else if (!groups[id].stat) groups[id].stat = fitem;
    }

    // Keep only IDs that have at least one animation clip
    var validIds = [];
    for (var vi = 0; vi < idOrder.length; vi++) {
        var g = groups[idOrder[vi]];
        if (g.stat || g.land || g.win || g.pop) validIds.push(idOrder[vi]);
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
            if (dn === "reel_1" ||
                dn === "Symbol_Cell_1" || dn === "Symbol_Cell_2" ||
                dn === "Symbol_Cell_3" || dn === "Symbol_Cell_4") {
                try { ditem.remove(); } catch (e) {}
            }
        }

        // Create 4 identical Symbol_Cell comps
        var cellComps = [];
        var cx = compSize / 2, cy = compSize / 2;

        for (var ci = 1; ci <= cellCount; ci++) {
            var seqComp = app.project.items.addComp(
                "Symbol_Cell_" + ci, compSize, compSize, 1, totalDur, fr);
            var cursor = 0;

            for (var si = 0; si < validIds.length; si++) {
                var grp = groups[validIds[si]];
                var order = ["stat", "land", "win", "pop"];

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
                    cursor += clipDur;
                }
            }
            cellComps.push(seqComp);
        }

        // Build reel_1: compSize+50 wide, compSize*4 tall
        var reelComp = app.project.items.addComp("reel_1", reelW, reelH, 1, totalDur, fr);
        var reelCX   = reelW / 2;

        for (var ri = 0; ri < cellCount; ri++) {
            var cellLayer = reelComp.layers.add(cellComps[ri]);
            // Stack cells vertically; center each on its row
            var cellY = compSize * ri + cy;
            cellLayer.position.setValue([reelCX, cellY]);
            cellLayer.name = cellComps[ri].name;
        }

        reelComp.openInViewer();

        // Build per-ID diagnostic
        var diagLines = [];
        for (var dgi = 0; dgi < validIds.length; dgi++) {
            var dg = groups[validIds[dgi]];
            diagLines.push(
                validIds[dgi] + ": " +
                "stat=" + (dg.stat ? dg.stat.name : "—") + "  " +
                "land=" + (dg.land ? "yes" : "—") + "  " +
                "win="  + (dg.win  ? "yes" : "—") + "  " +
                "pop="  + (dg.pop  ? "yes" : "—")
            );
        }

        alert(
            "Done!\n\n" +
            "4× Symbol_Cell comps created and stacked in \"reel_1\".\n" +
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
