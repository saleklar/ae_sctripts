// Trigger Remap Panel
// Dockable ScriptUI panel.
// "Setup Remap" adds Symbol_Cell_1..4 directly into Master, stacked
// vertically, each with independent Time Remap driven by that layer's
// own layer markers (thisLayer.marker expression).
// Each cell row has its own dropdown + "Place Marker" button.

(function (thisObj) {

    var CELL_COUNT = 4;

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
    // comp("Symbol_Cell_1").marker for clip start/end table (all cells identical)
    function buildTimeRemapExpr() {
        return (
            'var trigName = ""; var trigTime = -1;' +
            'var mm = thisLayer.marker;' +
            'for (var mi = 1; mi <= mm.numKeys; mi++) {' +
            '  var mt = mm.key(mi).time;' +
            '  if (mt <= time && mt > trigTime) { trigTime = mt; trigName = mm.key(mi).comment; }' +
            '}' +
            'if (trigName === "" || trigTime < 0) {' +
            '  0;' +
            '} else {' +
            '  var sm = comp("Symbol_Cell_1").marker;' +
            '  var clipStart = -1;' +
            '  var clipEnd   = comp("Symbol_Cell_1").duration;' +
            '  for (var si = 1; si <= sm.numKeys; si++) {' +
            '    if (sm.key(si).comment === trigName) {' +
            '      clipStart = sm.key(si).time;' +
            '      clipEnd   = (si < sm.numKeys) ? sm.key(si+1).time : comp("Symbol_Cell_1").duration;' +
            '      break;' +
            '    }' +
            '  }' +
            '  if (clipStart < 0) {' +
            '    0;' +
            '  } else {' +
            '    var elapsed = time - trigTime;' +
            '    Math.min(clipStart + elapsed, clipEnd - thisComp.frameDuration);' +
            '  }' +
            '}'
        );
    }

    // ----------------------------------------------------------------
    // Spin expression — applied to Reel_Ctrl Y position
    // Y value = cumulative scroll offset (px). Starts at 0.
    // Each "spin" comp marker contributes: totalH * 3 * eased(elapsed)
    // so multiple spins accumulate cleanly.
    // ----------------------------------------------------------------
    function buildSpinExpr(cellH) {
        var totalH = cellH * CELL_COUNT;
        return (
            'var spinDur = 2.0;' +
            'var totalH = ' + totalH + ';' +
            'var cycles = 3;' +
            'var offset = 0;' +
            'var mm = thisComp.marker;' +
            'for (var i = 1; i <= mm.numKeys; i++) {' +
            '  if (mm.key(i).comment === "spin" && mm.key(i).time <= time) {' +
            '    var st = mm.key(i).time;' +
            '    var elapsed = Math.min(time - st, spinDur);' +
            '    var t = elapsed / spinDur;' +
            '    var eased = (t >= 1) ? 1 : 1 - Math.pow(2, -10 * t);' +
            '    offset += totalH * cycles * eased;' +
            '  }' +
            '}' +
            '[value[0], offset];'
        );
    }

    // Per-cell conveyor position expression.
    // Reads Reel_Ctrl Y as scroll offset and wraps Y within the stack.
    function buildCellPosExpr(startX, startY, cellIndex, compSize) {
        var totalH = compSize * CELL_COUNT;
        return (
            'var scrollY = thisComp.layer("Reel_Ctrl").transform.position[1];' +
            'var cellH = ' + compSize + ';' +
            'var totalH = ' + totalH + ';' +
            'var topY = ' + startY + ';' +
            'var baseY = topY + cellH * ' + cellIndex + ';' +
            'var rawY = baseY + scrollY;' +
            'var wrapped = ((rawY - topY) % totalH + totalH) % totalH + topY;' +
            '[' + startX + ', wrapped];'
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
        spinBtn.helpTip = "Stamps a 'spin' comp marker at the Master playhead; Reel_Ctrl Y will animate 3 conveyor cycles";

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

            var compSize = cell1.width;
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
                    // Y=0 means zero scroll; expression drives Y as cumulative offset
                    nullLayer.position.setValue([startX, 0]);
                }

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

                    // Remove parent if previously set
                    cellLayer.parent = null;

                    // Each cell gets its own modulo-wrap position expression
                    cellLayer.property("Position").expression =
                        buildCellPosExpr(startX, startY, ci - 1, compSize);

                    cellLayer.timeRemapEnabled = true;
                    cellLayer.property("Time Remap").expression = expr;
                }

                // Reel_Ctrl Y drives the scroll offset
                nullLayer.property("Position").expression = buildSpinExpr(compSize);

                statusTxt.text = "Setup done. Spin: cells wrap independently. Place spin markers to animate.";
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
                masterComp.markerProperty.setValueAtTime(t, new MarkerValue("spin"));
                statusTxt.text = "Spin @ " + t.toFixed(3) + "s  \u2014  2s, 3 cycles";
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
            } catch (e) {
                alert("Error: " + e.toString());
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
