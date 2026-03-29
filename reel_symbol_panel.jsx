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
    var CELL_W     = 90;   // px width of each symbol column button
    var CELL_H     = 28;   // px height of each row button
    var LABEL_W    = 52;   // px width of the "Reel N" row-header label
    var HDR_H      = 22;   // px height of the column header row

    // ── State ───────────────────────────────────────────────────────────────
    var symNames  = [];     // display names (Pair_01 → "01", Solo_03 → "03")
    var symItems  = [];     // full CompItem names for matching
    var curSel    = [];     // curSel[reelIdx] = 0-based symIdx
    var btnGrid   = [];     // btnGrid[reelIdx][symIdx] = Button widget
    var gridGroup = null;   // container rebuilt on every Refresh

    // ── Build UI ─────────────────────────────────────────────────────────────
    function buildUI(thisObj) {
        var win = (thisObj instanceof Panel)
            ? thisObj
            : new Window("palette", "Reel Symbol Chart", undefined, { resizeable: true });

        win.orientation    = "column";
        win.alignChildren  = ["fill", "top"];
        win.spacing        = 6;
        win.margins        = [8, 8, 8, 8];

        // ── Top toolbar ──────────────────────────────────────────────────────
        var toolbar = win.add("group");
        toolbar.orientation   = "row";
        toolbar.alignChildren = ["left", "center"];
        toolbar.spacing       = 8;

        var titleLbl = toolbar.add("statictext", undefined, "REEL  SYMBOL  CHART");
        titleLbl.graphics.font = ScriptUI.newFont("dialog", "BOLD", 11);

        var spacer = toolbar.add("group");
        spacer.alignment = ["fill", "center"];

        var refreshBtn = toolbar.add("button", undefined, "Refresh");
        refreshBtn.preferredSize = [70, 22];
        refreshBtn.helpTip = "Re-read symbols and slider values from AE project";
        refreshBtn.onClick = function () { refreshAll(win); };

        // ── Scrollable grid area ─────────────────────────────────────────────
        // A Panel with a border gives the spreadsheet "border" aesthetic.
        var gridBorder = win.add("panel", undefined, "");
        gridBorder.alignChildren = ["left", "top"];
        gridBorder.spacing       = 0;
        gridBorder.margins       = [4, 4, 4, 4];

        gridGroup = gridBorder.add("group");
        gridGroup.orientation   = "column";
        gridGroup.alignChildren = ["left", "top"];
        gridGroup.spacing       = 1;

        // ── Status bar ───────────────────────────────────────────────────────
        var statusBar = win.add("panel", undefined, "");
        statusBar.alignChildren = ["fill", "center"];
        statusBar.margins       = [6, 4, 6, 4];

        var statusTxt = statusBar.add("statictext", undefined, "Click Refresh to connect");
        statusTxt.alignment = ["fill", "center"];

        // Wire refresh to status label
        refreshBtn.statusTxt = statusTxt;

        // Initial population
        refreshAll(win, statusTxt);

        if (win instanceof Window) {
            win.center();
            win.show();
        } else {
            win.layout.layout(true);
        }
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

    // ── Grid builder ──────────────────────────────────────────────────────────
    function clearGroup(grp) {
        while (grp.children.length > 0) {
            grp.remove(grp.children[0]);
        }
    }

    function buildGrid(rcLayer) {
        clearGroup(gridGroup);
        btnGrid = [];
        var nSym = symNames.length;
        if (nSym === 0) return;

        // ── Column header row ────────────────────────────────────────────────
        var hdrRow = gridGroup.add("group");
        hdrRow.orientation   = "row";
        hdrRow.alignChildren = ["center", "center"];
        hdrRow.spacing       = 1;

        // corner cell (blank, aligns with reel labels)
        var cornerCell = hdrRow.add("panel", undefined, "");
        cornerCell.preferredSize = [LABEL_W, HDR_H];

        for (var si = 0; si < nSym; si++) {
            var hdrCell = hdrRow.add("panel", undefined, "");
            hdrCell.preferredSize    = [CELL_W, HDR_H];
            hdrCell.alignChildren    = ["center", "center"];
            hdrCell.margins          = [2, 2, 2, 2];
            var hdrTxt = hdrCell.add("statictext", undefined, symNames[si]);
            hdrTxt.graphics.font     = ScriptUI.newFont("dialog", "BOLD", 10);
            hdrTxt.alignment         = ["center", "center"];
            hdrTxt.helpTip           = symItems[si];
        }

        // ── One row per reel ─────────────────────────────────────────────────
        for (var ri = 0; ri < REEL_COUNT; ri++) {
            var row = gridGroup.add("group");
            row.orientation   = "row";
            row.alignChildren = ["center", "center"];
            row.spacing       = 1;

            // Row label (Reel N)
            var lblCell = row.add("panel", undefined, "");
            lblCell.preferredSize = [LABEL_W, CELL_H];
            lblCell.alignChildren = ["center", "center"];
            lblCell.margins       = [2, 2, 2, 2];
            var lbl = lblCell.add("statictext", undefined, "Reel " + (ri + 1));
            lbl.graphics.font     = ScriptUI.newFont("dialog", "BOLD", 10);
            lbl.alignment         = ["center", "center"];

            btnGrid[ri] = [];

            for (var si2 = 0; si2 < nSym; si2++) {
                var btn = row.add("button", undefined, "");
                btn.preferredSize = [CELL_W, CELL_H];
                // Capture loop vars
                (function (r, s, layer) {
                    btn.onClick = function () {
                        setSelected(r, s);
                        var ok = writeSlider(layer, r, s);
                        updateStatus(
                            ok
                                ? "\u2714  Reel " + (r + 1) + "  \u2192  " + symItems[s]
                                : "\u26A0  Could not write to Reel_Control"
                        );
                    };
                })(ri, si2, rcLayer);
                btnGrid[ri][si2] = btn;
            }
        }
    }

    function setSelected(reelIdx, symIdx) {
        curSel[reelIdx] = symIdx;
        var nSym = symNames.length;
        for (var s = 0; s < nSym; s++) {
            if (!btnGrid[reelIdx] || !btnGrid[reelIdx][s]) continue;
            // ✔ prefix on selected cell, clear others
            btnGrid[reelIdx][s].text = (s === symIdx)
                ? "\u2714 " + symNames[s]
                : symNames[s];
        }
    }

    function applyAllSelections() {
        for (var ri = 0; ri < REEL_COUNT; ri++) {
            var sel = Math.max(0, Math.min(curSel[ri] || 0, symNames.length - 1));
            setSelected(ri, sel);
        }
    }

    // ── Status text helper ────────────────────────────────────────────────────
    var _statusTxt = null;
    function updateStatus(msg) {
        if (_statusTxt) _statusTxt.text = msg;
    }

    // ── Full refresh ──────────────────────────────────────────────────────────
    function refreshAll(win, statusTxtArg) {
        if (statusTxtArg) _statusTxt = statusTxtArg;

        var collected = collectSymbolNames();
        symNames = collected.names;
        symItems = collected.full;

        var rc = getMasterReelControl();

        if (!rc) {
            updateStatus("\u26A0  Master comp or Reel_Control null not found");
            clearGroup(gridGroup);
            try { win.layout.layout(true); } catch (e) {}
            return;
        }

        if (symNames.length === 0) {
            updateStatus("\u26A0  No Pair_ / Solo_ comps found — run main script first");
            clearGroup(gridGroup);
            try { win.layout.layout(true); } catch (e) {}
            return;
        }

        curSel = readSliders(rc);
        buildGrid(rc);
        applyAllSelections();

        updateStatus(
            "\u2714  " + symNames.length + " symbol" + (symNames.length !== 1 ? "s" : "") +
            "  \u00D7  " + REEL_COUNT + " reels  \u2014  connected"
        );

        try { win.layout.layout(true); } catch (e) {}
    }

    // ── Launch ────────────────────────────────────────────────────────────────
    buildUI(thisObj);

})(this);
