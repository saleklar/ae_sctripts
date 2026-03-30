// Trigger Remap Panel
// Dockable ScriptUI panel.
// 1. Click "Setup Remap" to add Symbol_Cell_1 to Master comp and apply
//    the time-remap expression that responds to named markers.
// 2. Pick a clip from the dropdown and click "Place Marker" to stamp
//    that clip name as a marker at the current Master comp playhead position.
// 3. Click "Refresh" to reload the clip list from Symbol_Cell_1 markers.

(function (thisObj) {

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

    function buildTimeRemapExpr(seqName) {
        return (
            'var trigName = ""; var trigTime = -1;' +
            'var mm = thisComp.marker;' +
            'for (var mi = 1; mi <= mm.numKeys; mi++) {' +
            '  var mt = mm.key(mi).time;' +
            '  if (mt <= time && mt > trigTime) { trigTime = mt; trigName = mm.key(mi).comment; }' +
            '}' +
            'if (trigName === "" || trigTime < 0) {' +
            '  0;' +
            '} else {' +
            '  var sm = comp("' + seqName + '").marker;' +
            '  var clipStart = -1;' +
            '  var clipEnd   = comp("' + seqName + '").duration;' +
            '  for (var si = 1; si <= sm.numKeys; si++) {' +
            '    if (sm.key(si).comment === trigName) {' +
            '      clipStart = sm.key(si).time;' +
            '      clipEnd   = (si < sm.numKeys) ? sm.key(si+1).time : comp("' + seqName + '").duration;' +
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

        win.add("panel").preferredSize.height = 1; // divider

        // Setup button
        var setupBtn = win.add("button", undefined, "Setup Remap (Master + Symbol_Cell_1)");
        setupBtn.helpTip = "Adds Symbol_Cell_1 to Master comp and applies Time Remap expression";

        win.add("panel").preferredSize.height = 1; // divider

        // Dropdown + place marker row
        var row = win.add("group");
        row.orientation = "row";
        row.alignChildren = ["fill", "center"];
        row.spacing = 4;

        var dd = row.add("dropdownlist", undefined, []);
        dd.alignment = ["fill", "center"];
        dd.preferredSize.width = 160;

        var placeBtn = row.add("button", undefined, "Place Marker");
        placeBtn.preferredSize.width = 100;

        // Refresh button
        var refreshBtn = win.add("button", undefined, "⟳ Refresh Clip List");

        // ----------------------------------------------------------------
        // Logic
        // ----------------------------------------------------------------
        function refreshList() {
            dd.removeAll();
            var seqComp = findComp("Symbol_Cell_1");
            if (!seqComp) {
                statusTxt.text = "Symbol_Cell_1 not found";
                return;
            }
            var nm = seqComp.markerProperty.numKeys;
            if (nm === 0) {
                statusTxt.text = "Symbol_Cell_1 has no markers";
                return;
            }
            for (var mi = 1; mi <= nm; mi++) {
                dd.add("item", seqComp.markerProperty.keyValue(mi).comment);
            }
            dd.selection = 0;
            statusTxt.text = nm + " clips loaded from Symbol_Cell_1";
        }

        setupBtn.onClick = function () {
            if (!app.project) { alert("No project open."); return; }

            var masterComp = findComp("Master");
            var seqComp    = findComp("Symbol_Cell_1");

            if (!masterComp) { alert("No \"Master\" comp found."); return; }
            if (!seqComp)    { alert("No \"Symbol_Cell_1\" comp found.\nRun import_precomps_to_comp.jsx first."); return; }
            if (seqComp.markerProperty.numKeys === 0) {
                alert("Symbol_Cell_1 has no clip markers.\nRe-run import_precomps_to_comp.jsx.");
                return;
            }

            try {
                app.beginUndoGroup("Setup Trigger Remap");

                // Find or add the Symbol_Cell_1 layer in Master
                var seqLayer = null;
                for (var li = 1; li <= masterComp.layers.length; li++) {
                    var l = masterComp.layers[li];
                    if ((l.source instanceof CompItem) && l.source.name === "Symbol_Cell_1") {
                        seqLayer = l; break;
                    }
                }
                if (!seqLayer) {
                    seqLayer = masterComp.layers.add(seqComp);
                    seqLayer.startTime = 0;
                    seqLayer.position.setValue([masterComp.width / 2, masterComp.height / 2]);
                }

                seqLayer.timeRemapEnabled = true;
                seqLayer.property("Time Remap").expression = buildTimeRemapExpr(seqComp.name);

                statusTxt.text = "Remap applied to Master! Place markers to trigger clips.";
                refreshList();
            } catch (e) {
                alert("Error: " + e.toString());
            } finally {
                app.endUndoGroup();
            }
        };

        placeBtn.onClick = function () {
            if (!dd.selection) { alert("Select a clip from the list first."); return; }
            if (!app.project)  { alert("No project open."); return; }

            var masterComp = findComp("Master");
            if (!masterComp) { alert("No \"Master\" comp found."); return; }

            var clipName = dd.selection.text;
            var t = masterComp.time;

            try {
                app.beginUndoGroup("Place Trigger Marker");
                var mv = new MarkerValue(clipName);
                masterComp.markerProperty.setValueAtTime(t, mv);
                statusTxt.text = "Marker \"" + clipName + "\" placed at " + t.toFixed(3) + "s";
            } catch (e) {
                alert("Error placing marker: " + e.toString());
            } finally {
                app.endUndoGroup();
            }
        };

        refreshBtn.onClick = function () { refreshList(); };

        // Initial load
        refreshList();

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
