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

    // â”€â”€ Grid helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    function clearGroup(g) { while (g.children.length) g.remove(g.children[0]); }

    function adjName(symIdx, offset) {
        var n = symNames.length;
        if (n === 0) return "";
        return symNames[((symIdx + offset) % n + n) % n];
    }

    function updateAdj(ri) {
        var si = curSel[ri] || 0;
        if (topLabels[ri]) topLabels[ri].text = adjName(si, -1);
        if (botLabels[ri]) botLabels[ri].text = adjName(si,  1);
    }

    // â”€â”€ Grid builder (3 rows x 5 cols) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    function buildGrid(rc) {
        clearGroup(gridGroup);
        ddList = []; topLabels = []; botLabels = [];
        var n = symNames.length;
        if (n === 0) return;

        // Column headers
        var hdrRow = gridGroup.add("group");
        hdrRow.orientation = "row"; hdrRow.spacing = 2;
        var corner = hdrRow.add("statictext", undefined, "");
        corner.preferredSize = [LABEL_W, ROW_H];
        for (var r = 0; r < REEL_COUNT; r++) {
            var h = hdrRow.add("statictext", undefined, "Reel " + (r + 1));
            h.preferredSize = [COL_W, ROW_H]; h.justify = "center";
            h.graphics.font = ScriptUI.newFont("dialog", "BOLD", 10);
        }

        // Top row: symbol above landing (read-only)
        var topRow = gridGroup.add("group");
        topRow.orientation = "row"; topRow.spacing = 2;
        var tLbl = topRow.add("statictext", undefined, "\u25B2");
        tLbl.preferredSize = [LABEL_W, ROW_H];
        for (var r2 = 0; r2 < REEL_COUNT; r2++) {
            var tp = topRow.add("panel", undefined, "");
            tp.preferredSize = [COL_W, ROW_H];
            tp.alignChildren = ["center", "center"]; tp.margins = [2, 2, 2, 2];
            var tl = tp.add("statictext", undefined, "--");
            tl.preferredSize = [COL_W - 8, ROW_H - 6]; tl.justify = "center";
            topLabels[r2] = tl;
        }

        // Center row: landing symbol â€” dropdown per reel
        var ctrRow = gridGroup.add("group");
        ctrRow.orientation = "row"; ctrRow.spacing = 2;
        var cLbl = ctrRow.add("statictext", undefined, "\u25C6");
        cLbl.preferredSize = [LABEL_W, CTR_H];
        cLbl.graphics.font = ScriptUI.newFont("dialog", "BOLD", 11);
        for (var r3 = 0; r3 < REEL_COUNT; r3++) {
            var dd = ctrRow.add("dropdownlist", undefined, symNames);
            dd.preferredSize = [COL_W, CTR_H];
            dd.selection     = Math.max(0, Math.min(curSel[r3] || 0, n - 1));
            (function (ri, layer) {
                dd.onChange = function () {
                    if (!dd.selection) return;
                    var si = dd.selection.index;
                    curSel[ri] = si;
                    updateAdj(ri);
                    var ok = writeSlider(layer, ri, si);
                    updateStatus(
                        ok ? "\u2714  Reel " + (ri + 1) + " \u2192 " + (symItems[si] || si)
                           : "\u26A0  Could not write to Reel_Control"
                    );
                };
            })(r3, rc);
            ddList[r3] = dd;
        }

        // Bottom row: symbol below landing (read-only)
        var botRow = gridGroup.add("group");
        botRow.orientation = "row"; botRow.spacing = 2;
        var bLbl = botRow.add("statictext", undefined, "\u25BC");
        bLbl.preferredSize = [LABEL_W, ROW_H];
        for (var r4 = 0; r4 < REEL_COUNT; r4++) {
            var bp = botRow.add("panel", undefined, "");
            bp.preferredSize = [COL_W, ROW_H];
            bp.alignChildren = ["center", "center"]; bp.margins = [2, 2, 2, 2];
            var bl = bp.add("statictext", undefined, "--");
            bl.preferredSize = [COL_W - 8, ROW_H - 6]; bl.justify = "center";
            botLabels[r4] = bl;
        }
    }

    function applyAll() {
        var n = symNames.length;
        for (var r = 0; r < REEL_COUNT; r++) {
            var si = Math.max(0, Math.min(curSel[r] || 0, n - 1));
            if (ddList[r]) ddList[r].selection = si;
            updateAdj(r);
        }
    }

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