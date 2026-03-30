// Trigger Remap Panel
// Dockable ScriptUI panel.
// "Setup Remap" adds Symbol_Cell_1..4 directly into Master, stacked
// vertically, each with independent Time Remap driven by that layer's
// own layer markers (thisLayer.marker expression).
// Each cell row has its own dropdown + "Place Marker" button.

(function (thisObj) {

    var CELL_COUNT  = 4;
    var REEL_COUNT  = 5;
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

    // Find the Reel_Ctrl_R null layer in masterComp
    function findReelNull(masterComp, reelIdx) {
        var name = "Reel_Ctrl_" + reelIdx;
        for (var i = 1; i <= masterComp.layers.length; i++) {
            try { if (masterComp.layers[i].name === name) return masterComp.layers[i]; } catch(e) {}
        }
        return null;
    }

    // Find Symbol_Cell_cellIdx layer parented to nullLayer
    function findCellLayer(masterComp, cellIdx, nullLayer) {
        for (var i = 1; i <= masterComp.layers.length; i++) {
            var l = masterComp.layers[i];
            try {
                if (l.parent === nullLayer && (l.source instanceof CompItem) &&
                    l.source.name === "Symbol_Cell_" + cellIdx) return l;
            } catch(e) {}
        }
        return null;
    }

    // Time Remap expression baked per reel — spin markers named "spinR_N" e.g. "spin1_3"
    function buildTimeRemapExpr(reelIdx) {
        var spfx = "spin" + reelIdx + "_";
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
            '  if (cmt.indexOf("' + spfx + '") === 0) {' +
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
    // Conveyor belt position expression baked per reel (reelIdx 1-based, cellIndex 0-based)
    function buildCellSpinExpr(cellIndex, compSize, reelIdx) {
        var spfx    = "spin" + reelIdx + "_";
        var totalH  = compSize * CELL_COUNT;
        var top     = -(totalH / 2);
        var baseY   = top + compSize * cellIndex + compSize / 2;
        return (
            'var totalH  = ' + totalH + ';' +
            'var top     = ' + top    + ';' +
            'var baseY   = ' + baseY  + ';' +
            'var offset  = 0;' +
            'var mm = thisComp.marker;' +
            'for (var i = 1; i <= mm.numKeys; i++) {' +
            '  var cmt = mm.key(i).comment;' +
            '  if (cmt.indexOf("' + spfx + '") === 0 && mm.key(i).time <= time) {' +
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
    // Build UI  (5 reels)
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

        // ----------------------------------------------------------------
        // Per-reel panels
        // ----------------------------------------------------------------
        var allDropdowns = [];   // [reel 0..4][cell 0..3]
        var allSetupBtns = [];   // [reel 0..4]

        for (var ri = 0; ri < REEL_COUNT; ri++) {
            var reelNum   = ri + 1;
            var reelPanel = win.add("panel", undefined, "Reel " + reelNum);
            reelPanel.orientation  = "column";
            reelPanel.alignChildren = ["fill", "top"];
            reelPanel.spacing = 3;
            reelPanel.margins = [6, 14, 6, 5];

            var setupBtnR = reelPanel.add("button", undefined, "Setup Reel " + reelNum);
            setupBtnR.helpTip = "Adds Symbol_Cell_1..4 into Master for Reel " + reelNum +
                                ", parented to Reel_Ctrl_" + reelNum +
                                ". Creates shelf_reel_" + reelNum + " if needed.";

            var reelDrops = [];
            for (var ci = 0; ci < CELL_COUNT; ci++) {
                var cellNum = ci + 1;
                var row = reelPanel.add("group");
                row.orientation  = "row";
                row.alignChildren = ["left", "center"];
                row.spacing = 3;

                var lbl = row.add("statictext", undefined, "C" + cellNum + ":");
                lbl.preferredSize.width = 20;

                var dd = row.add("dropdownlist", undefined, []);
                dd.preferredSize.width = 130;

                var btn = row.add("button", undefined, "Mark");
                btn.preferredSize.width = 46;

                reelDrops.push(dd);

                // Closure captures reelNum, cellNum, dd, btn
                (function (rIdx, cIdx, dropdown, placeBtn) {
                    placeBtn.onClick = function () {
                        if (!dropdown.selection) { alert("Select a clip for Reel " + rIdx + " Cell " + cIdx + " first."); return; }
                        if (!app.project)        { alert("No project open."); return; }
                        var masterComp = findComp("Master");
                        if (!masterComp)         { alert("No \"Master\" comp found."); return; }
                        var nullLyr = findReelNull(masterComp, rIdx);
                        if (!nullLyr) { alert("Reel_Ctrl_" + rIdx + " not found.\nRun Setup Reel " + rIdx + " first."); return; }
                        var cellLayer = findCellLayer(masterComp, cIdx, nullLyr);
                        if (!cellLayer) { alert("Symbol_Cell_" + cIdx + " for Reel " + rIdx + " not found.\nRun Setup Reel " + rIdx + " first."); return; }
                        var clipName = dropdown.selection.text;
                        var t = masterComp.time;
                        try {
                            app.beginUndoGroup("Place Trigger Marker R" + rIdx + " C" + cIdx);
                            cellLayer.property("Marker").setValueAtTime(t, new MarkerValue(clipName));
                            statusTxt.text = "Reel " + rIdx + " Cell " + cIdx + ": \"" + clipName + "\" @ " + t.toFixed(3) + "s";
                        } catch (e) {
                            alert("Error: " + e.toString());
                        } finally {
                            app.endUndoGroup();
                        }
                    };
                })(reelNum, cellNum, dd, btn);
            }

            allDropdowns.push(reelDrops);
            allSetupBtns.push(setupBtnR);
        }

        win.add("panel").preferredSize.height = 1;

        var refreshBtn   = win.add("button", undefined, "\u27F3 Refresh Clip Lists");
        var randomizeBtn = win.add("button", undefined, "\uD83C\uDFB2 Randomize Stats (all reels)");
        randomizeBtn.helpTip = "Places a random stat clip on every cell of every reel at the current Master playhead";

        win.add("panel").preferredSize.height = 1;

        var spinRow = win.add("group");
        spinRow.orientation  = "row";
        spinRow.alignChildren = ["left", "center"];
        spinRow.spacing = 4;
        var spinBtn = spinRow.add("button", undefined, "\uD83C\uDFB0 Place Spin");
        spinBtn.helpTip = "Stamps spin markers for all 5 reels. Reel 1 at playhead, each subsequent reel delayed. Rename spinR_N for N loops, drag end for speed.";
        spinRow.add("statictext", undefined, "Delay (s):");
        var spinDelayInput = spinRow.add("edittext", undefined, "0.5");
        spinDelayInput.preferredSize.width = 40;
        spinDelayInput.helpTip = "Seconds between each reel's spin start (Reel 1 first, Reel 5 last).";

        win.add("panel").preferredSize.height = 1;

        var flyRow = win.add("group");
        flyRow.orientation  = "row";
        flyRow.alignChildren = ["left", "center"];
        flyRow.spacing = 4;
        flyRow.add("statictext", undefined, "Fly Speed (s):");
        var flySpeedInput = flyRow.add("edittext", undefined, "1.0");
        flySpeedInput.preferredSize.width = 45;
        flyRow.add("statictext", undefined, "Lead offset (s):");
        var shelfLeadInput = flyRow.add("edittext", undefined, "0.0");
        shelfLeadInput.preferredSize.width = 38;
        shelfLeadInput.helpTip = "Fine-tune offset in seconds added to the auto-detected touch time (negative = earlier, positive = later).";

        var bubbleFlyBtn = win.add("button", undefined, "\uD83E\uDEF7 Bubble Fly (all reels)");
        bubbleFlyBtn.helpTip = "At current time: for every reel with bubble cells, fades them to 50% and flies copies up to that reel's shelf.";

        var cleanBtn = win.add("button", undefined, "\uD83D\uDDD1 Clean Up Reels");
        cleanBtn.helpTip = "Removes all Symbol_Cell/shelf/Reel_Ctrl/bubble_fly layers from Master and deletes those comps from the project.";

        // ----------------------------------------------------------------
        // Refresh all dropdowns from Symbol_Cell_1 markers
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
            for (var ri2 = 0; ri2 < REEL_COUNT; ri2++) {
                for (var di = 0; di < allDropdowns[ri2].length; di++) {
                    allDropdowns[ri2][di].removeAll();
                    for (var ii = 0; ii < items.length; ii++) {
                        allDropdowns[ri2][di].add("item", items[ii]);
                    }
                    allDropdowns[ri2][di].selection = 0;
                }
            }
            statusTxt.text = nm + " clips loaded for " + REEL_COUNT + " reels \u00d7 " + CELL_COUNT + " cells";
        }

        // ----------------------------------------------------------------
        // Setup handlers — one per reel
        // ----------------------------------------------------------------
        for (var sb = 0; sb < REEL_COUNT; sb++) {
            (function (reelIdx, setupBtnR) {
                setupBtnR.onClick = function () {
                    if (!app.project) { alert("No project open."); return; }
                    var masterComp = findComp("Master");
                    if (!masterComp) { alert("No \"Master\" comp found."); return; }
                    var cell1 = findComp("Symbol_Cell_1");
                    if (!cell1) { alert("No \"Symbol_Cell_1\" comp found.\nRun import_precomps_to_comp.jsx first."); return; }
                    if (cell1.markerProperty.numKeys === 0) { alert("Symbol_Cell_1 has no markers.\nRe-run import_precomps_to_comp.jsx."); return; }

                    var drawSize = cell1.width;
                    var compSize = Math.round(drawSize / 1.5);
                    var halfCell = compSize / 2;
                    var reelW    = compSize + 50;
                    // Lay out 5 reels evenly across Master width
                    var totalW  = reelW * REEL_COUNT;
                    var startX  = masterComp.width / 2 - totalW / 2 + reelW * (reelIdx - 1) + reelW / 2;
                    var startY  = (masterComp.height - compSize * CELL_COUNT) / 2 + halfCell;

                    try {
                        app.beginUndoGroup("Setup Reel " + reelIdx);
                        var expr     = buildTimeRemapExpr(reelIdx);
                        var nullName = "Reel_Ctrl_" + reelIdx;

                        var nullLayer = findReelNull(masterComp, reelIdx);
                        if (!nullLayer) {
                            nullLayer = masterComp.layers.addNull();
                            nullLayer.name = nullName;
                        }
                        try { nullLayer.property("Position").expression = ""; } catch(ex) {}
                        var nullBaseY = startY + compSize * (CELL_COUNT - 1) / 2;
                        nullLayer.position.setValue([startX, nullBaseY]);

                        for (var ci = 1; ci <= CELL_COUNT; ci++) {
                            var cellComp = findComp("Symbol_Cell_" + ci);
                            if (!cellComp) { alert("\"Symbol_Cell_" + ci + "\" not found."); return; }
                            var cellLayer = findCellLayer(masterComp, ci, nullLayer);
                            if (!cellLayer) {
                                cellLayer = masterComp.layers.add(cellComp);
                                cellLayer.startTime = 0;
                            }
                            cellLayer.parent = nullLayer;
                            cellLayer.property("Position").expression = buildCellSpinExpr(ci - 1, compSize, reelIdx);
                            cellLayer.timeRemapEnabled = true;
                            cellLayer.property("Time Remap").expression = expr;
                        }

                        // Find or create shelf_reel_R
                        var shelfCompName = "shelf_reel_" + reelIdx;
                        var shelfComp2 = findComp(shelfCompName);
                        if (!shelfComp2) {
                            var reelH2   = compSize * CELL_COUNT;
                            shelfComp2   = app.project.items.addComp(shelfCompName, reelW, reelH2, 1, cell1.duration, cell1.frameRate);
                            var shelf13T = 0;
                            var rm2      = cell1.markerProperty;
                            for (var smi2 = 1; smi2 <= rm2.numKeys; smi2++) {
                                if (rm2.keyValue(smi2).comment === "13_1_stat") { shelf13T = rm2.keyTime(smi2); break; }
                            }
                            var reelCX2 = reelW / 2;
                            for (var shi2 = 0; shi2 < CELL_COUNT; shi2++) {
                                var shelfLyr2 = shelfComp2.layers.add(cell1);
                                shelfLyr2.position.setValue([reelCX2, compSize * shi2 + compSize / 2]);
                                shelfLyr2.name = "shelf_cell_" + (shi2 + 1);
                                shelfLyr2.timeRemapEnabled = true;
                                shelfLyr2.property("Time Remap").expression = shelf13T + ";";
                            }
                        }

                        // Add shelf layer to Master
                        var shelfMasterLayer = null;
                        for (var sli2 = 1; sli2 <= masterComp.layers.length; sli2++) {
                            var sl2 = masterComp.layers[sli2];
                            try { if ((sl2.source instanceof CompItem) && sl2.source.name === shelfCompName) { shelfMasterLayer = sl2; break; } } catch(esl) {}
                        }
                        if (!shelfMasterLayer) {
                            shelfMasterLayer = masterComp.layers.add(shelfComp2);
                            shelfMasterLayer.startTime = 0;
                        }
                        shelfMasterLayer.position.setValue([startX, startY - compSize * 1.5]);
                        shelfMasterLayer.parent = nullLayer;

                        statusTxt.text = "Reel " + reelIdx + " ready. Move Reel_Ctrl_" + reelIdx + " to reposition.";
                        refreshLists();
                    } catch (e) {
                        alert("Error: " + e.toString() + (e.line ? "\nLine: " + e.line : ""));
                    } finally {
                        app.endUndoGroup();
                    }
                };
            })(sb + 1, allSetupBtns[sb]);
        }

        refreshBtn.onClick = function () { refreshLists(); };

        spinBtn.onClick = function () {
            if (!app.project) { alert("No project open."); return; }
            var masterComp = findComp("Master");
            if (!masterComp) { alert("No \"Master\" comp found."); return; }
            var delay = parseFloat(spinDelayInput.text);
            if (isNaN(delay) || delay < 0) delay = 0;
            var t = masterComp.time;
            try {
                app.beginUndoGroup("Place Spin Markers");
                for (var si = 1; si <= REEL_COUNT; si++) {
                    var spinMv = new MarkerValue("spin" + si + "_3");
                    spinMv.duration = 2.0;
                    masterComp.markerProperty.setValueAtTime(t + (si - 1) * delay, spinMv);
                }
                statusTxt.text = "Spin markers @ " + t.toFixed(3) + "s  (delay " + delay + "s per reel)";
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

            // Collect stat clips and shelf variant clips
            var nm       = seqComp.markerProperty.numKeys;
            var statClips  = [];
            var shelfClips = [];
            for (var mi = 1; mi <= nm; mi++) {
                var cmt = seqComp.markerProperty.keyValue(mi).comment;
                if (cmt.indexOf("_stat") !== -1) statClips.push(cmt);
                if (/^13_\d+_stat$/.test(cmt))   shelfClips.push(cmt);
            }
            if (statClips.length === 0) {
                alert("No \"_stat\" clips found in Symbol_Cell_1 markers.");
                return;
            }

            var t      = masterComp.time;
            var placed = [];

            try {
                app.beginUndoGroup("Randomize Stats");

                for (var ri3 = 1; ri3 <= REEL_COUNT; ri3++) {
                    var nullLyr3 = findReelNull(masterComp, ri3);
                    if (!nullLyr3) continue;

                    for (var ci4 = 1; ci4 <= CELL_COUNT; ci4++) {
                        var cellLyr4 = findCellLayer(masterComp, ci4, nullLyr3);
                        if (!cellLyr4) continue;
                        var pick = statClips[Math.floor(Math.random() * statClips.length)];
                        cellLyr4.property("Marker").setValueAtTime(t, new MarkerValue(pick));
                        placed.push("R" + ri3 + "C" + ci4 + ":" + pick);
                        var dd3 = allDropdowns[ri3 - 1][ci4 - 1];
                        for (var di3 = 0; di3 < dd3.items.length; di3++) {
                            if (dd3.items[di3].text === pick) { dd3.selection = di3; break; }
                        }
                    }

                    // Randomize shelf_reel_R
                    if (shelfClips.length > 0) {
                        var shelfCompR = findComp("shelf_reel_" + ri3);
                        if (shelfCompR) {
                            for (var shli = 1; shli <= shelfCompR.layers.length; shli++) {
                                var shLyr = shelfCompR.layers[shli];
                                if (!(shLyr.source instanceof CompItem)) continue;
                                var sPick = shelfClips[Math.floor(Math.random() * shelfClips.length)];
                                var sTime = 0;
                                for (var smk = 1; smk <= nm; smk++) {
                                    if (seqComp.markerProperty.keyValue(smk).comment === sPick) {
                                        sTime = seqComp.markerProperty.keyTime(smk); break;
                                    }
                                }
                                try { shLyr.property("Time Remap").expression = sTime + ";"; } catch(ex) {}
                            }
                        }
                    }
                }

                statusTxt.text = "Randomized @ " + t.toFixed(3) + "s  \u2014  " + placed.length + " cells across " + REEL_COUNT + " reels";
            } catch (e) {
                alert("Error: " + e.toString());
            } finally {
                app.endUndoGroup();
            }
        };

        // ----------------------------------------------------------------
        // Bubble Fly — iterates over all reels
        // ----------------------------------------------------------------
        bubbleFlyBtn.onClick = function () {
            if (!app.project) { alert("No project open."); return; }

            var masterComp = findComp("Master");
            if (!masterComp) { alert("No \"Master\" comp found."); return; }

            var seqComp = findComp("Symbol_Cell_1");
            if (!seqComp || seqComp.markerProperty.numKeys === 0) {
                alert("Symbol_Cell_1 not found or has no markers."); return;
            }

            var compSize = Math.round(seqComp.width / 1.5);
            var fd       = 1.0 / masterComp.frameRate;
            var flyDur   = parseFloat(flySpeedInput.text);
            if (isNaN(flyDur) || flyDur <= 0) flyDur = 1.0;
            var t0  = masterComp.time;
            var nm  = seqComp.markerProperty.numKeys;

            // Shared clip lookup helpers
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
            function bfClipByTime(tv) {
                var bestName = ""; var bestDiff = 999999;
                for (var xi = 1; xi <= nm; xi++) {
                    var diff = Math.abs(seqComp.markerProperty.keyTime(xi) - tv);
                    if (diff < bestDiff) { bestDiff = diff; bestName = seqComp.markerProperty.keyValue(xi).comment; }
                }
                return bestName;
            }

            var allFlyLog = [];

            try {
                app.beginUndoGroup("Bubble Fly");

                for (var reelFly = 1; reelFly <= REEL_COUNT; reelFly++) {
                    var nullLyrF = findReelNull(masterComp, reelFly);
                    if (!nullLyrF) continue;

                    var nullPosF = nullLyrF.position.value;
                    var nullXF   = nullPosF[0];
                    var nullYF   = nullPosF[1];

                    var shelfCompName = "shelf_reel_" + reelFly;
                    var shelfMasterLyrF = null;
                    for (var smlI = 1; smlI <= masterComp.layers.length; smlI++) {
                        var smlL = masterComp.layers[smlI];
                        try { if ((smlL.source instanceof CompItem) && smlL.source.name === shelfCompName) { shelfMasterLyrF = smlL; break; } } catch(e0) {}
                    }
                    var shelfCompF  = shelfMasterLyrF ? shelfMasterLyrF.source : findComp(shelfCompName);
                    var shelfParYF  = shelfMasterLyrF ? shelfMasterLyrF.position.value[1] : (-3 * compSize);
                    var shelf4YF    = nullYF + shelfParYF + (CELL_COUNT / 2 - 0.5) * compSize;
                    var spinPfxF    = "spin" + reelFly + "_";

                    // Find bubble cells for this reel (cells 2-4 only)
                    var bubbleCells = [];
                    for (var ci3 = 2; ci3 <= CELL_COUNT; ci3++) {
                        var clyr3 = findCellLayer(masterComp, ci3, nullLyrF);
                        if (!clyr3) continue;
                        var lastCmt3 = ""; var lastMT3 = -1;
                        var lm3 = clyr3.property("Marker");
                        for (var mk3 = 1; mk3 <= lm3.numKeys; mk3++) {
                            var mt3 = lm3.keyTime(mk3);
                            if (mt3 <= t0 && mt3 > lastMT3) { lastMT3 = mt3; lastCmt3 = lm3.keyValue(mk3).comment; }
                        }
                        if (lastCmt3 === "") continue;
                        var baseId3 = lastCmt3.split("_")[0];
                        if (BUBBLE_IDS[baseId3]) bubbleCells.push({ ci: ci3, layer: clyr3, clip: lastCmt3 });
                    }
                    if (bubbleCells.length === 0) continue; // no bubbles in this reel

                    // Read shelf state at t0
                    var shelfTimes3 = [];
                    var shelfClips3 = [];
                    for (var stsi = 1; stsi <= 4; stsi++) {
                        var stslL = null;
                        if (shelfCompF) {
                            for (var stli = 1; stli <= shelfCompF.layers.length; stli++) {
                                if (shelfCompF.layers[stli].name === "shelf_cell_" + stsi) { stslL = shelfCompF.layers[stli]; break; }
                            }
                        }
                        var stv = 0;
                        try { stv = stslL ? stslL.property("Time Remap").valueAtTime(t0, false) : 0; } catch(e2) {}
                        shelfTimes3.push(stv);
                        shelfClips3.push(bfClipByTime(stv));
                    }

                    // Clear accumulated shelf keyframes
                    if (shelfCompF) {
                        for (var sci = 1; sci <= 4; sci++) {
                            for (var scli = 1; scli <= shelfCompF.layers.length; scli++) {
                                if (shelfCompF.layers[scli].name === "shelf_cell_" + sci) {
                                    var scLayer = shelfCompF.layers[scli];
                                    try { var scP = scLayer.property("Position");  while (scP.numKeys  > 0) scP.removeKey(1);  } catch(esc1) {}
                                    try { var scO = scLayer.property("Opacity");   while (scO.numKeys  > 0) scO.removeKey(1);  } catch(esc2) {}
                                    break;
                                }
                            }
                        }
                    }

                    // Pre-compute travel distances + sequential launch times
                    var maxDistB = 0;
                    for (var bdi = 0; bdi < bubbleCells.length; bdi++) {
                        var bdc = bubbleCells[bdi];
                        var bdParY = (-CELL_COUNT / 2 + bdc.ci - 1 + 0.5) * compSize;
                        bdc.dist = (nullYF + bdParY) - shelf4YF;
                        if (bdc.dist > maxDistB) maxDistB = bdc.dist;
                    }
                    if (maxDistB <= 0) maxDistB = compSize;
                    var curLaunchT = t0;
                    for (var bdi2 = 0; bdi2 < bubbleCells.length; bdi2++) {
                        bubbleCells[bdi2].flyDurB  = flyDur * (bubbleCells[bdi2].dist / maxDistB);
                        bubbleCells[bdi2].launchT  = curLaunchT;
                        bubbleCells[bdi2].arrivalT = curLaunchT + bubbleCells[bdi2].flyDurB;
                        curLaunchT = bubbleCells[bdi2].arrivalT;
                    }

                    var slotTRParts = [[], [], [], []];
                    var slotTRInit  = [shelfTimes3[0], shelfTimes3[1], shelfTimes3[2], shelfTimes3[3]];

                    for (var bi = 0; bi < bubbleCells.length; bi++) {
                        var bc        = bubbleCells[bi];
                        var launchT   = bc.launchT;
                        var arrivalT  = bc.arrivalT;
                        var flyDurB   = bc.flyDurB;
                        var shiftDurB = Math.min(flyDurB * 0.25, 0.4);

                        // Reel cell opacity: 100 → 50%, restore at next spin for this reel
                        var opPropB = bc.layer.property("Opacity");
                        opPropB.setValueAtTime(launchT,      100);
                        opPropB.setValueAtTime(launchT + fd,  50);
                        var cmB = masterComp.markerProperty;
                        var nextSpinT = -1;
                        for (var nsi = 1; nsi <= cmB.numKeys; nsi++) {
                            var nst = cmB.keyTime(nsi);
                            if (nst > launchT && cmB.keyValue(nsi).comment.indexOf(spinPfxF) === 0) {
                                if (nextSpinT < 0 || nst < nextSpinT) nextSpinT = nst;
                            }
                        }
                        if (nextSpinT >= 0) {
                            opPropB.setValueAtTime(nextSpinT - fd, 50);
                            opPropB.setValueAtTime(nextSpinT,     100);
                        }

                        // Land clip info
                        var liPosB    = bc.clip.lastIndexOf("_");
                        var landClipB = (liPosB >= 0 ? bc.clip.substring(0, liPosB) : bc.clip) + "_land";
                        var landStB   = bfMTime(landClipB);
                        var landEnB   = bfMEnd(landClipB);
                        var landDurB  = (landStB >= 0 && landEnB > landStB) ? (landEnB - landStB) : 1.0;
                        var statTB    = bfMTime(bc.clip);

                        // Create fly layer in Master parented to this reel's null
                        var flyLyr = masterComp.layers.add(seqComp);
                        flyLyr.name = "bubble_fly_r" + reelFly + "_" + (bi + 1);
                        flyLyr.moveToBeginning();
                        flyLyr.inPoint  = launchT;
                        flyLyr.outPoint = Math.min(arrivalT + landDurB + fd, masterComp.duration);
                        flyLyr.parent   = nullLyrF;

                        // Position keyframes (parent-relative)
                        var cellParYB = (-CELL_COUNT / 2 + bc.ci - 1 + 0.5) * compSize;
                        var flyEndY   = shelf4YF - nullYF;
                        var posPropB  = flyLyr.property("Position");
                        posPropB.setValueAtTime(launchT,  [0, cellParYB]);
                        posPropB.setValueAtTime(arrivalT, [0, flyEndY]);
                        try {
                            posPropB.setTemporalEaseAtKey(1, [new KeyframeEase(0,   50)], [new KeyframeEase(100, 50)]);
                            posPropB.setTemporalEaseAtKey(2, [new KeyframeEase(100,  0)], [new KeyframeEase(0,    0)]);
                        } catch(eEase) {}

                        // Touch time (ease-out geometry)
                        var totalTravelB2 = cellParYB - flyEndY;
                        var touchP = (totalTravelB2 > compSize / 2) ? 1 - Math.sqrt(compSize / (2 * totalTravelB2)) : 0;
                        touchP = Math.max(0, Math.min(1, touchP));
                        var leadOffset = parseFloat(shelfLeadInput.text);
                        if (isNaN(leadOffset)) leadOffset = 0;
                        var touchT = launchT + touchP * flyDurB + leadOffset;

                        // Time Remap: stat during flight, land on arrival
                        flyLyr.timeRemapEnabled = true;
                        flyLyr.property("Time Remap").expression =
                            'var aT=' + arrivalT + ';' +
                            'var st=' + (statTB >= 0 ? statTB : 0) + ';' +
                            'var ls=' + (landStB >= 0 ? landStB : 0) + ';' +
                            'var ld=' + landDurB + ';' +
                            'if(time<aT){st;}else{var el=time-aT;ls+Math.min(el,ld-thisComp.frameDuration);}';

                        // Shelf animation
                        if (shelfCompF) {
                            var shWF = shelfCompF.width / 2;
                            for (var ssiB = 1; ssiB <= 4; ssiB++) {
                                var ssLL = null;
                                for (var ssliB = 1; ssliB <= shelfCompF.layers.length; ssliB++) {
                                    if (shelfCompF.layers[ssliB].name === "shelf_cell_" + ssiB) { ssLL = shelfCompF.layers[ssliB]; break; }
                                }
                                if (!ssLL) continue;

                                var origYB = compSize * (ssiB - 1) + compSize / 2;
                                var ppB = ssLL.property("Position");
                                ppB.setValueAtTime(touchT,                  [shWF, origYB]);
                                ppB.setValueAtTime(touchT + shiftDurB,       [shWF, origYB - compSize]);
                                ppB.setValueAtTime(touchT + shiftDurB + fd,  [shWF, origYB]);
                                try {
                                    for (var kki = 1; kki <= ppB.numKeys; kki++) {
                                        var kkt = ppB.keyTime(kki);
                                        if      (Math.abs(kkt - touchT)                    < fd * 0.5) ppB.setInterpolationTypeAtKey(kki, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
                                        else if (Math.abs(kkt - (touchT + shiftDurB))      < fd * 0.5) ppB.setInterpolationTypeAtKey(kki, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.HOLD);
                                        else if (Math.abs(kkt - (touchT + shiftDurB + fd)) < fd * 0.5) ppB.setInterpolationTypeAtKey(kki, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
                                    }
                                } catch(eKi) {}

                                if (ssiB === 1) {
                                    var topOpB = ssLL.property("Opacity");
                                    topOpB.setValueAtTime(touchT,                 100);
                                    topOpB.setValueAtTime(touchT + shiftDurB,       0);
                                    topOpB.setValueAtTime(touchT + shiftDurB + fd, 100);
                                    try {
                                        for (var koi = 1; koi <= topOpB.numKeys; koi++) {
                                            var kot = topOpB.keyTime(koi);
                                            if      (Math.abs(kot - touchT)               < fd * 0.5) topOpB.setInterpolationTypeAtKey(koi, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
                                            else if (Math.abs(kot - (touchT + shiftDurB)) < fd * 0.5) topOpB.setInterpolationTypeAtKey(koi, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.HOLD);
                                        }
                                    } catch(eOi) {}
                                }

                                if (ssiB === 4) {
                                    var s4Op = ssLL.property("Opacity");
                                    s4Op.setValueAtTime(arrivalT - fd,           100);
                                    s4Op.setValueAtTime(arrivalT,                  0);
                                    s4Op.setValueAtTime(arrivalT + landDurB - fd,  0);
                                    s4Op.setValueAtTime(arrivalT + landDurB,      100);
                                    try {
                                        for (var k4i = 1; k4i <= s4Op.numKeys; k4i++) {
                                            s4Op.setInterpolationTypeAtKey(k4i, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
                                        }
                                    } catch(eS4) {}
                                }

                                var swapT2     = (ssiB < 4) ? touchT + shiftDurB + fd : arrivalT + landDurB;
                                var newTR2     = (ssiB < 4) ? shelfTimes3[ssiB] : (statTB >= 0 ? statTB : 0);
                                var sClip2     = shelfClips3[ssiB - 1];
                                var sLiPos2    = sClip2.lastIndexOf("_");
                                var sLandClip2 = (sLiPos2 >= 0 ? sClip2.substring(0, sLiPos2) : sClip2) + "_land";
                                var sLandSt2   = bfMTime(sLandClip2);
                                var sLandEn2   = bfMEnd(sLandClip2);
                                var sLandDur2  = (sLandSt2 >= 0 && sLandEn2 > sLandSt2) ? (sLandEn2 - sLandSt2) : shiftDurB;
                                slotTRParts[ssiB - 1].push({
                                    touchT: touchT, shiftDurB: shiftDurB,
                                    landSt: sLandSt2, landDur: sLandDur2,
                                    swapT: swapT2, tr: newTR2
                                });
                            }

                            var nextSTB = []; var nextSCB = [];
                            for (var nsiB = 1; nsiB < 4; nsiB++) { nextSTB.push(shelfTimes3[nsiB]); nextSCB.push(shelfClips3[nsiB]); }
                            var newStatT = statTB >= 0 ? statTB : 0;
                            nextSTB.push(newStatT);
                            nextSCB.push(bfClipByTime(newStatT));
                            shelfTimes3 = nextSTB;
                            shelfClips3 = nextSCB;
                        }

                        allFlyLog.push("R" + reelFly + "C" + bc.ci + ":" + bc.clip);
                    } // end bubble loop

                    // Write piecewise Time Remap expressions for shelf slots
                    if (shelfCompF) {
                        for (var wrS = 1; wrS <= 4; wrS++) {
                            var wrLL = null;
                            for (var wrLi = 1; wrLi <= shelfCompF.layers.length; wrLi++) {
                                if (shelfCompF.layers[wrLi].name === "shelf_cell_" + wrS) { wrLL = shelfCompF.layers[wrLi]; break; }
                            }
                            if (!wrLL) continue;
                            var wrParts = slotTRParts[wrS - 1];
                            var wrExpr  = '';
                            for (var pi = 0; pi < wrParts.length; pi++) {
                                var beforeTR = (pi === 0) ? slotTRInit[wrS - 1] : wrParts[pi - 1].tr;
                                var wp       = wrParts[pi];
                                var sweepEnd = wp.touchT + wp.shiftDurB;
                                wrExpr += 'time<' + wp.touchT + '?' + beforeTR + ':';
                                if (wp.landSt >= 0) {
                                    wrExpr += 'time<' + sweepEnd + '?(' + wp.landSt +
                                              '+Math.min(time-' + wp.touchT + ',' + wp.landDur +
                                              '-thisComp.frameDuration)):';
                                }
                                wrExpr += 'time<' + wp.swapT + '?' + beforeTR + ':';
                            }
                            wrExpr += (wrParts.length > 0) ? (wrParts[wrParts.length - 1].tr + ';') : (slotTRInit[wrS - 1] + ';');
                            try { wrLL.property("Time Remap").expression = wrExpr; } catch(eWR) {}
                        }
                    }
                } // end reel loop

                if (allFlyLog.length === 0) {
                    alert("No bubble symbols (IDs: 13, 22-25) found in any reel at current time.\nPlace stat markers for bubble symbols first.");
                } else {
                    statusTxt.text = "Bubble Fly @ " + t0.toFixed(3) + "s  \u2014  " + allFlyLog.join("  |  ");
                }
            } catch (e) {
                alert("Error: " + e.toString() + (e.line ? "\nLine: " + e.line : ""));
            } finally {
                app.endUndoGroup();
            }
        };

        // ----------------------------------------------------------------
        // Clean Up — removes all reel layers + project comps for all 5 reels
        // ----------------------------------------------------------------
        cleanBtn.onClick = function () {
            if (!app.project) { alert("No project open."); return; }
            var masterComp = findComp("Master");
            if (!masterComp) { alert("No \"Master\" comp found."); return; }

            var confirmed = confirm(
                "This will:\n" +
                "  \u2022 Remove all Symbol_Cell, shelf_reel_1\u20135, Reel_Ctrl_1\u20135 and bubble_fly layers from Master\n" +
                "  \u2022 Delete Symbol_Cell_1\u20134, reel_1 and shelf_reel_1\u20135 comps from the project\n\n" +
                "Continue?");
            if (!confirmed) return;

            try {
                app.beginUndoGroup("Clean Up Reels");

                var PROJ_DEL = {};
                PROJ_DEL["Symbol_Cell_1"] = 1; PROJ_DEL["Symbol_Cell_2"] = 1;
                PROJ_DEL["Symbol_Cell_3"] = 1; PROJ_DEL["Symbol_Cell_4"] = 1;
                PROJ_DEL["reel_1"] = 1;
                for (var rci = 1; rci <= REEL_COUNT; rci++) { PROJ_DEL["shelf_reel_" + rci] = 1; }

                var layersToRemove = [];
                for (var rli = 1; rli <= masterComp.layers.length; rli++) {
                    var rl  = masterComp.layers[rli];
                    var rln = rl.name;
                    var remove = rln.indexOf("bubble_fly_") === 0 ||
                                 rln.indexOf("Reel_Ctrl_")  === 0 ||
                                 rln === "Reel_Ctrl";
                    if (!remove) {
                        try {
                            if (rl.source instanceof CompItem) {
                                var sn = rl.source.name;
                                if (sn === "reel_1" || sn.indexOf("Symbol_Cell_") === 0 || sn.indexOf("shelf_reel_") === 0) remove = true;
                            }
                        } catch(ex0) {}
                    }
                    if (remove) layersToRemove.push(rl);
                }
                for (var lri = 0; lri < layersToRemove.length; lri++) {
                    try { layersToRemove[lri].remove(); } catch(ex1) {}
                }

                var projItemsToRemove = [];
                for (var pi = 1; pi <= app.project.items.length; pi++) {
                    var pitem;
                    try { pitem = app.project.items[pi]; } catch(ex2) { continue; }
                    if (!(pitem instanceof CompItem)) continue;
                    if (PROJ_DEL[pitem.name]) projItemsToRemove.push(pitem);
                }
                for (var pri = 0; pri < projItemsToRemove.length; pri++) {
                    try { projItemsToRemove[pri].remove(); } catch(ex3) {}
                }

                statusTxt.text = "Removed " + layersToRemove.length + " layer(s) from Master, " +
                                 projItemsToRemove.length + " comp(s) from project.";
            } catch(e) {
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
