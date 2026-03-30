// Import Precomps to Comp — Sequential
// Finds all Symbol_ compositions in the project and places them
// one after another (in sequence) as a single new precomp.
// Each Symbol_ comp occupies exactly its own duration on the timeline.
// The new comp is sized to the active comp (or the first Symbol_ comp if
// no comp is open) and named "Symbol_Sequence".

(function () {

    if (!app.project) {
        alert("No project is open.");
        return;
    }

    // Collect all Symbol_ comps, sorted by numeric ID
    var symComps = [];
    for (var i = 1; i <= app.project.items.length; i++) {
        var item;
        try { item = app.project.items[i]; } catch (e) { continue; }
        if (!(item instanceof CompItem)) continue;
        var m = item.name.match(/^Symbol_(\d+)$/);
        if (m) symComps.push({ comp: item, id: parseInt(m[1], 10) });
    }

    if (symComps.length === 0) {
        alert("No Symbol_ compositions found.\nRun make_symbol_precomps.jsx first.");
        return;
    }

    symComps.sort(function (a, b) { return a.id - b.id; });

    // Use the frame rate and canvas size from the first Symbol_ comp
    var refComp  = symComps[0].comp;
    var fr       = refComp.frameRate;
    var seqW     = refComp.width;
    var seqH     = refComp.height;

    // Each Symbol_ comp contributes exactly clipDur seconds to the sequence.
    // All Symbol_ comps share the same normalized duration (same timeline layout),
    // so we use the first one's duration for every slot.
    var clipDur  = refComp.duration;
    var totalDur = clipDur * symComps.length;

    var doIt = confirm(
        "Found " + symComps.length + " Symbol_ comp(s).\n\n" +
        "Will create \"Symbol_Sequence\" (" + seqW + "×" + seqH + " px, " +
        fr + " fps, " + totalDur.toFixed(2) + "s)\n" +
        "with all symbols laid out sequentially, each " + clipDur.toFixed(2) + "s.\n\n" +
        "Continue?"
    );
    if (!doIt) return;

    try {
        app.beginUndoGroup("Import Precomps to Comp Sequential");

        // Remove an existing Symbol_Sequence if present
        for (var di = app.project.items.length; di >= 1; di--) {
            var ditem;
            try { ditem = app.project.items[di]; } catch (e) { continue; }
            if ((ditem instanceof CompItem) && ditem.name === "Symbol_Sequence") {
                try { ditem.remove(); } catch (e) {}
                break;
            }
        }

        var seqComp = app.project.items.addComp("Symbol_Sequence", seqW, seqH, 1, totalDur, fr);
        var cx = seqW / 2, cy = seqH / 2;
        var cursor = 0;

        for (var si = 0; si < symComps.length; si++) {
            var sc    = symComps[si].comp;
            var layer = seqComp.layers.add(sc);
            layer.startTime = cursor;
            layer.outPoint  = cursor + clipDur;
            layer.position.setValue([cx, cy]);
            cursor += clipDur;
        }

        seqComp.openInViewer();

        alert(
            "Done!\n\n" +
            "\"Symbol_Sequence\" created with " + symComps.length + " symbol(s) in sequence.\n" +
            "Total duration: " + totalDur.toFixed(2) + "s  (" + Math.round(totalDur * fr) + " frames)"
        );

    } catch (e) {
        alert("Error: " + e.toString() + (e.line ? "\nLine: " + e.line : ""));
    } finally {
        app.endUndoGroup();
    }

})();
