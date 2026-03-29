// Reel Symbol Chart — dockable panel for After Effects
// -------------------------------------------------------
// INSTALL: copy this file to your AE ScriptUI Panels folder
//   Windows: C:\Program Files\Adobe\Adobe After Effects <ver>\Support Files\Scripts\ScriptUI Panels\
//   Mac    : /Applications/Adobe After Effects <ver>/Scripts/ScriptUI Panels/
// Then restart AE — the panel appears under Window menu.
//
// OR run floating: File > Scripts > Run Script File... (no install needed).
// -------------------------------------------------------
// Shows a 5-reel × N-symbol live grid.
// Click any cell to immediately set that reel's landing symbol.
// Reads symbol names from Pair_/Solo_ comps in the open project.
// Reads current state from Master > Reel_Control > "Reel N Symbol" sliders.

(function (thisObj) {

    // ── Layout constants ────────────────────────────────────────────────────
    var REEL_COUNT = 5;
    var COL_W      = 110;  // width of each reel column dropdown
    var ROW_H      = 24;   // height of top/bottom adjacent rows
    var CTR_H      = 30;   // height of center (landing) dropdown row
    var LABEL_W    = 14;   // width of row-indicator strip

    // ── State ───────────────────────────────────────────────────────────────
    var symNames   = [];   // short display names  e.g. "01"
    var symItems   = [];   // full comp names       e.g. "Pair_01"
    var curSel     = [];   // curSel[reel] = 0-based symIdx
    var ddList     = [];   // ddList[reel] = dropdownlist widget
    var topLabels  = [];   // topLabels[reel] = statictext (symbol above landing)
    var botLabels  = [];   // botLabels[reel] = statictext (symbol below landing)
    var _rc        = null; // cached Reel_Control layer
    var _statusTxt = null;
    var _win       = null;
    var gridGroup  = null;

    // ── Build UI ─────────────────────────────────────────────────────────────
    function buildUI(host) {
        var win = (host instanceof Panel)
            ? host
            : new Window("palette", "Reel Symbol Chart", undefined, { resizeable: true });
        _win = win;

        win.orientation   = "column";
        win.alignChildren = ["fill", "top"];
        win.spacing       = 4;
        win.margins       = [8, 8, 8, 8];

        // Toolbar
        var tb = win.add("group");
        tb.orientation = "row"; tb.alignChildren = ["left", "center"]; tb.spacing = 8;
        var ttl = tb.add("statictext", undefined, "REEL SYMBOL CHART");
        ttl.graphics.font = ScriptUI.newFont("dialog", "BOLD", 11);
        var sp = tb.add("group"); sp.alignment = ["fill", "center"];
        var rb = tb.add("button", undefined, "\u21BA Refresh");
        rb.preferredSize = [76, 22];
        rb.helpTip = "Re-read symbols and sliders from AE project";
        rb.onClick = function () { refreshAll(); };

        // Grid container (no extra border panel)
        gridGroup = win.add("group");
        gridGroup.orientation   = "column";
        gridGroup.alignChildren = ["left", "top"];
        gridGroup.spacing       = 2;
        gridGroup.margins       = [0, 0, 0, 0];

        // Status bar
        var stBar = win.add("group");
        stBar.orientation = "row"; stBar.alignChildren = ["fill", "center"];
        var stTxt = stBar.add("statictext", undefined, "Click \u21BA Refresh to connect");
        stTxt.alignment = ["fill", "center"];

        refreshAll(stTxt);

        if (win instanceof Window) { win.center(); win.show(); }
        else { win.layout.layout(true); }
        return win;
    }

    // ── AE project helpers ────────────────────────────────────────────────────
    function getMasterReelControl() {
        var proj = app.project;
        for (var i = 1; i <= proj.items.length; i++) {
            try {
                var it = proj.items[i];
                if (it instanceof CompItem && it.name === "Master") {
                    for (var li = 1; li <= it.layers.length; li++) {
                        if (it.layers[li].name === "Reel_Control") {
                            return it.layers[li];
                        }
                    }
                }
            } catch (e) { /* skip */ }
        }
        return null;
    }

    function collectSymbolNames() {
        // Gather Pair_/Solo_ comps in project panel order (same as script creates them).
        var names = [], full = [];
        var proj = app.project;
        for (var i = 1; i <= proj.items.length; i++) {
            try {
                var it = proj.items[i];
                if (it instanceof CompItem && /^(Pair_|Solo_)/.test(it.name)) {
                    full.push(it.name);
                    // Strip prefix for compact display
                    names.push(it.name.replace(/^(Pair_|Solo_)/, ""));
                }
            } catch (e) { /* skip */ }
        }
        return { names: names, full: full };
    }

    function readSliders(rcLayer) {
        var sel = [];
        for (var r = 1; r <= REEL_COUNT; r++) {
            try {
                var v = rcLayer.effect("Reel " + r + " Symbol")("Slider").value;
                sel.push(Math.round(v));
            } catch (e) {
                sel.push(0);
            }
        }
        return sel;
    }

    function writeSlider(rcLayer, reelIdx, symIdx) {
        try {
            app.beginUndoGroup("Reel Symbol Chart: set reel");
            rcLayer.effect("Reel " + (reelIdx + 1) + " Symbol")("Slider").setValue(symIdx);
            app.endUndoGroup();
            return true;
        } catch (e) {
            try { app.endUndoGroup(); } catch (ex) {}
            return false;
        }
    }


    // ── Grid helpers ──────────────────────────────────────────────────────────
    var cellBtns = [];  // cellBtns[symIdx][reelIdx] = button widget

    function clearGroup(g) { while (g.children.length) g.remove(g.children[0]); }

    function markSelected() {
        var n = symNames.length;
        for (var s = 0; s < n; s++) {
            for (var r = 0; r < REEL_COUNT; r++) {
                if (!cellBtns[s] || !cellBtns[s][r]) continue;
                cellBtns[s][r].text = (curSel[r] === s)
                    ? "\u25CF " + symNames[s]
                    : symNames[s];
            }
        }
    }

    // ── Grid builder (all N symbol rows x 5 reel cols) ────────────────────────
    function buildGrid(rc) {
        clearGroup(gridGroup);
        cellBtns = [];
        var n = symNames.length;
        if (n === 0) return;

        // Column headers
        var hdrRow = gridGroup.add("group");
        hdrRow.orientation = "row"; hdrRow.spacing = 2;
        var corner = hdrRow.add("statictext", undefined, "");
        corner.preferredSize = [LABEL_W * 2, ROW_H];
        for (var r = 0; r < REEL_COUNT; r++) {
            var h = hdrRow.add("statictext", undefined, "Reel " + (r + 1));
            h.preferredSize = [COL_W, ROW_H]; h.justify = "center";
            h.graphics.font = ScriptUI.newFont("dialog", "BOLD", 10);
        }

        // One row per symbol position
        for (var si = 0; si < n; si++) {
            var row = gridGroup.add("group");
            row.orientation = "row"; row.spacing = 2;
            var lbl = row.add("statictext", undefined, String(si + 1));
            lbl.preferredSize = [LABEL_W * 2, ROW_H]; lbl.justify = "right";
            cellBtns[si] = [];
            for (var ri = 0; ri < REEL_COUNT; ri++) {
                var btn = row.add("button", undefined, symNames[si]);
                btn.preferredSize = [COL_W, ROW_H];
                (function (s, r2, layer) {
                    btn.onClick = function () {
                        curSel[r2] = s;
                        var ok = writeSlider(layer, r2, s);
                        markSelected();
                        updateStatus(
                            ok ? "\u2714  Reel " + (r2 + 1) + " \u2192 " + symNames[s]
                               : "\u26A0  Could not write to Reel_Control"
                        );
                    };
                })(si, ri, rc);
                cellBtns[si][ri] = btn;
            }
        }
    }

    function applyAll() { markSelected(); }

    function updateStatus(msg) { if (_statusTxt) _statusTxt.text = msg; }

    function refreshAll(statusArg) {
        if (statusArg) _statusTxt = statusArg;
        var c = collectSymbolNames();
        symNames = c.names; symItems = c.full;
        _rc = getMasterReelControl();

        if (!_rc) {
            updateStatus("\u26A0  Master / Reel_Control not found");
            clearGroup(gridGroup);
            try { _win.layout.layout(true); } catch (e) {}  return;
        }
        if (symNames.length === 0) {
            updateStatus("\u26A0  No Pair_/Solo_ comps \u2014 run main script first");
            clearGroup(gridGroup);
            try { _win.layout.layout(true); } catch (e) {}  return;
        }

        curSel = readSliders(_rc);
        buildGrid(_rc);
        applyAll();
        updateStatus("\u2714  " + symNames.length + " symbols, " + REEL_COUNT + " reels \u2014 connected");
        try { _win.layout.layout(true); } catch (e) {}
    }

    buildUI(thisObj);

})(this);