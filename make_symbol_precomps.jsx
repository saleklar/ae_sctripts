// Make Symbol Precomps
// Scans project footage for items with matching ID numbers,
// groups them by ID, and builds one precomp per ID in the order:
//   stat → land (if found) → win → pop (if found)
// No reel comps, no Master comp — just the symbol precomps.

(function () {

    if (!app.project) {
        alert("No project is open.");
        return;
    }

    try {
        app.beginUndoGroup("Make Symbol Precomps");

        // ----------------------------------------------------------------
        // Step 0: Optional cleanup — remove previously created Symbol_ comps
        // ----------------------------------------------------------------
        var doCleanup = confirm("Remove Symbol_ compositions from a previous run first?\n\nOK = remove them, Cancel = skip.");
        if (doCleanup) {
            var toRemove = [];
            for (var ci = 1; ci <= app.project.items.length; ci++) {
                var it = app.project.items[ci];
                if (it && (it instanceof CompItem) && /^Symbol_/.test(it.name))
                    toRemove.push(it);
            }
            for (var ri = 0; ri < toRemove.length; ri++) {
                try { toRemove[ri].remove(); } catch (e) {}
            }
        }

        // ----------------------------------------------------------------
        // Step 1: Scan all FootageItems and group by ID
        //
        // Naming conventions expected (case-insensitive):
        //   stat  → contains "stat"
        //   land  → contains "land"
        //   win   → contains "win"  (but NOT "stat"/"land"/"pop")
        //   pop   → contains "pop"
        //
        // Any footage whose name contains a number is considered.
        // The FIRST number found in the name is used as the ID.
        // ----------------------------------------------------------------
        var groups  = {};   // id -> { stat, land, win, pop }
        var idOrder = [];   // insertion order

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
            // footage with no keyword but matching ID is ignored
        }

        // Keep only IDs that have at least a win or land clip
        var validIds = [];
        for (var vi = 0; vi < idOrder.length; vi++) {
            var g = groups[idOrder[vi]];
            if (g.win || g.land) validIds.push(idOrder[vi]);
        }

        if (validIds.length === 0) {
            alert("No footage groups with a win or land clip found.\n\n" +
                  "Footage names must contain a number AND one of: land, win, pop, stat.");
            app.endUndoGroup();
            return;
        }

        // ----------------------------------------------------------------
        // Step 2: Parameters
        // ----------------------------------------------------------------
        var frInput = prompt("Enter composition frame rate:", "30");
        if (frInput === null) { app.endUndoGroup(); return; }
        var fr = parseFloat(frInput);
        if (isNaN(fr) || fr <= 0) { alert("Invalid frame rate."); app.endUndoGroup(); return; }
        var fd = 1 / fr;  // one frame duration

        var sizeInput = prompt(
            "Found " + validIds.length + " symbol group(s).\n\n" +
            "Enter comp canvas size (px) — used for both width and height:", "246");
        if (sizeInput === null) { app.endUndoGroup(); return; }
        var compSize = parseInt(sizeInput, 10);
        if (isNaN(compSize) || compSize <= 0) { alert("Invalid size."); app.endUndoGroup(); return; }

        // Fixed comp length — long enough to hold all phases with room to spare
        var fixedDur = 1000 / fr;

        // ----------------------------------------------------------------
        // Step 3: Compute normalized phase lengths so every precomp has
        //         the same timeline layout regardless of individual clip lengths.
        //
        //   normStatDur = longest land duration  (stat holds still for that long)
        //   normLandDur = longest land duration
        //   normWinDur  = longest win  duration
        //   normPopDur  = longest pop  duration
        //
        // Timeline in every precomp:
        //   [0 .............. normStatDur)  stat  PNG (static)
        //   [normStatDur .... +normLandDur) land  clip (hold last frame if shorter)
        //   [+normLandDur ... +normWinDur)  win   clip (hold last frame if shorter)
        //   [+normWinDur .... +normPopDur)  pop   clip (hold last frame if shorter)
        // ----------------------------------------------------------------
        var normStatDur = 0, normLandDur = 0, normWinDur = 0, normPopDur = 0;
        for (var ni = 0; ni < validIds.length; ni++) {
            var ng = groups[validIds[ni]];
            if (ng.land && ng.land.duration > normLandDur) normLandDur = ng.land.duration;
            if (ng.win  && ng.win.duration  > normWinDur)  normWinDur  = ng.win.duration;
            if (ng.pop  && ng.pop.duration  > normPopDur)  normPopDur  = ng.pop.duration;
        }
        normStatDur = normLandDur;  // stat phase matches land length

        // Phase start times
        var tLand = normStatDur;
        var tWin  = tLand + normLandDur;
        var tPop  = tWin  + normWinDur;

        // ----------------------------------------------------------------
        // Step 4: Build one precomp per group
        // ----------------------------------------------------------------
        var created = [], skipped = [];

        for (var gi = 0; gi < validIds.length; gi++) {
            var id  = validIds[gi];
            var grp = groups[id];

            var pc = app.project.items.addComp("Symbol_" + id, compSize, compSize, 1, fixedDur, fr);
            var cx = compSize / 2, cy = compSize / 2;

            // ---- STAT ----
            // If a stat PNG exists, place it covering the stat phase.
            // If no stat PNG but a land clip exists, freeze frame 0 of land as stand-in.
            if (grp.stat) {
                var sl = pc.layers.add(grp.stat);
                sl.startTime = 0;
                sl.outPoint  = tLand;       // covers [0, normStatDur)
                sl.position.setValue([cx, cy]);
            } else if (grp.land) {
                // Frozen first frame of land clip as stat placeholder
                var sfb = pc.layers.add(grp.land);
                sfb.startTime = 0;
                sfb.outPoint  = tLand;
                sfb.position.setValue([cx, cy]);
                sfb.timeRemapEnabled = true;
                sfb.property("Time Remap").expression = '0;';
            }

            // ---- LAND ----
            if (grp.land) {
                var ll = pc.layers.add(grp.land);
                ll.startTime = tLand;
                ll.outPoint  = tWin;        // covers [tLand, tWin)
                ll.position.setValue([cx, cy]);
                // Hold last frame in case this clip is shorter than normLandDur
                ll.timeRemapEnabled = true;
                ll.property("Time Remap").expression =
                    'Math.min(time - ' + tLand + ', ' + (grp.land.duration - fd) + ');';
            }

            // ---- WIN ----
            if (grp.win) {
                var wl = pc.layers.add(grp.win);
                wl.startTime = tWin;
                wl.outPoint  = grp.pop ? tPop : fixedDur;  // extend to end if no pop
                wl.position.setValue([cx, cy]);
                wl.timeRemapEnabled = true;
                wl.property("Time Remap").expression =
                    'Math.min(time - ' + tWin + ', ' + (grp.win.duration - fd) + ');';
            }

            // ---- POP ----
            if (grp.pop) {
                var pl = pc.layers.add(grp.pop);
                pl.startTime = tPop;
                pl.outPoint  = fixedDur;    // extends to comp end
                pl.position.setValue([cx, cy]);
                pl.timeRemapEnabled = true;
                pl.property("Time Remap").expression =
                    'Math.min(time - ' + tPop + ', ' + (grp.pop.duration - fd) + ');';
            }

            created.push(id);
        }

        // ----------------------------------------------------------------
        // Step 5: Add all Symbol_ precomps as layers into the active comp
        // ----------------------------------------------------------------
        // Collect the CompItems we just created, in ID order.
        var symComps = [];
        for (var sci = 0; sci < created.length; sci++) {
            for (var spi = 1; spi <= app.project.items.length; spi++) {
                var spItem = app.project.items[spi];
                if ((spItem instanceof CompItem) && spItem.name === "Symbol_" + created[sci]) {
                    symComps.push(spItem);
                    break;
                }
            }
        }

        // Determine destination comp:
        //   - prefer the active item if it is already a CompItem
        //   - otherwise ask the user to pick from open comps
        var destComp = null;
        var activeItem = app.project.activeItem;
        if (activeItem && (activeItem instanceof CompItem)) {
            destComp = activeItem;
        }

        if (destComp) {
            // Add each Symbol_ precomp as a layer at t=0, centered, hidden by default.
            // Layers are stacked so all symbols are in one comp — toggle opacity to select.
            for (var ai = symComps.length - 1; ai >= 0; ai--) {
                var addedLayer = destComp.layers.add(symComps[ai]);
                addedLayer.startTime = 0;
                addedLayer.position.setValue([destComp.width / 2, destComp.height / 2]);
                // All layers visible; use opacity expressions or solo to preview each one
            }
        }

        // ----------------------------------------------------------------
        // Summary
        // ----------------------------------------------------------------
        var phaseReport =
            "Phase layout (seconds):\n" +
            "  stat   t=0 … "      + tLand.toFixed(3) + "\n" +
            "  land   t="          + tLand.toFixed(3) + " … " + tWin.toFixed(3) + "\n" +
            "  win    t="          + tWin.toFixed(3)  + " … " + tPop.toFixed(3) + "\n" +
            (normPopDur > 0
                ? "  pop    t=" + tPop.toFixed(3) + " … " + (tPop + normPopDur).toFixed(3) + "\n"
                : "  pop    (none found)\n");

        var destMsg = destComp
            ? "\nAll " + symComps.length + " precomp(s) added as layers to: \"" + destComp.name + "\""
            : "\nNo active composition found — precomps created in project only.\nOpen a comp and re-run, or drag them in manually.";

        alert(
            "Done!  Created " + created.length + " Symbol_ precomp(s).\n\n" +
            phaseReport +
            "\nIDs created: " + created.join(", ") +
            destMsg
        );

    } catch (e) {
        alert("Error: " + e.toString() + (e.line ? "\nLine: " + e.line : ""));
    } finally {
        app.endUndoGroup();
    }

})();
