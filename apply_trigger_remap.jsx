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

        var refreshBtn = win.add("button", undefined, "\u27F3 Refresh Clip Lists");

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
                        cellLayer.position.setValue([startX, startY + compSize * (ci - 1)]);
                    }

                    cellLayer.timeRemapEnabled = true;
                    cellLayer.property("Time Remap").expression = expr;
                }

                statusTxt.text = "Cells 1-" + CELL_COUNT + " added to Master. Place markers per cell.";
                refreshLists();

            } catch (e) {
                alert("Error: " + e.toString() + (e.line ? "\nLine: " + e.line : ""));
            } finally {
                app.endUndoGroup();
            }
        };

        refreshBtn.onClick = function () { refreshLists(); };

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
