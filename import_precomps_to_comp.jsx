// Import Footage to Symbol Sequence
// Scans all project FootageItems, groups them by numeric ID,
// and places them directly into a single new "Symbol_Sequence" comp
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

        var fname   = fitem.name;
        var idMatch = fname.match(/(\d+)/);
        if (!idMatch) continue;

        var id    = idMatch[1];
        var lower = fname.toLowerCase();

        if (!groups[id]) {
            groups[id] = { stat: null, land: null, win: null, pop: null };
            idOrder.push(id);
        }

        if      (lower.indexOf("stat") !== -1) groups[id].stat = fitem;
        else if (lower.indexOf("land") !== -1) groups[id].land = fitem;
        else if (lower.indexOf("pop")  !== -1) groups[id].pop  = fitem;
        else if (lower.indexOf("win")  !== -1) groups[id].win  = fitem;
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
    for (var ti = 0; ti < validIds.length; ti++) {
        var tg = groups[validIds[ti]];
        if (tg.stat)  totalDur += tg.stat.duration;
        if (tg.land)  totalDur += tg.land.duration;
        if (tg.win)   totalDur += tg.win.duration;
        if (tg.pop)   totalDur += tg.pop.duration;
    }
    if (totalDur <= 0) totalDur = 10;

    // ----------------------------------------------------------------
    // Step 4: Build Symbol_Sequence comp
    // ----------------------------------------------------------------
    try {
        app.beginUndoGroup("Import Footage to Symbol Sequence");

        // Remove existing Symbol_Sequence
        for (var di = app.project.items.length; di >= 1; di--) {
            var ditem;
            try { ditem = app.project.items[di]; } catch (e) { continue; }
            if ((ditem instanceof CompItem) && ditem.name === "Symbol_Sequence") {
                try { ditem.remove(); } catch (e) {}
                break;
            }
        }

        var seqComp = app.project.items.addComp("Symbol_Sequence", compSize, compSize, 1, totalDur, fr);
        var cx = compSize / 2, cy = compSize / 2;
        var cursor = 0;

        for (var si = 0; si < validIds.length; si++) {
            var grp = groups[validIds[si]];
            var order = ["stat", "land", "win", "pop"];

            for (var oi = 0; oi < order.length; oi++) {
                var ftg = grp[order[oi]];
                if (!ftg) continue;

                var layer = seqComp.layers.add(ftg);
                layer.startTime = cursor;
                layer.outPoint  = cursor + ftg.duration;
                layer.position.setValue([cx, cy]);
                layer.name = validIds[si] + "_" + order[oi];
                cursor += ftg.duration;
            }
        }

        seqComp.openInViewer();

        alert(
            "Done!\n\n" +
            "\"Symbol_Sequence\" created.\n" +
            "Symbols: " + validIds.length + "  |  IDs: " + validIds.join(", ") + "\n" +
            "Total duration: " + totalDur.toFixed(2) + "s  (" + Math.round(totalDur * fr) + " frames)"
        );

    } catch (e) {
        alert("Error: " + e.toString() + (e.line ? "\nLine: " + e.line : ""));
    } finally {
        app.endUndoGroup();
    }

})();
