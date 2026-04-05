(function() {
    var SK_CLAN = /*SK_CLAN*/0;
    var VISIBLE_GIDS = /*VISIBLE_GIDS*/[];
    window.__skXhrLog = [];

    // ── Fetch our community group announcements ──
    var skResp = null;
    try {
        var x = new XMLHttpRequest();
        x.open('GET',
            'https://store.steampowered.com/events/ajaxgetadjacentpartnerevents/'
            + '?clan_accountid=' + SK_CLAN
            + '&count_before=0&count_after=50&lang_list=6_0&only_summaries=false',
            false);
        x.send();
        if (x.status === 200) skResp = JSON.parse(x.responseText);
    } catch(e) {}

    if (!skResp || !skResp.events || skResp.events.length === 0)
        return JSON.stringify({error: 'failed to fetch our events'});

    // ── Filter out invisible/broken announcements ──
    if (VISIBLE_GIDS.length > 0) {
        var vset = {};
        for (var vi = 0; vi < VISIBLE_GIDS.length; vi++) vset[VISIBLE_GIDS[vi]] = true;
        var filtered = [];
        for (var fi = 0; fi < skResp.events.length; fi++) {
            var agid = skResp.events[fi].announcement_body && skResp.events[fi].announcement_body.gid;
            if (agid && vset[String(agid)]) filtered.push(skResp.events[fi]);
        }
        window.__skXhrLog.push('filter:' + skResp.events.length + '->' + filtered.length);
        skResp.events = filtered;
    }

    if (skResp.events.length === 0)
        return JSON.stringify({error: 'no visible events after filter'});

    window.__skOurEvents = skResp.events;
    window.__skOurTitle = skResp.events[0].event_name;

    // ── Pre-fetch Valve frontpage events for sort order ──
    // Steam uses two different require_tags combos for the settings page,
    // each returning a different GID. Pre-request both to build a rank map.
    var screenGids = [];
    var screenSeen = {};
    var tagSets = ['&require_tags=patchnotes', '&require_tags=patchnotes,stablechannel'];
    for (var ti = 0; ti < tagSets.length; ti++) {
        try {
            var xv = new XMLHttpRequest();
            xv.open('GET',
                'https://store.steampowered.com/events/ajaxgetadjacentpartnerevents/'
                + '?appid=1675200&count_before=0&count_after=1&lang_list=6_0&only_summaries=true'
                + tagSets[ti],
                false);
            xv.send();
            if (xv.status === 200) {
                var vr = JSON.parse(xv.responseText);
                if (vr && vr.events) {
                    for (var ve = 0; ve < vr.events.length; ve++) {
                        var vgid = String(vr.events[ve].gid);
                        if (!screenSeen[vgid]) {
                            screenSeen[vgid] = true;
                            screenGids.push({gid: vgid, time: vr.events[ve].rtime32_start_time || 0});
                        }
                    }
                }
            }
        } catch(e) {}
    }
    screenGids.sort(function(a, b) { return b.time - a.time; });
    window.__skValveRank = {};
    for (var si = 0; si < screenGids.length; si++) {
        window.__skValveRank[screenGids[si].gid] = si;
        window.__skXhrLog.push('screen:' + screenGids[si].gid + '->rank' + si + ' t=' + screenGids[si].time);
    }
    window.__skNextFallbackIdx = screenGids.length;

    window.__skTargetGids = {};
    window.__skTargetCount = 0;
    window.__skOrderLocked = false;

    // ── Generation mechanism: invalidate stale hooks ──
    var GEN = Date.now();
    window.__skGen = GEN;

    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    var origGetter_rt = Object.getOwnPropertyDescriptor(
        XMLHttpRequest.prototype, 'responseText');
    var origGetter_r = Object.getOwnPropertyDescriptor(
        XMLHttpRequest.prototype, 'response');

    // ── open override: tag matching requests ──
    XMLHttpRequest.prototype.open = function(method, url) {
        this.__skUrl = String(url);
        this.__skGen = window.__skGen;
        this.__skTarget = (
            this.__skUrl.indexOf('ajaxgetadjacentpartnerevents') !== -1 &&
            this.__skUrl.indexOf('appid=1675200') !== -1
        );
        if (this.__skUrl.indexOf('ajaxgetadjacentpartnerevents') !== -1 ||
            this.__skUrl.indexOf('partnerevent') !== -1) {
            window.__skXhrLog.push('open:' + this.__skUrl.substring(0, 200) + ' target=' + this.__skTarget);
        }
        return origOpen.apply(this, arguments);
    };

    // ── doReplace: core replacement logic ──
    function doReplace(rawText) {
        try {
            var orig = JSON.parse(rawText);
            var ours = window.__skOurEvents;
            if (!orig.events || !ours) return rawText;

            // Collect new target GIDs, assign idx from rank map or fallback
            for (var i = 0; i < orig.events.length && window.__skTargetCount < ours.length; i++) {
                var g = String(orig.events[i].gid);
                if (!window.__skTargetGids[g]) {
                    var rank = window.__skValveRank[g];
                    var idx;
                    if (rank !== undefined && rank < ours.length) {
                        idx = rank;
                    } else {
                        idx = window.__skNextFallbackIdx;
                        window.__skNextFallbackIdx++;
                    }
                    if (idx < ours.length) {
                        window.__skTargetGids[g] = {
                            idx: idx,
                            time: orig.events[i].rtime32_start_time || 0
                        };
                        window.__skTargetCount++;
                    }
                }
            }

            var allGids = [];
            for (var i = 0; i < orig.events.length; i++) {
                allGids.push(String(orig.events[i].gid));
            }
            window.__skXhrLog.push('resp_gids:[' + allGids.join(',') + '] count=' + orig.events.length);

            // Replace matched events
            var replaced = 0;
            for (var i = 0; i < orig.events.length; i++) {
                var gid = String(orig.events[i].gid);
                var entry = window.__skTargetGids[gid];
                if (!entry) continue;

                var o = orig.events[i];
                var s = ours[entry.idx];
                replaced++;
                window.__skXhrLog.push('hit:gid=' + gid + '->ours[' + entry.idx + ']=' + s.event_name);

                var rawBody = (s.announcement_body && s.announcement_body.body) || '';
                var firstLine = rawBody.split(/[\r\n]+/)[0]
                    .replace(/\[\/?\w+[^\]]*\]/g, '').trim();

                o.event_name = firstLine || s.event_name;

                if (o.announcement_body) {
                    o.announcement_body.headline = s.event_name;
                    o.announcement_body.body = '\u200B' + ((s.announcement_body && s.announcement_body.body) || '');
                    if (s.announcement_body && s.announcement_body.posttime)
                        o.announcement_body.posttime = s.announcement_body.posttime;
                    if (s.announcement_body && s.announcement_body.updatetime)
                        o.announcement_body.updatetime = s.announcement_body.updatetime;
                }

                if (s.rtime32_start_time) o.rtime32_start_time = s.rtime32_start_time;
                if (s.rtime32_last_modified) o.rtime32_last_modified = s.rtime32_last_modified;

                if (s.votes_up !== undefined) o.votes_up = s.votes_up;
                if (s.votes_down !== undefined) o.votes_down = s.votes_down;
                if (s.comment_count !== undefined) o.comment_count = s.comment_count;
            }

            if (replaced === 0) return rawText;
            window.__skXhrLog.push('replaced:' + replaced);
            return JSON.stringify(orig);
        } catch(e) {
            window.__skXhrLog.push('err: ' + e.message);
            return rawText;
        }
    }

    // ── send override: install lazy getter on matching XHRs ──
    XMLHttpRequest.prototype.send = function() {
        if (!this.__skTarget || this.__skGen !== GEN) return origSend.apply(this, arguments);

        this.__skTarget = false;

        var self = this;
        var cached = null;
        var cacheReady = false;

        function getResult() {
            if (cacheReady) return cached;
            cacheReady = true;
            var raw = origGetter_rt.get.call(self);
            var result = doReplace(raw);
            cached = (result !== raw) ? result : null;
            return cached;
        }

        Object.defineProperty(self, 'responseText', {
            get: function() {
                if (self.readyState === 4) {
                    var r = getResult();
                    if (r) return r;
                }
                return origGetter_rt.get.call(self);
            },
            configurable: true
        });
        Object.defineProperty(self, 'response', {
            get: function() {
                if (self.readyState === 4) {
                    var r = getResult();
                    if (r) return r;
                }
                return origGetter_r.get.call(self);
            },
            configurable: true
        });
        return origSend.apply(this, arguments);
    };

    return JSON.stringify({
        ok: true,
        events: skResp.events.length,
        title: skResp.events[0].event_name
    });
})()
