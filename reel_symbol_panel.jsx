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
    var _keyMode   = false; // when true: setValueAtTime instead of setValue
    var _spinIdx   = 0;     // 0-based index into spin_start markers
    var _spinLbl   = null;  // statictext showing current spin

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

        // Toolbar row 1: title + refresh
        var tb = win.add("group");
        tb.orientation = "row"; tb.alignChildren = ["left", "center"]; tb.spacing = 8;
        var ttl = tb.add("statictext", undefined, "REEL SYMBOL CHART");
        ttl.graphics.font = ScriptUI.newFont("dialog", "BOLD", 11);
        var sp = tb.add("group"); sp.alignment = ["fill", "center"];
        var rb = tb.add("button", undefined, "\u21BA Refresh");
        rb.preferredSize = [76, 22];
        rb.helpTip = "Re-read symbols and sliders from AE project";
        rb.onClick = function () { refreshAll(); };

        // Toolbar row 2: spin navigator + keyframe mode
        var tb2 = win.add("group");
        tb2.orientation = "row"; tb2.alignChildren = ["center", "center"]; tb2.spacing = 4;

        var btnPrev = tb2.add("button", undefined, "\u25C0");
        btnPrev.preferredSize = [28, 22];
        btnPrev.helpTip = "Previous spin";
        _spinLbl = tb2.add("statictext", undefined, "Spin 1");
        _spinLbl.preferredSize = [52, 22]; _spinLbl.justify = "center";
        var btnNext = tb2.add("button", undefined, "\u25B6");
        btnNext.preferredSize = [28, 22];
        btnNext.helpTip = "Next spin";

        var sep2 = tb2.add("group"); sep2.alignment = ["fill", "center"];

        var kmChk = tb2.add("checkbox", undefined, "\uD83D\uDD11 Key");
        kmChk.helpTip = "When checked: dropdown changes write a keyframe at the current Master comp time instead of a static value";
        kmChk.value = false;
        kmChk.onClick = function () {
            _keyMode = kmChk.value;
            updateStatus(_keyMode
                ? "\u23F1 Keyframe mode ON \u2014 changes key at current comp time"
                : "\u2714 Static mode \u2014 changes overwrite slider value");
        };

        var btnSetAll = tb2.add("button", undefined, "Set All");
        btnSetAll.preferredSize = [56, 22];
        btnSetAll.helpTip = "Key all 5 reels at current comp time (keyframe mode) or set all statically";
        btnSetAll.onClick = function () {
            var freshRc = getMasterReelControl();
            if (!freshRc) { updateStatus("\u26A0 Not connected"); return; }
            _rc = freshRc;
            var lastErr = null;
            for (var r = 0; r < REEL_COUNT; r++) {
                var res = writeSlider(_rc, r, curSel[r] || 0);
                if (res !== true) lastErr = res;
            }
            if (lastErr) { updateStatus("\u26A0 " + lastErr); return; }
            var t = _keyMode
                ? " at " + _fmtTime(_rc.containingComp.time, _rc.containingComp.frameRate)
                : "";
            updateStatus("\u2714 All reels set" + t);
        };

        btnPrev.onClick = function () { _navSpin(-1); };
        btnNext.onClick = function () { _navSpin( 1); };

        // Toolbar row 3: place comp markers at current playhead
        var tb3 = win.add("group");
        tb3.orientation = "row"; tb3.alignChildren = ["center", "center"]; tb3.spacing = 4;

        var markerDefs = [
            { label: "\u25B6 Spin",    comment: "spin_start", tip: "Place spin_start marker at current time in Master" },
            { label: "\u2605 Win",     comment: "win_play",   tip: "Place win_play marker at current time in Master"  },
            { label: "\u25B6 Spin 2",  comment: "spin_start", tip: "Place another spin_start marker at current time in Master" },
            { label: "\uD83D\uDCA5 Pop", comment: "pop",      tip: "Place pop marker at current time in Master"      }
        ];
        for (var mi2 = 0; mi2 < markerDefs.length; mi2++) {
            (function (def) {
                var btn = tb3.add("button", undefined, def.label);
                btn.preferredSize = [72, 22];
                btn.helpTip = def.tip;
                btn.onClick = function () { _placeMasterMarker(def.comment); };
            })(markerDefs[mi2]);
        }

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
            // Always fetch a fresh handle — cached refs go stale after undo/comp changes
            var freshRc = getMasterReelControl();
            if (!freshRc) return "Reel_Control layer not found";
            _rc = freshRc;  // keep cache up to date
            app.beginUndoGroup("Reel Symbol Chart: set reel");
            var prop = freshRc.effect("Reel " + (reelIdx + 1) + " Symbol")("Slider");
            if (_keyMode) {
                var t = freshRc.containingComp.time;
                prop.setValueAtTime(t, symIdx);
                // Make it a hold keyframe so the value jumps instantly (no interpolation)
                var ki = prop.nearestKeyIndex(t);
                prop.setInterpolationTypeAtKey(ki, KeyframeInterpolationType.HOLD);
            } else {
                prop.setValue(symIdx);
            }
            app.endUndoGroup();
            return true;
        } catch (e) {
            try { app.endUndoGroup(); } catch (ex) {}
            return e.toString();
        }
    }

    // ── Marker placement helper ───────────────────────────────────────────────
    function _placeMasterMarker(comment) {
        var masterComp = null;
        try {
            for (var i = 1; i <= app.project.items.length; i++) {
                var it = app.project.items[i];
                if (it instanceof CompItem && it.name === "Master") { masterComp = it; break; }
            }
        } catch (e) {}
        if (!masterComp) { updateStatus("\u26A0 Master comp not found"); return; }
        try {
            app.beginUndoGroup("Place " + comment + " marker");
            var t = masterComp.time;
            masterComp.markerProperty.setValueAtTime(t, new MarkerValue(comment));
            app.endUndoGroup();
            updateStatus("\u2714 [" + comment + "] \u2192 " + _fmtTime(t, masterComp.frameRate));
        } catch (e) {
            try { app.endUndoGroup(); } catch (ex) {}
            updateStatus("\u26A0 " + e.toString());
        }
    }

    // ── Spin navigator helpers ────────────────────────────────────────────────
    function _getSpinTimes() {
        var times = [];
        var masterComp = null;
        for (var i = 1; i <= app.project.items.length; i++) {
            try {
                var it = app.project.items[i];
                if (it instanceof CompItem && it.name === "Master") { masterComp = it; break; }
            } catch (e) {}
        }
        if (!masterComp) return times;

        // Try both access patterns AE versions use
        var mm = null;
        try { mm = masterComp.markerProperty; } catch (e) {}
        if (!mm) { try { mm = masterComp.property("Marker"); } catch (e) {} }
        if (!mm) return times;

        var nk = 0;
        try { nk = mm.numKeys; } catch (e) {}
        for (var mi = 1; mi <= nk; mi++) {
            try {
                var kt = mm.keyTime(mi);
                // keyValue() returns the MarkerValue; .key().value also works in newer AE
                var mv = null;
                try { mv = mm.keyValue(mi); } catch (e) { mv = mm.key(mi).value; }
                var cmt = mv ? mv.comment : "";
                if (cmt === "spin_start") times.push(kt);
            } catch (e) {}
        }
        times.sort(function (a, b) { return a - b; });
        return times;
    }

    function _fmtTime(t, fps) {
        var f = Math.round(t * fps);
        var s = Math.floor(f / fps); f = f % fps;
        var m = Math.floor(s / 60); s = s % 60;
        return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s + ":" + (f < 10 ? "0" : "") + f;
    }

    function _navSpin(delta) {
        var times = _getSpinTimes();
        if (times.length === 0) { updateStatus("\u26A0 No spin_start markers in Master"); return; }
        _spinIdx = (_spinIdx + delta + times.length) % times.length;
        if (_spinLbl) _spinLbl.text = "Spin " + (_spinIdx + 1) + "/" + times.length;
        // Jump playhead to spin_start time in Master
        try {
            for (var i = 1; i <= app.project.items.length; i++) {
                var it = app.project.items[i];
                if (it instanceof CompItem && it.name === "Master") {
                    it.openInViewer();
                    app.activeViewer.setActive();
                    it.time = times[_spinIdx];
                    break;
                }
            }
        } catch (e) {}
        updateStatus("\u23F1 Spin " + (_spinIdx + 1) + " @ " + _fmtTime(times[_spinIdx], 30));
    }


    // ── Grid helpers ──────────────────────────────────────────────────────────
    // rowDDs[rowOffset][reelIdx]  offset: 0=top(above), 1=center(landing), 2=bottom(below)
    var rowDDs  = [[], [], []];
    var _syncing = false;  // re-entrancy guard

    function clearGroup(g) { while (g.children.length) g.remove(g.children[0]); }

    // Sync all 3 dropdowns for reel ri to reflect curSel[ri]
    function syncReel(ri) {
        var n = symNames.length;
        if (n === 0) return;
        var landing = ((curSel[ri] || 0) % n + n) % n;
        var above   = (landing - 1 + n) % n;
        var below   = (landing + 1) % n;
        if (rowDDs[0][ri]) rowDDs[0][ri].selection = above;
        if (rowDDs[1][ri]) rowDDs[1][ri].selection = landing;
        if (rowDDs[2][ri]) rowDDs[2][ri].selection = below;
    }

    function syncAll() {
        for (var r = 0; r < REEL_COUNT; r++) syncReel(r);
    }

    // ── Grid builder (3 rows x 5 cols, all dropdowns) ─────────────────────────
    function buildGrid(rc) {
        clearGroup(gridGroup);
        rowDDs = [[], [], []];
        var n = symNames.length;
        if (n === 0) return;

        var ROW_DEFS = [
            { label: "\u25B2", offset: -1 },   // above landing
            { label: "\u25C6", offset:  0 },   // landing (center)
            { label: "\u25BC", offset:  1 }    // below landing
        ];

        // Column headers
        var hdrRow = gridGroup.add("group");
        hdrRow.orientation = "row"; hdrRow.spacing = 4;
        var corner = hdrRow.add("statictext", undefined, "");
        corner.preferredSize = [LABEL_W * 2, ROW_H];
        for (var c = 0; c < REEL_COUNT; c++) {
            var h = hdrRow.add("statictext", undefined, "Reel " + (c + 1));
            h.preferredSize = [COL_W, ROW_H]; h.justify = "center";
            h.graphics.font = ScriptUI.newFont("dialog", "BOLD", 10);
        }

        // 3 rows
        for (var rowIdx = 0; rowIdx < 3; rowIdx++) {
            var def  = ROW_DEFS[rowIdx];
            var rowH = (rowIdx === 1) ? CTR_H : ROW_H;
            var grp  = gridGroup.add("group");
            grp.orientation = "row"; grp.spacing = 4;
            var lbl = grp.add("statictext", undefined, def.label);
            lbl.preferredSize = [LABEL_W * 2, rowH];
            if (rowIdx === 1) lbl.graphics.font = ScriptUI.newFont("dialog", "BOLD", 12);

            for (var ri = 0; ri < REEL_COUNT; ri++) {
                var dd = grp.add("dropdownlist", undefined, symNames);
                dd.preferredSize = [COL_W, rowH];
                // Top (▲) and bottom (▼) rows are display-only — they show the
                // symbols adjacent to the landing; only the center row (◆) is interactive.
                if (rowIdx !== 1) {
                    dd.enabled = false;
                } else {
                    (function (r2, thisDd) {
                        thisDd.onChange = function () {
                            if (_syncing || !thisDd.selection) return;
                            var newLanding = thisDd.selection.index;
                            curSel[r2] = newLanding;
                            _syncing = true;
                            try { syncReel(r2); } finally { _syncing = false; }
                            var ok = writeSlider(_rc, r2, newLanding);
                            updateStatus(
                                ok === true
                                    ? "\u2714  Reel " + (r2 + 1) + " \u2192 " + symNames[newLanding]
                                    : "\u26A0  " + (ok || "Reel_Control not found")
                            );
                        };
                    })(ri, dd);
                }
                rowDDs[rowIdx][ri] = dd;
            }
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
        syncAll();
        updateStatus("\u2714  " + symNames.length + " symbols, " + REEL_COUNT + " reels \u2014 connected");
        try { _win.layout.layout(true); } catch (e) {}
    }

    buildUI(thisObj);

})(this);