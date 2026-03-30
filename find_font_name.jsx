// find_font_name.jsx
// Lists all fonts whose PostScript name or family name contains the search term.
// Run this to find the exact PostScript name to use in import_precomps_to_comp.jsx.

(function () {
    var search = prompt("Enter part of font name to search for:", "blue");
    if (!search) return;
    search = search.toLowerCase();

    var found = [];
    var fonts = app.fonts;
    for (var i = 0; i < fonts.length; i++) {
        var f = fonts[i];
        // Each entry in app.fonts is a FontObject array (one per style)
        for (var j = 0; j < f.length; j++) {
            var postScriptName = f[j].postScriptName;
            var family        = f[j].family;
            if (postScriptName.toLowerCase().indexOf(search) !== -1 ||
                family.toLowerCase().indexOf(search) !== -1) {
                found.push("PostScript: " + postScriptName + "   Family: " + family);
            }
        }
    }

    if (found.length === 0) {
        alert("No fonts found matching \"" + search + "\".\nTry a shorter search term.");
    } else {
        alert("Found " + found.length + " match(es):\n\n" + found.join("\n"));
    }
}());
