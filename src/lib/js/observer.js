(function() {
    if (window.__skObserver) window.__skObserver.disconnect();

    var SK_MARKER = '\u200B';

    function patchDOM() {
        // Structural detection (no class name dependency)
        // In the expanded card view, each card has: IMG, metadata, body(with marker), voteArea
        // The vote area is the last sibling of the body content div containing the marker
        var tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (tw.nextNode()) {
            var txt = tw.currentNode.textContent;
            if (!txt || txt.charCodeAt(0) !== 8203) continue;

            // Walk up to find the body content div (the one whose parent has 3-5 children)
            // Skip if inside settings page layout (DialogControlsSection)
            var el = tw.currentNode.parentElement;
            var inSettingsLayout = false;
            for (var chk = el; chk; chk = chk.parentElement) {
                if (chk.className && chk.className.indexOf('DialogControlsSection') !== -1) {
                    inSettingsLayout = true;
                    break;
                }
            }
            if (inSettingsLayout) continue;

            for (var d = 0; d < 5 && el; d++) {
                var parent = el.parentElement;
                if (!parent || parent.children.length < 3) { el = parent; continue; }
                var lastChild = parent.children[parent.children.length - 1];
                if (lastChild !== el && lastChild.tagName === 'DIV' && lastChild.children.length <= 3) {
                    lastChild.style.display = 'none';
                    break;
                }
                el = parent;
            }
        }
    }

    patchDOM();

    window.__skObserver = new MutationObserver(function() {
        patchDOM();
    });
    window.__skObserver.observe(document.body, { childList: true, subtree: true });

    if (window.__skPatchTimer) clearInterval(window.__skPatchTimer);
    var patchCount = 0;
    window.__skPatchTimer = setInterval(function() {
        patchDOM();
        patchCount++;
        if (patchCount >= 15) clearInterval(window.__skPatchTimer);
    }, 2000);

    return JSON.stringify({marker: SK_MARKER});
})()
