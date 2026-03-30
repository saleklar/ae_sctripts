// Import Precomps to Comp
// Finds all Symbol_ compositions in the project and adds each one
// as a stacked layer in the currently active/open composition.
// Layers are centered at t=0, in Symbol_ ID order (bottom to top).

(function () {

    if (!app.project) {
        alert("No project is open.");
        return;
    }

    // Need an active comp to import into
    var destComp = app.project.activeItem;
    if (!destComp || !(destComp instanceof CompItem)) {
        alert("Please open and activate the destination composition first.");
        return;
    }

    // Collect all Symbol_ comps from the project, sorted by ID number
    var symComps = [];
    for (var i = 1; i <= app.project.items.length; i++) {
        var item;
        try { item = app.project.items[i]; } catch (e) { continue; }
        if (!(item instanceof CompItem)) continue;
        var m = item.name.match(/^Symbol_(\d+)$/);
        if (m) symComps.push({ comp: item, id: parseInt(m[1], 10) });
    }

    if (symComps.length === 0) {
        alert("No Symbol_ compositions found in the project.\nRun make_symbol_precomps.jsx first.");
        return;
    }

    // Sort ascending by numeric ID
    symComps.sort(function (a, b) { return a.id - b.id; });

    var doIt = confirm(
        "Found " + symComps.length + " Symbol_ comp(s).\n\n" +
        "Add them all as layers into:\n\"" + destComp.name + "\"?\n\n" +
        "Layers will be centered at t=0, stacked in ID order."
    );
    if (!doIt) return;

    try {
        app.beginUndoGroup("Import Precomps to Comp");

        var cx = destComp.width  / 2;
        var cy = destComp.height / 2;

        // Add in reverse order so lowest ID ends up on top of the layer stack
        for (var ai = symComps.length - 1; ai >= 0; ai--) {
            var layer = destComp.layers.add(symComps[ai].comp);
            layer.startTime = 0;
            layer.position.setValue([cx, cy]);
        }

        alert("Done! Added " + symComps.length + " Symbol_ layer(s) to \"" + destComp.name + "\".");

    } catch (e) {
        alert("Error: " + e.toString() + (e.line ? "\nLine: " + e.line : ""));
    } finally {
        app.endUndoGroup();
    }

})();
