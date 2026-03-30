// find_font_name.jsx
// Lists PostScript names of all fonts whose family name contains the search term.
// Run via File > Scripts > Run Script File to find the exact name for the font field.

(function () {
    var search = prompt("Enter part of font name to search for:", "blue");
    if (!search) return;
    search = search.toLowerCase();

    var found = [];

    // app.fonts is a FontList — iterate by index (ES3 safe)
    var fontList = app.fonts;
    for (var i = 0; i < fontList.length; i++) {
        var family = fontList[i];
        // Each family entry is itself an array of style variants
        for (var j = 0; j < family.length; j++) {
            var f = family[j];
            var ps  = f.postScriptName;
            var fam = f.family;
            var sty = f.style;
            if (ps.toLowerCase().indexOf(search)  !== -1 ||
                fam.toLowerCase().indexOf(search) !== -1) {
                found.push("PS: " + ps + "   (" + fam + " " + sty + ")");
            }
        }
    }

    if (found.length === 0) {
        alert("No fonts matching \"" + search + "\".\nTry a shorter or different term.");
    } else {
        alert("Found " + found.length + " match(es) — copy the PS: name exactly:\n\n" + found.join("\n"));
    }
}());
