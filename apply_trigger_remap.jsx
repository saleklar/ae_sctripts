// Apply Trigger Remap
// Select the Symbol_Sequence layer (or any layer whose source is a comp
// with named clip markers) in the active composition, then run this script.
//
// It enables Time Remap on that layer and applies an expression that:
//   - Reads time markers on the MAIN comp (e.g. "4_win", "2_stat")
//   - On each marker, jumps to the matching clip inside Symbol_Sequence
//   - Plays the clip in real time
//   - Holds the last frame after the clip ends, until the next marker fires

(function () {

    if (!app.project) { alert("No project open."); return; }

    var mainComp = app.project.activeItem;
    if (!mainComp || !(mainComp instanceof CompItem)) {
        alert("Please activate the composition that contains the Symbol_Sequence layer.");
        return;
    }

    // Find the selected layer
    var sel = mainComp.selectedLayers;
    if (sel.length === 0) {
        alert("Please select the Symbol_Sequence layer first.");
        return;
    }

    var seqLayer = sel[0];
    if (!(seqLayer.source instanceof CompItem)) {
        alert("Selected layer is not a composition layer.\nSelect the Symbol_Sequence layer.");
        return;
    }

    var seqComp = seqLayer.source;

    // Count how many named markers the source comp has — used as sanity check
    var numMarkers = seqComp.markerProperty.numKeys;
    if (numMarkers === 0) {
        alert(
            "\"" + seqComp.name + "\" has no markers.\n\n" +
            "Run import_precomps_to_comp.jsx first so clip markers are created."
        );
        return;
    }

    try {
        app.beginUndoGroup("Apply Trigger Remap");

        // Enable Time Remap — this creates keyframes at in/out points
        seqLayer.timeRemapEnabled = true;

        // The expression runs on the Time Remap property of seqLayer in mainComp.
        // thisComp  = main comp (has trigger markers like "4_win")
        // thisLayer = the Symbol_Sequence layer
        // thisLayer.source = Symbol_Sequence comp (has clip-start markers)
        var expr =
            // --- Find the most recently passed trigger marker in the main comp ---
            'var trigName = "";' +
            'var trigTime = -1;' +
            'var mm = thisComp.marker;' +
            'for (var mi = 1; mi <= mm.numKeys; mi++) {' +
            '  var mt = mm.key(mi).time;' +
            '  if (mt <= time && mt > trigTime) { trigTime = mt; trigName = mm.key(mi).comment; }' +
            '}' +

            // --- No trigger marker has passed yet: hold frame 0 ---
            'if (trigName === "" || trigTime < 0) {' +
            '  0;' +
            '} else {' +

            // --- Look up clip start in Symbol_Sequence markers ---
            '  var sm = thisLayer.source.marker;' +
            '  var clipStart = -1;' +
            '  var clipEnd   = thisLayer.source.duration;' +
            '  for (var si = 1; si <= sm.numKeys; si++) {' +
            '    if (sm.key(si).comment === trigName) {' +
            '      clipStart = sm.key(si).time;' +
            '      clipEnd   = (si < sm.numKeys) ? sm.key(si + 1).time : thisLayer.source.duration;' +
            '      break;' +
            '    }' +
            '  }' +

            // --- Marker name not found: hold frame 0 ---
            '  if (clipStart < 0) {' +
            '    0;' +
            '  } else {' +
            '    var elapsed = time - trigTime;' +
            '    var fd      = thisComp.frameDuration;' +
            // Play through clip duration, then hold 1 frame before end (avoids out-point gap)
            '    Math.min(clipStart + elapsed, clipEnd - fd);' +
            '  }' +
            '}';

        seqLayer.property("Time Remap").expression = expr;

        alert(
            "Done!\n\n" +
            "Time Remap expression applied to \"" + seqLayer.name + "\".\n\n" +
            "Available trigger names (" + numMarkers + " clips):\n" +
            (function () {
                var names = [];
                for (var mi = 1; mi <= numMarkers; mi++)
                    names.push("  " + seqComp.markerProperty.key(mi).comment);
                return names.join("\n");
            })() + "\n\n" +
            "Add these as time marker comments in \"" + mainComp.name + "\" to trigger each clip."
        );

    } catch (e) {
        alert("Error: " + e.toString() + (e.line ? "\nLine: " + e.line : ""));
    } finally {
        app.endUndoGroup();
    }

})();
