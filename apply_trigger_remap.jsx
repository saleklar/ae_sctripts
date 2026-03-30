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
            '      autoLandClip = (sbName !== "") ? sbName.split("_")[0] + "_land" : "";' +
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

        // Variant number overlay font
        var fontRow = win.add("group");
        fontRow.orientation = "row";
        fontRow.alignChildren = ["left", "center"];
        fontRow.spacing = 4;
        fontRow.add("statictext", undefined, "Font:").preferredSize.width = 30;
        var fontEdit = fontRow.add("edittext", undefined, "BlueWinter-Regular");
        fontEdit.preferredSize.width = 140;
        fontEdit.helpTip = "PostScript font name for variant (13_1..13_9) number overlays";
        var applyFontBtn = fontRow.add("button", undefined, "Apply");
        applyFontBtn.preferredSize.width = 55;
        applyFontBtn.helpTip = "Updates font on all _num text layers in Symbol_Cell_1..4";

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

        applyFontBtn.onClick = function () {
            if (!app.project) { alert("No project open."); return; }
            var fontName = fontEdit.text;
            if (!fontName || fontName === "") { alert("Enter a font name."); return; }
            var updated = 0;
            var actualFont = "";
            try {
                app.beginUndoGroup("Apply Variant Font");
                for (var fi = 1; fi <= CELL_COUNT; fi++) {
                    var cellComp = findComp("Symbol_Cell_" + fi);
                    if (!cellComp) continue;
                    for (var li = 1; li <= cellComp.layers.length; li++) {
                        var l = cellComp.layers[li];
                        if (l.name.indexOf("_num") === l.name.length - 4 && l instanceof TextLayer) {
                            var tp = l.property("Source Text");
                            if (tp.numKeys > 0) {
                                for (var ki = 1; ki <= tp.numKeys; ki++) {
                                    var td = tp.keyValue(ki);
                                    td.font = fontName;
                                    tp.setValueAtKey(ki, td);
                                    // Read back the actual PostScript name AE used
                                    if (actualFont === "") actualFont = tp.keyValue(ki).font;
                                }
                            } else {
                                var td2 = tp.value;
                                td2.font = fontName;
                                tp.setValue(td2);
                                if (actualFont === "") actualFont = tp.value.font;
                            }
                            updated++;
                        }
                    }
                }
                if (updated === 0) {
                    statusTxt.text = "No _num layers found. Re-run import script first.";
                } else if (actualFont !== "" && actualFont !== fontName) {
                    // AE substituted a different font — show the real name
                    statusTxt.text = updated + " layers updated. AE used: \"" + actualFont + "\"";
                    fontEdit.text = actualFont;  // auto-correct the field
                    alert("Font substituted!\nYou typed:   \"" + fontName + "\"\nAE used:     \"" + actualFont + "\"\n\nThe field has been updated with the correct name.");
                } else {
                    statusTxt.text = "Font \"" + actualFont + "\" applied to " + updated + " layers.";
                }
            } catch (e) {
                alert("Error: " + e.toString());
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
