(function() {
    if (window.__skObserver) window.__skObserver.disconnect();

    var VERSION = '1.1.0';
    var SK_MARKER = '\u200B';
    var patchedCount = 0;

    function patchDOM() {
        var tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (tw.nextNode()) {
            var txt = tw.currentNode.textContent;
            if (!txt || txt.charCodeAt(0) !== 8203) continue;

            var el = tw.currentNode.parentElement;
            if (!el) continue;

            // Skip settings page layout to avoid hiding unrelated elements
            var inSettingsLayout = false;
            for (var chk = el; chk; chk = chk.parentElement) {
                if (chk.className && chk.className.indexOf('DialogControlsSection') !== -1) {
                    inSettingsLayout = true;
                    break;
                }
            }
            if (inSettingsLayout) continue;

            // Walk up to find the body content div whose parent has 3+ children
            for (var d = 0; d < 5 && el; d++) {
                var parent = el.parentElement;
                if (!parent || parent.children.length < 3) { el = parent; continue; }
                var lastChild = parent.children[parent.children.length - 1];
                if (lastChild !== el && lastChild.tagName === 'DIV' && lastChild.children.length <= 3) {
                    if (lastChild.style.display !== 'none') {
                        lastChild.style.display = 'none';
                        patchedCount++;
                    }
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
    var timerCount = 0;
    window.__skPatchTimer = setInterval(function() {
        patchDOM();
        timerCount++;
        if (timerCount >= 15) clearInterval(window.__skPatchTimer);
    }, 2000);

    return JSON.stringify({marker: SK_MARKER, version: VERSION, patched: patchedCount});
})()
