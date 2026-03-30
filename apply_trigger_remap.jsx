// Trigger Remap Panel
// Dockable ScriptUI panel.
// "Setup Remap" adds Symbol_Cell_1..4 directly into Master, stacked
// vertically, each with independent Time Remap driven by that layer's
// own layer markers (thisLayer.marker expression).
// Each cell row has its own dropdown + "Place Marker" button.

(function (thisObj) {

    var CELL_COUNT = 4;
    // Symbol IDs treated as "bubble" collectibles
    var BUBBLE_IDS = {};
    BUBBLE_IDS["13"] = 1; BUBBLE_IDS["22"] = 1; BUBBLE_IDS["23"] = 1;
    BUBBLE_IDS["24"] = 1; BUBBLE_IDS["25"] = 1;

    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------
    function findComp(name) {
        if (!app.project) return null;
        for (var i = 1; i <= app.project.items.length; i++) {
            try {
                var it = app.project.items[i];
                if ((it instanceof CompItem) && it.name === name) return it;
            } catch (e) {}
        }
        return null;
    }

    // thisLayer.marker for per-layer trigger lookup;
    // comp("Symbol_Cell_1").marker for clip start/end table (all cells identical).
    // After a spin ends the expression auto-plays the _land clip for the symbol
    // that was triggered before the spin — no manual land markers needed.
    function buildTimeRemapExpr() {
        return (
            // ---- Step 1: last explicit trigger on this layer ----
            'var trigName = ""; var trigTime = -1;' +
            'var lm = thisLayer.marker;' +
            'for (var mi = 1; mi <= lm.numKeys; mi++) {' +
            '  var mt = lm.key(mi).time;' +
            '  if (mt <= time && mt > trigTime) { trigTime = mt; trigName = lm.key(mi).comment; }' +
            '}' +

            // ---- Step 2: find most recently COMPLETED spin and the stat before it ----
            'var lastSpinEnd = -1; var autoLandClip = "";' +
            'var cm = thisComp.marker;' +
            'for (var si = 1; si <= cm.numKeys; si++) {' +
            '  var cmt = cm.key(si).comment;' +
            '  if (cmt.indexOf("spin") === 0) {' +
            '    var sd = cm.key(si).duration > 0 ? cm.key(si).duration : 2.0;' +
            '    var se = cm.key(si).time + sd;' +
            '    if (se <= time + 0.001 && se > lastSpinEnd) {' +
            '      lastSpinEnd = se;' +
            '      var ss = cm.key(si).time;' +
            '      var sbName = ""; var sbTime = -1;' +
            '      for (var li = 1; li <= lm.numKeys; li++) {' +
            '        var lt = lm.key(li).time;' +
            '        if (lt <= se && lt > sbTime) { sbTime = lt; sbName = lm.key(li).comment; }' +
            '      }' +
            '      if (sbName !== "") {' +
            '        var _li = sbName.lastIndexOf("_");' +
            '        autoLandClip = (_li >= 0) ? sbName.substring(0, _li) + "_land" : sbName + "_land";' +
            '      } else { autoLandClip = ""; }' +
            '    }' +
            '  }' +
            '}' +

            // ---- Step 3: look up land clip bounds in Symbol_Cell_1 ----
            'var landStart = -1; var landEnd = comp("Symbol_Cell_1").duration;' +
            'if (autoLandClip !== "") {' +
            '  var sm = comp("Symbol_Cell_1").marker;' +
            '  for (var xi = 1; xi <= sm.numKeys; xi++) {' +
            '    if (sm.key(xi).comment === autoLandClip) {' +
            '      landStart = sm.key(xi).time;' +
            '      landEnd = (xi < sm.numKeys) ? sm.key(xi+1).time : comp("Symbol_Cell_1").duration;' +
            '      break;' +
            '    }' +
            '  }' +
            '}' +
            'var landDur = landEnd - landStart;' +

            // ---- Step 4: if inside the land window, play land clip ----
            'if (landStart >= 0 && time >= lastSpinEnd && time < lastSpinEnd + landDur) {' +
            '  var el = time - lastSpinEnd;' +
            '  landStart + Math.min(el, landDur - thisComp.frameDuration);' +
            '} else {' +

            // ---- Step 5: normal trigger logic ----
            '  if (trigName === "" || trigTime < 0) {' +
            '    0;' +
            '  } else {' +
            '    var sm2 = comp("Symbol_Cell_1").marker;' +
            '    var cStart = -1; var cEnd = comp("Symbol_Cell_1").duration;' +
            '    for (var ci = 1; ci <= sm2.numKeys; ci++) {' +
            '      if (sm2.key(ci).comment === trigName) {' +
            '        cStart = sm2.key(ci).time;' +
            '        cEnd = (ci < sm2.numKeys) ? sm2.key(ci+1).time : comp("Symbol_Cell_1").duration;' +
            '        break;' +
            '      }' +
            '    }' +
            '    if (cStart < 0) { 0; }' +
            '    else {' +
            '      var el2 = time - trigTime;' +
            '      Math.min(cStart + el2, cEnd - thisComp.frameDuration);' +
            '    }' +
            '  }' +
            '}'
        );
    }

    // ----------------------------------------------------------------
    // Per-cell conveyor belt expression — runs in parent (Reel_Ctrl) space.
    // Null sits at reel center with no expression; cells wrap within the stack.
    // cellIndex is 0-based.
    function buildCellSpinExpr(cellIndex, compSize) {
        var totalH  = compSize * CELL_COUNT;
        var top     = -(totalH / 2);                        // top EDGE of reel in parent space
        var baseY   = top + compSize * cellIndex + compSize / 2;  // CENTER of this cell
        return (
            'var totalH  = ' + totalH + ';' +
            'var top     = ' + top    + ';' +
            'var baseY   = ' + baseY  + ';' +
            'var offset  = 0;' +
            'var mm = thisComp.marker;' +
            'for (var i = 1; i <= mm.numKeys; i++) {' +
            '  var cmt = mm.key(i).comment;' +
            '  if (cmt.indexOf("spin") === 0 && mm.key(i).time <= time) {' +
            '    var parts = cmt.split("_");' +
            '    var cycles = (parts.length > 1 && parseInt(parts[1]) > 0) ? parseInt(parts[1]) : 3;' +
            '    var spinDur = mm.key(i).duration > 0 ? mm.key(i).duration : 2.0;' +
            '    var elapsed = Math.min(time - mm.key(i).time, spinDur);' +
            '    var t = elapsed / spinDur;' +
            '    var eased = (t >= 1) ? 1 : 1 - Math.pow(2, -10 * t);' +
            '    offset += totalH * cycles * eased;' +
            '  }' +
            '}' +
            'var rawY    = baseY + offset;' +
            'var wrapped = ((rawY - top) % totalH + totalH) % totalH + top;' +
            '[0, wrapped];'
        );
    }

    // ----------------------------------------------------------------
    // Build UI
    // ----------------------------------------------------------------
    function buildUI(win) {
        win.orientation = "column";
        win.alignChildren = ["fill", "top"];
        win.spacing = 6;
        win.margins = 8;

        // Status bar
        var statusTxt = win.add("statictext", undefined, "No project open", { truncate: "end" });
        statusTxt.alignment = ["fill", "top"];

        win.add("panel").preferredSize.height = 1;

        // Setup button
        var setupBtn = win.add("button", undefined, "Setup Remap (Add Cells 1-4 to Master)");
        setupBtn.helpTip = "Adds Symbol_Cell_1..4 into Master stacked vertically, each with independent Time Remap";

        win.add("panel").preferredSize.height = 1;

        // Per-cell rows
        var dropdowns = [];
        var placeBtns = [];

        for (var ci = 0; ci < CELL_COUNT; ci++) {
            var cellNum = ci + 1;

            var row = win.add("group");
            row.orientation = "row";
            row.alignChildren = ["left", "center"];
            row.spacing = 4;

            var lbl = row.add("statictext", undefined, "Cell " + cellNum + ":");
            lbl.preferredSize.width = 40;

            var dd = row.add("dropdownlist", undefined, []);
            dd.preferredSize.width = 150;

            var btn = row.add("button", undefined, "Place Marker");
            btn.preferredSize.width = 90;

            dropdowns.push(dd);
            placeBtns.push(btn);

            // Closure to capture cellNum, dd, btn
            (function (idx, dropdown, placeBtn) {
                placeBtn.onClick = function () {
                    if (!dropdown.selection) { alert("Select a clip for Cell " + idx + " first."); return; }
                    if (!app.project) { alert("No project open."); return; }

                    var masterComp = findComp("Master");
                    if (!masterComp) { alert("No \"Master\" comp found."); return; }

                    var cellLayerName = "Symbol_Cell_" + idx;
                    var cellLayer = null;
                    for (var li = 1; li <= masterComp.layers.length; li++) {
                        var l = masterComp.layers[li];
                        if ((l.source instanceof CompItem) && l.source.name === cellLayerName) {
                            cellLayer = l; break;
                        }
                    }
                    if (!cellLayer) {
                        alert("\"" + cellLayerName + "\" layer not found in Master.\nRun Setup Remap first.");
                        return;
                    }

                    var clipName = dropdown.selection.text;
                    var t = masterComp.time;

                    try {
                        app.beginUndoGroup("Place Trigger Marker Cell " + idx);
                        cellLayer.property("Marker").setValueAtTime(t, new MarkerValue(clipName));
                        statusTxt.text = "Cell " + idx + ": \"" + clipName + "\" @ " + t.toFixed(3) + "s";
                    } catch (e) {
                        alert("Error: " + e.toString());
                    } finally {
                        app.endUndoGroup();
                    }
                };
            })(cellNum, dd, btn);
        }

        win.add("panel").preferredSize.height = 1;

        var refreshBtn  = win.add("button", undefined, "\u27F3 Refresh Clip Lists");
        var randomizeBtn = win.add("button", undefined, "\uD83C\uDFB2 Randomize Stats");
        randomizeBtn.helpTip = "Places a random stat clip marker on each cell at the current Master playhead";

        win.add("panel").preferredSize.height = 1;

        var spinBtn = win.add("button", undefined, "\uD83C\uDFB0 Place Spin");
        spinBtn.helpTip = "Stamps 'spin_3' comp marker at playhead. Rename to spin_N for N loops. Drag end to set duration/speed.";

        win.add("panel").preferredSize.height = 1;

        var flyRow = win.add("group");
        flyRow.orientation = "row";
        flyRow.alignChildren = ["left", "center"];
        flyRow.spacing = 4;
        flyRow.add("statictext", undefined, "Fly Speed (s):");
        var flySpeedInput = flyRow.add("edittext", undefined, "1.0");
        flySpeedInput.preferredSize.width = 45;
        flyRow.add("statictext", undefined, "Lead offset (s):");
        var shelfLeadInput = flyRow.add("edittext", undefined, "0.0");
        shelfLeadInput.preferredSize.width = 38;
        shelfLeadInput.helpTip = "Fine-tune offset in seconds added to the auto-detected touch time (negative = earlier, positive = later)."

        var bubbleFlyBtn = win.add("button", undefined, "\uD83E\uDEF7 Bubble Fly");
        bubbleFlyBtn.helpTip = "At current time: fades bubble cells (13/22-25) to 50%, flies a copy up to the shelf. Each subsequent bubble pushes shelf up.";

        // ----------------------------------------------------------------
        // Refresh all dropdowns from Symbol_Cell_1 markers
        // (all cells share identical clip timeline)
        // ----------------------------------------------------------------
        function refreshLists() {
            var seqComp = findComp("Symbol_Cell_1");
            if (!seqComp) {
                statusTxt.text = "Symbol_Cell_1 not found - run import script first";
                return;
            }
            var nm = seqComp.markerProperty.numKeys;
            if (nm === 0) {
                statusTxt.text = "Symbol_Cell_1 has no markers";
                return;
            }
            var items = [];
            for (var mi = 1; mi <= nm; mi++) {
                items.push(seqComp.markerProperty.keyValue(mi).comment);
            }
            for (var di = 0; di < dropdowns.length; di++) {
                dropdowns[di].removeAll();
                for (var ii = 0; ii < items.length; ii++) {
                    dropdowns[di].add("item", items[ii]);
                }
                dropdowns[di].selection = 0;
            }
            statusTxt.text = nm + " clips loaded for all " + CELL_COUNT + " cells";
        }

        // ----------------------------------------------------------------
        // Setup Remap
        // ----------------------------------------------------------------
        setupBtn.onClick = function () {
            if (!app.project) { alert("No project open."); return; }

            var masterComp = findComp("Master");
            if (!masterComp) { alert("No \"Master\" comp found."); return; }

            var cell1 = findComp("Symbol_Cell_1");
            if (!cell1) { alert("No \"Symbol_Cell_1\" comp found.\nRun import_precomps_to_comp.jsx first."); return; }
            if (cell1.markerProperty.numKeys === 0) {
                alert("Symbol_Cell_1 has no clip markers.\nRe-run import_precomps_to_comp.jsx.");
                return;
            }

            var drawSize = cell1.width;                     // actual canvas (typed * 1.5)
            var compSize = Math.round(drawSize / 1.5);     // spacing unit = the typed value
            var halfCell = compSize / 2;
            // Center the column horizontally in Master; top cell starts so block is vertically centered
            var startX = masterComp.width / 2;
            var startY = (masterComp.height - compSize * CELL_COUNT) / 2 + halfCell;

            try {
                app.beginUndoGroup("Setup Trigger Remap");

                var expr = buildTimeRemapExpr();

                // Find or create the control null
                var nullLayer = null;
                for (var ni = 1; ni <= masterComp.layers.length; ni++) {
                    if (masterComp.layers[ni].name === "Reel_Ctrl") {
                        nullLayer = masterComp.layers[ni]; break;
                    }
                }
                if (!nullLayer) {
                    nullLayer = masterComp.layers.addNull();
                    nullLayer.name = "Reel_Ctrl";
                }
                // Clear any existing expression so setValue works cleanly
                try { nullLayer.property("Position").expression = ""; } catch (e) {}
                // Place null at the visual center of the 4-cell reel block
                var nullBaseY = startY + compSize * (CELL_COUNT - 1) / 2;
                nullLayer.position.setValue([startX, nullBaseY]);
                // Null has NO expression - user can freely move it to reposition the whole reel

                for (var ci = 1; ci <= CELL_COUNT; ci++) {
                    var cellComp = findComp("Symbol_Cell_" + ci);
                    if (!cellComp) {
                        alert("\"Symbol_Cell_" + ci + "\" not found.\nRun import_precomps_to_comp.jsx first.");
                        return;
                    }

                    var cellLayer = null;
                    for (var li = 1; li <= masterComp.layers.length; li++) {
                        var l = masterComp.layers[li];
                        if ((l.source instanceof CompItem) && l.source.name === "Symbol_Cell_" + ci) {
                            cellLayer = l; break;
                        }
                    }
                    if (!cellLayer) {
                        cellLayer = masterComp.layers.add(cellComp);
                        cellLayer.startTime = 0;
                    }

                    // Parent to null so moving null repositions the whole reel
                    cellLayer.parent = nullLayer;

                    // Conveyor expression works in parent-relative space
                    cellLayer.property("Position").expression =
                        buildCellSpinExpr(ci - 1, compSize);

                    cellLayer.timeRemapEnabled = true;
                    cellLayer.property("Time Remap").expression = expr;
                }

                // Place shelf_reel_1 above the main reel
                // Bottom cell of shelf aligns with top cell of main reel (both at startY)
                var shelfComp = findComp("shelf_reel_1");
                if (shelfComp) {
                    var shelfMasterLayer = null;
                    for (var sli = 1; sli <= masterComp.layers.length; sli++) {
                        var sl = masterComp.layers[sli];
                        if ((sl.source instanceof CompItem) && sl.source.name === "shelf_reel_1") {
                            shelfMasterLayer = sl; break;
                        }
                    }
                    if (!shelfMasterLayer) {
                        shelfMasterLayer = masterComp.layers.add(shelfComp);
                        shelfMasterLayer.startTime = 0;
                    }
                    // Set absolute position first, then parent — AE auto-converts to parent-relative
                    shelfMasterLayer.position.setValue([startX, startY - compSize * 1.5]);
                    shelfMasterLayer.parent = nullLayer;
                }

                statusTxt.text = "Setup done. Move Reel_Ctrl to reposition. Place Spin markers to animate.";
                refreshLists();

            } catch (e) {
                alert("Error: " + e.toString() + (e.line ? "\nLine: " + e.line : ""));
            } finally {
                app.endUndoGroup();
            }
        };

        refreshBtn.onClick = function () { refreshLists(); };

        spinBtn.onClick = function () {
            if (!app.project) { alert("No project open."); return; }
            var masterComp = findComp("Master");
            if (!masterComp) { alert("No \"Master\" comp found."); return; }

            var t = masterComp.time;
            try {
                app.beginUndoGroup("Place Spin Marker");
                var spinMv = new MarkerValue("spin_3");
                spinMv.duration = 2.0;
                masterComp.markerProperty.setValueAtTime(t, spinMv);
                statusTxt.text = "Spin @ " + t.toFixed(3) + "s  \u2014  rename to spin_N for N loops, drag end for speed";
            } catch (e) {
                alert("Error: " + e.toString());
            } finally {
                app.endUndoGroup();
            }
        };

        randomizeBtn.onClick = function () {
            if (!app.project) { alert("No project open."); return; }

            var masterComp = findComp("Master");
            if (!masterComp) { alert("No \"Master\" comp found."); return; }

            var seqComp = findComp("Symbol_Cell_1");
            if (!seqComp || seqComp.markerProperty.numKeys === 0) {
                alert("Symbol_Cell_1 has no markers.\nRun import_precomps_to_comp.jsx first.");
                return;
            }

            // Collect all stat clips
            var statClips = [];
            var nm = seqComp.markerProperty.numKeys;
            for (var mi = 1; mi <= nm; mi++) {
                var cmt = seqComp.markerProperty.keyValue(mi).comment;
                if (cmt.indexOf("_stat") !== -1) statClips.push(cmt);
            }
            if (statClips.length === 0) {
                alert("No \"_stat\" clips found in Symbol_Cell_1 markers.");
                return;
            }

            var t = masterComp.time;
            var placed = [];

            try {
                app.beginUndoGroup("Randomize Stats");

                for (var ci = 1; ci <= CELL_COUNT; ci++) {
                    // Find the Symbol_Cell_N layer in Master
                    var cellLayer = null;
                    for (var li = 1; li <= masterComp.layers.length; li++) {
                        var l = masterComp.layers[li];
                        if ((l.source instanceof CompItem) && l.source.name === "Symbol_Cell_" + ci) {
                            cellLayer = l; break;
                        }
                    }
                    if (!cellLayer) continue;

                    // Pick a random stat clip
                    var pick = statClips[Math.floor(Math.random() * statClips.length)];
                    cellLayer.property("Marker").setValueAtTime(t, new MarkerValue(pick));
                    placed.push("Cell " + ci + ": " + pick);

                    // Sync dropdown selection to match
                    var dd = dropdowns[ci - 1];
                    for (var di = 0; di < dd.items.length; di++) {
                        if (dd.items[di].text === pick) { dd.selection = di; break; }
                    }
                }

                statusTxt.text = "Randomized @ " + t.toFixed(3) + "s  \u2014  " + placed.join("  |  ");

                // --- Randomize shelf_reel_1: each cell gets a random 13_X_stat locked frame ---
                var shelfComp = findComp("shelf_reel_1");
                if (shelfComp) {
                    // Collect only 13_X_stat variant clips
                    var shelfClips = [];
                    for (var smi = 1; smi <= nm; smi++) {
                        var sc = seqComp.markerProperty.keyValue(smi).comment;
                        if (/^13_\d+_stat$/.test(sc)) shelfClips.push(sc);
                    }
                    if (shelfClips.length > 0) {
                        var shelfPlaced = [];
                        for (var sli2 = 1; sli2 <= shelfComp.layers.length; sli2++) {
                            var sl = shelfComp.layers[sli2];
                            if (!(sl.source instanceof CompItem)) continue;
                            // Pick random variant
                            var shelfPick = shelfClips[Math.floor(Math.random() * shelfClips.length)];
                            // Find its time in Symbol_Cell_1 markers
                            var shelfTime = 0;
                            for (var smk = 1; smk <= nm; smk++) {
                                if (seqComp.markerProperty.keyValue(smk).comment === shelfPick) {
                                    shelfTime = seqComp.markerProperty.keyTime(smk);
                                    break;
                                }
                            }
                            // Overwrite constant Time Remap expression
                            try { sl.property("Time Remap").expression = shelfTime + ";"; } catch(e2) {}
                            shelfPlaced.push(sl.name + ":" + shelfPick);
                        }
                        statusTxt.text = statusTxt.text + "  ||  Shelf: " + shelfPlaced.join(", ");
                    }
                }
            } catch (e) {
                alert("Error: " + e.toString());
            } finally {
                app.endUndoGroup();
            }
        };

        // ----------------------------------------------------------------
        // Bubble Fly
        // ----------------------------------------------------------------
        bubbleFlyBtn.onClick = function () {
            if (!app.project) { alert("No project open."); return; }

            var masterComp = findComp("Master");
            if (!masterComp) { alert("No \"Master\" comp found."); return; }

            var seqComp = findComp("Symbol_Cell_1");
            if (!seqComp || seqComp.markerProperty.numKeys === 0) {
                alert("Symbol_Cell_1 not found or has no markers."); return;
            }

            var compSize  = Math.round(seqComp.width / 1.5);
            var fd        = 1.0 / masterComp.frameRate;
            var flyDur    = parseFloat(flySpeedInput.text);
            if (isNaN(flyDur) || flyDur <= 0) flyDur = 1.0;
            // shiftDur is computed per-bubble based on flyDurB inside the loop
            var t0        = masterComp.time;
            var nm        = seqComp.markerProperty.numKeys;

            // Find Reel_Ctrl null
            var nullLayer = null;
            for (var ni = 1; ni <= masterComp.layers.length; ni++) {
                if (masterComp.layers[ni].name === "Reel_Ctrl") { nullLayer = masterComp.layers[ni]; break; }
            }
            if (!nullLayer) { alert("No Reel_Ctrl null. Run Setup Remap first."); return; }
            var nullPos = nullLayer.position.value;
            var nullX = nullPos[0], nullY = nullPos[1];

            // Find shelf_reel_1 layer in Master
            var shelfMasterLyr = null;
            for (var smiB = 1; smiB <= masterComp.layers.length; smiB++) {
                var smlB = masterComp.layers[smiB];
                try { if ((smlB.source instanceof CompItem) && smlB.source.name === "shelf_reel_1") { shelfMasterLyr = smlB; break; } } catch(e0) {}
            }
            var shelfCompB = shelfMasterLyr ? shelfMasterLyr.source : findComp("shelf_reel_1");

            // Shelf slot 4 (bottom) position in Master coords
            var shelfParY = shelfMasterLyr ? shelfMasterLyr.position.value[1] : (-3 * compSize);
            var shelf4Y   = nullY + shelfParY + (CELL_COUNT / 2 - 0.5) * compSize;

            // --- clip lookup helpers ---
            function bfMTime(name) {
                for (var xi = 1; xi <= nm; xi++) {
                    if (seqComp.markerProperty.keyValue(xi).comment === name) return seqComp.markerProperty.keyTime(xi);
                } return -1;
            }
            function bfMEnd(name) {
                for (var xi = 1; xi <= nm; xi++) {
                    if (seqComp.markerProperty.keyValue(xi).comment === name) {
                        return (xi < nm) ? seqComp.markerProperty.keyTime(xi + 1) : seqComp.duration;
                    }
                } return -1;
            }
            // reverse lookup: given a Time Remap value, find the closest marker comment
            function bfClipByTime(tv) {
                var bestName = ""; var bestDiff = 999999;
                for (var xi = 1; xi <= nm; xi++) {
                    var diff = Math.abs(seqComp.markerProperty.keyTime(xi) - tv);
                    if (diff < bestDiff) { bestDiff = diff; bestName = seqComp.markerProperty.keyValue(xi).comment; }
                }
                return bestName;
            }

            // --- find bubble cells at t0 (cells 2-4 only; cell 1 is spin-only) ---
            var bubbleCells = [];
            for (var ci3 = 2; ci3 <= CELL_COUNT; ci3++) {
                var clyr3 = null;
                for (var li3 = 1; li3 <= masterComp.layers.length; li3++) {
                    var ll3 = masterComp.layers[li3];
                    try { if ((ll3.source instanceof CompItem) && ll3.source.name === "Symbol_Cell_" + ci3) { clyr3 = ll3; break; } } catch(e1) {}
                }
                if (!clyr3) continue;
                var lastCmt3 = "", lastMT3 = -1;
                var lm3 = clyr3.property("Marker");
                for (var mk3 = 1; mk3 <= lm3.numKeys; mk3++) {
                    var mt3 = lm3.keyTime(mk3);
                    if (mt3 <= t0 && mt3 > lastMT3) { lastMT3 = mt3; lastCmt3 = lm3.keyValue(mk3).comment; }
                }
                if (lastCmt3 === "") continue;
                var baseId3 = lastCmt3.split("_")[0];
                if (BUBBLE_IDS[baseId3]) {
                    bubbleCells.push({ ci: ci3, layer: clyr3, clip: lastCmt3 });
                }
            }
            if (bubbleCells.length === 0) {
                alert("No bubble symbol (IDs: 13, 22-25) found at current time.\nPlace stat markers for bubble symbols first.");
                return;
            }

            // --- read current shelf Time Remap values + clip names at t0 ---
            var shelfTimes3 = [];
            var shelfClips3 = [];   // parallel array: clip name for each slot
            for (var stsi = 1; stsi <= 4; stsi++) {
                var stslL = null;
                if (shelfCompB) {
                    for (var stli = 1; stli <= shelfCompB.layers.length; stli++) {
                        if (shelfCompB.layers[stli].name === "shelf_cell_" + stsi) { stslL = shelfCompB.layers[stli]; break; }
                    }
                }
                var stv = 0;
                try { stv = stslL ? stslL.property("Time Remap").valueAtTime(t0, false) : 0; } catch(e2) {}
                shelfTimes3.push(stv);
                shelfClips3.push(bfClipByTime(stv));
            }

            var flyLog = [];
            try {
                app.beginUndoGroup("Bubble Fly");

                // Clear all accumulated Position + Opacity keyframes on shelf layers
                // so multiple bi iterations don't stack extra keyframes from prior runs.
                if (shelfCompB) {
                    for (var sci = 1; sci <= 4; sci++) {
                        for (var scli = 1; scli <= shelfCompB.layers.length; scli++) {
                            if (shelfCompB.layers[scli].name === "shelf_cell_" + sci) {
                                var scLayer = shelfCompB.layers[scli];
                                try { var scP = scLayer.property("Position");  while (scP.numKeys  > 0) scP.removeKey(1);  } catch(esc1) {}
                                try { var scO = scLayer.property("Opacity");   while (scO.numKeys  > 0) scO.removeKey(1);  } catch(esc2) {}
                                break;
                            }
                        }
                    }
                }

                // Pre-compute per-bubble travel distance and proportional fly duration.
                // flyDur is the flight time for the FARTHEST bubble; closer cells scale shorter.
                var maxDistB = 0;
                for (var bdi = 0; bdi < bubbleCells.length; bdi++) {
                    var bdc = bubbleCells[bdi];
                    var bdParY = (-CELL_COUNT / 2 + bdc.ci - 1 + 0.5) * compSize;
                    bdc.dist = (nullY + bdParY) - shelf4Y;
                    if (bdc.dist > maxDistB) maxDistB = bdc.dist;
                }
                if (maxDistB <= 0) maxDistB = compSize;
                var curLaunchT = t0;
                for (var bdi2 = 0; bdi2 < bubbleCells.length; bdi2++) {
                    bubbleCells[bdi2].flyDurB  = flyDur * (bubbleCells[bdi2].dist / maxDistB);
                    bubbleCells[bdi2].launchT  = curLaunchT;
                    bubbleCells[bdi2].arrivalT = curLaunchT + bubbleCells[bdi2].flyDurB;
                    curLaunchT = bubbleCells[bdi2].arrivalT;  // next launches when this one arrives
                }

                for (var bi = 0; bi < bubbleCells.length; bi++) {
                    var bc       = bubbleCells[bi];
                    var launchT  = bc.launchT;
                    var arrivalT = bc.arrivalT;
                    var flyDurB  = bc.flyDurB;
                    var shiftDurB = Math.min(flyDurB * 0.25, 0.4);

                    // 1. Reel cell: instant fade to 50% on launch, stays faded.
                    //    Restores to 100% at the next spin marker after this launch.
                    var opPropB = bc.layer.property("Opacity");
                    opPropB.setValueAtTime(launchT,      100);
                    opPropB.setValueAtTime(launchT + fd,  50);
                    // Find next spin comp marker after launchT and restore opacity there
                    var cmB = masterComp.markerProperty;
                    var nextSpinT = -1;
                    for (var nsi = 1; nsi <= cmB.numKeys; nsi++) {
                        var nst = cmB.keyTime(nsi);
                        if (nst > launchT && cmB.keyValue(nsi).comment.indexOf("spin") === 0) {
                            if (nextSpinT < 0 || nst < nextSpinT) nextSpinT = nst;
                        }
                    }
                    if (nextSpinT >= 0) {
                        opPropB.setValueAtTime(nextSpinT - fd,  50);
                        opPropB.setValueAtTime(nextSpinT,      100);
                    }

                    // 2. Land clip info
                    var liPosB   = bc.clip.lastIndexOf("_");
                    var landClipB = (liPosB >= 0 ? bc.clip.substring(0, liPosB) : bc.clip) + "_land";
                    var landStB   = bfMTime(landClipB);
                    var landEnB   = bfMEnd(landClipB);
                    var landDurB  = (landStB >= 0 && landEnB > landStB) ? (landEnB - landStB) : 1.0;
                    var statTB    = bfMTime(bc.clip);

                    // 3. Create fly layer in Master, parented to Reel_Ctrl null
                    var flyLyr = masterComp.layers.add(seqComp);
                    flyLyr.name = "bubble_fly_" + (bi + 1);
                    flyLyr.moveToBeginning();
                    flyLyr.inPoint  = launchT;
                    flyLyr.outPoint = Math.min(arrivalT + landDurB + fd, masterComp.duration);
                    flyLyr.parent   = nullLayer;   // parent BEFORE keyframes so coords are parent-relative

                    // 4. Position in parent-relative space: cell center → shelf slot 4
                    var cellParYB = (-CELL_COUNT / 2 + bc.ci - 1 + 0.5) * compSize;  // already null-relative
                    var flyEndY   = shelf4Y - nullY;  // convert absolute shelf4Y to null-relative
                    var posPropB  = flyLyr.property("Position");
                    posPropB.setValueAtTime(launchT,  [0, cellParYB]);
                    posPropB.setValueAtTime(arrivalT, [0, flyEndY]);
                    try {
                        posPropB.setTemporalEaseAtKey(1, [new KeyframeEase(0,   50)], [new KeyframeEase(100, 50)]);
                        posPropB.setTemporalEaseAtKey(2, [new KeyframeEase(100,  0)], [new KeyframeEase(0,    0)]);
                    } catch(eEaseB) {}

                    // touchT: exact moment the bubble's top edge crosses the shelf's bottom edge.
                    // Uses ease-out approximation y(p) = 1-(1-p)^2 (KeyframeEase influence 50).
                    // Solve: 1 - sqrt(compSize / (2 * totalTravel)) = progress fraction p.
                    var totalTravelB2 = cellParYB - flyEndY;  // positive (bubble moves up)
                    var touchP = (totalTravelB2 > compSize / 2)
                        ? 1 - Math.sqrt(compSize / (2 * totalTravelB2))
                        : 0;  // bubble starts inside shelf — sweep immediately
                    touchP = Math.max(0, Math.min(1, touchP));
                    var leadOffset = parseFloat(shelfLeadInput.text);
                    if (isNaN(leadOffset)) leadOffset = 0;
                    var touchT = launchT + touchP * flyDurB + leadOffset;

                    // 5. Time Remap expression: stat during flight, land on arrival
                    flyLyr.timeRemapEnabled = true;
                    flyLyr.property("Time Remap").expression =
                        'var aT=' + arrivalT + ';' +
                        'var st=' + (statTB >= 0 ? statTB : 0) + ';' +
                        'var ls=' + (landStB >= 0 ? landStB : 0) + ';' +
                        'var ld=' + landDurB + ';' +
                        'if(time<aT){st;}else{var el=time-aT;ls+Math.min(el,ld-thisComp.frameDuration);}';

                    // 6. Shelf animation: sweeps up the moment the bubble touches the shelf bottom edge.
                    if (shelfCompB) {
                        var shWB = shelfCompB.width / 2;
                        for (var ssiB = 1; ssiB <= 4; ssiB++) {
                            var ssLL = null;
                            for (var ssliB = 1; ssliB <= shelfCompB.layers.length; ssliB++) {
                                if (shelfCompB.layers[ssliB].name === "shelf_cell_" + ssiB) { ssLL = shelfCompB.layers[ssliB]; break; }
                            }
                            if (!ssLL) continue;

                            var origYB = compSize * (ssiB - 1) + compSize / 2;

                            // Position: sweep up on touchT (linear), snap back with hold
                            var ppB = ssLL.property("Position");
                            ppB.setValueAtTime(touchT,                 [shWB, origYB]);
                            ppB.setValueAtTime(touchT + shiftDurB,      [shWB, origYB - compSize]);
                            ppB.setValueAtTime(touchT + shiftDurB + fd, [shWB, origYB]);
                            try {
                                for (var kki = 1; kki <= ppB.numKeys; kki++) {
                                    var kkt = ppB.keyTime(kki);
                                    if (Math.abs(kkt - touchT) < fd * 0.5) {
                                        ppB.setInterpolationTypeAtKey(kki, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
                                    } else if (Math.abs(kkt - (touchT + shiftDurB)) < fd * 0.5) {
                                        ppB.setInterpolationTypeAtKey(kki, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.HOLD);
                                    } else if (Math.abs(kkt - (touchT + shiftDurB + fd)) < fd * 0.5) {
                                        ppB.setInterpolationTypeAtKey(kki, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
                                    }
                                }
                            } catch(eKiB) {}

                            // Top slot opacity: fade out during sweep, restore with hold snap
                            if (ssiB === 1) {
                                var topOpB = ssLL.property("Opacity");
                                topOpB.setValueAtTime(touchT,                 100);
                                topOpB.setValueAtTime(touchT + shiftDurB,        0);
                                topOpB.setValueAtTime(touchT + shiftDurB + fd,  100);
                                try {
                                    for (var koi = 1; koi <= topOpB.numKeys; koi++) {
                                        var kot = topOpB.keyTime(koi);
                                        if (Math.abs(kot - touchT) < fd * 0.5) {
                                            topOpB.setInterpolationTypeAtKey(koi, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
                                        } else if (Math.abs(kot - (touchT + shiftDurB)) < fd * 0.5) {
                                            topOpB.setInterpolationTypeAtKey(koi, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.HOLD);
                                        }
                                    }
                                } catch(eOiB) {}
                            }

                            // Time Remap: hold own stat throughout the physical move.
                            // Slots 1-3 swap content at snap-back (position illusion complete).
                            // Slot 4 waits until the flying bubble's landing animation finishes.
                            var swapT       = (ssiB < 4)
                                                ? touchT + shiftDurB + fd
                                                : arrivalT + landDurB;
                            var oldStatTR   = shelfTimes3[ssiB - 1];
                            var afterSwapTR = (ssiB < 4) ? shelfTimes3[ssiB] : (statTB >= 0 ? statTB : 0);
                            try {
                                ssLL.property("Time Remap").expression =
                                    'time < ' + swapT + ' ? ' + oldStatTR + ' : ' + afterSwapTR + ';';
                            } catch(e3B) {}
                        }

                        // Advance shelf state for next bubble in this batch
                        var nextSTB = []; var nextSCB = [];
                        for (var nsiB = 1; nsiB < 4; nsiB++) { nextSTB.push(shelfTimes3[nsiB]); nextSCB.push(shelfClips3[nsiB]); }
                        var newStatT = statTB >= 0 ? statTB : 0;
                        nextSTB.push(newStatT);
                        nextSCB.push(bfClipByTime(newStatT));
                        shelfTimes3 = nextSTB;
                        shelfClips3 = nextSCB;
                    }

                    flyLog.push("Cell " + bc.ci + ": " + bc.clip);
                }

                statusTxt.text = "Bubble Fly @ " + t0.toFixed(3) + "s  \u2014  " + flyLog.join("  |  ");

            } catch (e) {
                alert("Error: " + e.toString() + (e.line ? "\nLine: " + e.line : ""));
            } finally {
                app.endUndoGroup();
            }
        };

        // Initial load
        refreshLists();

        return win;
    }

    // ----------------------------------------------------------------
    // Launch as panel or floating window
    // ----------------------------------------------------------------
    var win;
    if (thisObj instanceof Panel) {
        win = thisObj;
    } else {
        win = new Window("palette", "Trigger Remap", undefined, { resizeable: true });
    }

    buildUI(win);

    if (win instanceof Window) {
        win.center();
        win.show();
    } else {
        win.layout.layout(true);
    }

}(this));
