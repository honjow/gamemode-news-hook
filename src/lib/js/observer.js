(function() {
    if (window.__skObserver) window.__skObserver.disconnect();

    var SK_MARKER = '\u200B';

    function patchDOM() {
        var voteAreas = document.querySelectorAll('div.mKmrOjr9bGjKAolgp9NoD');
        for (var i = 0; i < voteAreas.length; i++) {
            var va = voteAreas[i];
            var card = va.closest('[class*="PartnerEvent"]')
                    || va.closest('[class*="EventSummary"]')
                    || va.parentElement && va.parentElement.parentElement;
            if (card) {
                var html = (card.innerHTML || '');
                va.style.display = (html.indexOf(SK_MARKER) !== -1) ? 'none' : '';
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
