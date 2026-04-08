(function() {
    var SK_CLAN = /*SK_CLAN*/0;
    var HIDDEN_GIDS = /*HIDDEN_GIDS*/[];
    var TARGET_APPID = /*TARGET_APPID*/1675200;
    var LANG_LIST = /*LANG_LIST*/'6_0';
    var REFRESH_DEBOUNCE = /*REFRESH_DEBOUNCE*/10000;
    var CHANNEL_PREFIX = /*CHANNEL_PREFIX*/{};
    var CURRENT_BRANCH = /*CURRENT_BRANCH*/'';
    var REPO_MIRRORS = /*REPO_MIRRORS*/[];
    var DETECTED_LANG = /*DETECTED_LANG*/'';
    var PREFETCHED_EVENTS = /*PREFETCHED_EVENTS*/null;
    var VERSION = '1.2.0';
    window.__skXhrLog = [];
    window.__skVersion = VERSION;

    var TARGET_APPID_STR = 'appid=' + TARGET_APPID;

    function parseRepoJSON(raw) {
        if (!raw || raw.length === 0) return null;
        var channelOk = [];
        for (var i = 0; i < raw.length; i++) {
            var entry = raw[i];
            if (entry.channel && CURRENT_BRANCH && entry.channel !== CURRENT_BRANCH) continue;
            channelOk.push(entry);
        }
        var filtered = [];
        var englishFallback = [];
        for (var i = 0; i < channelOk.length; i++) {
            var entry = channelOk[i];
            if (!entry.lang) { filtered.push(entry); englishFallback.push(entry); continue; }
            if (DETECTED_LANG && entry.lang === DETECTED_LANG) filtered.push(entry);
            if (entry.lang === 'english') englishFallback.push(entry);
        }
        if (filtered.length === 0) filtered = englishFallback;
        window.__skXhrLog.push('repo:' + raw.length + '->' + filtered.length
            + ' (lang=' + DETECTED_LANG + ',branch=' + CURRENT_BRANCH + ')');

        var now = Math.floor(Date.now() / 1000);
        var events = [];
        for (var j = 0; j < filtered.length; j++) {
            var e = filtered[j];
            var gid = String(1000000000 + j);
            var ts = e.timestamp || (now - j * 3600);
            events.push({
                gid: gid,
                event_name: e.title || '',
                event_type: 12,
                appid: TARGET_APPID,
                rtime32_start_time: ts,
                rtime32_last_modified: ts,
                votes_up: 0, votes_down: 0, comment_count: 0,
                announcement_body: {
                    gid: gid,
                    headline: e.title || '',
                    body: e.bbcode_body || e.body || '',
                    posttime: ts,
                    updatetime: ts
                }
            });
        }
        return events.length > 0 ? events : null;
    }

    function refreshRepoAsync() {
        var mirrorIdx = 0;
        function tryNext() {
            if (mirrorIdx >= REPO_MIRRORS.length) return;
            var x = new XMLHttpRequest();
            x.open('GET', REPO_MIRRORS[mirrorIdx], true);
            x.timeout = 10000;
            x.onload = function() {
                if (x.status === 200) {
                    try {
                        var events = parseRepoJSON(JSON.parse(x.responseText));
                        if (events && events.length > 0) {
                            window.__skOurEvents = events;
                            window.__skOurTitle = events[0].event_name;
                            window.__skTargetGids = {};
                            window.__skTargetCount = 0;
                            window.__skNextFallbackIdx = Object.keys(window.__skValveRank || {}).length;
                            window.__skXhrLog.push('repo-refresh:' + events.length + ' events');
                        }
                    } catch(e) {}
                } else {
                    mirrorIdx++;
                    tryNext();
                }
            };
            x.onerror = x.ontimeout = function() { mirrorIdx++; tryNext(); };
            x.send();
        }
        tryNext();
    }

    function fetchSteamEvents(applyFilter) {
        var resp = null;
        try {
            var x = new XMLHttpRequest();
            x.open('GET',
                'https://store.steampowered.com/events/ajaxgetadjacentpartnerevents/'
                + '?clan_accountid=' + SK_CLAN
                + '&count_before=0&count_after=50&lang_list=' + LANG_LIST
                + '&only_summaries=false',
                false);
            x.send();
            if (x.status === 200) resp = JSON.parse(x.responseText);
        } catch(e) {}
        if (!resp || !resp.events || resp.events.length === 0) return null;

        if (applyFilter && HIDDEN_GIDS.length > 0) {
            var hset = {};
            for (var hi = 0; hi < HIDDEN_GIDS.length; hi++) hset[HIDDEN_GIDS[hi]] = true;
            var filtered = [];
            for (var fi = 0; fi < resp.events.length; fi++) {
                var agid = resp.events[fi].announcement_body && resp.events[fi].announcement_body.gid;
                if (!agid || !hset[String(agid)]) filtered.push(resp.events[fi]);
            }
            window.__skXhrLog.push('blacklist:' + resp.events.length + '->' + filtered.length);
            if (filtered.length > 0) resp.events = filtered;
        }

        var prefixKeys = Object.keys(CHANNEL_PREFIX);
        if (prefixKeys.length > 0 && CURRENT_BRANCH) {
            var channelFiltered = [];
            for (var ci = 0; ci < resp.events.length; ci++) {
                var ev = resp.events[ci];
                var name = ev.event_name || '';
                var match = name.match(/^\[([A-Za-z])\]\s*/);
                if (match) {
                    var pkey = match[1].toUpperCase();
                    if (CHANNEL_PREFIX[pkey] && CHANNEL_PREFIX[pkey] !== CURRENT_BRANCH) continue;
                    ev.event_name = name.substring(match[0].length);
                }
                channelFiltered.push(ev);
            }
            window.__skXhrLog.push('channel:' + resp.events.length + '->' + channelFiltered.length + ' (branch=' + CURRENT_BRANCH + ')');
            if (channelFiltered.length > 0) resp.events = channelFiltered;
        }

        return resp.events;
    }

    function fetchOurEvents(applyFilter) {
        if (PREFETCHED_EVENTS) return parseRepoJSON(PREFETCHED_EVENTS);
        return fetchSteamEvents(applyFilter);
    }

    function refreshEvents() {
        var now = Date.now();
        if (window.__skLastRefresh && (now - window.__skLastRefresh) < REFRESH_DEBOUNCE) return;
        window.__skLastRefresh = now;
        if (REPO_MIRRORS.length > 0) { refreshRepoAsync(); return; }
        var events = fetchOurEvents(true);
        if (events && events.length > 0) {
            window.__skOurEvents = events;
            window.__skOurTitle = events[0].event_name;
            window.__skTargetGids = {};
            window.__skTargetCount = 0;
            window.__skNextFallbackIdx = Object.keys(window.__skValveRank || {}).length;
            window.__skXhrLog.push('refresh:' + events.length + ' events');
        }
    }

    // Initial fetch with filter / 带黑名单过滤的首次拉取
    var initEvents = fetchOurEvents(true);
    if (!initEvents || initEvents.length === 0)
        return JSON.stringify({error: 'failed to fetch our events'});

    window.__skOurEvents = initEvents;
    window.__skOurTitle = initEvents[0].event_name;
    window.__skLastRefresh = Date.now();

    // Pre-fetch Valve frontpage events for sort order / 预取 Valve 前台活动以确定排序
    var screenGids = [];
    var screenSeen = {};
    var tagSets = ['&require_tags=patchnotes', '&require_tags=patchnotes,stablechannel'];
    for (var ti = 0; ti < tagSets.length; ti++) {
        try {
            var xv = new XMLHttpRequest();
            xv.open('GET',
                'https://store.steampowered.com/events/ajaxgetadjacentpartnerevents/'
                + '?appid=' + TARGET_APPID
                + '&count_before=0&count_after=1&lang_list=' + LANG_LIST
                + '&only_summaries=true'
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

    // Generation mechanism: invalidate stale hooks / 代际标记：使旧钩子失效，避免重复叠加
    var GEN = Date.now();
    window.__skGen = GEN;

    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    var origGetter_rt = Object.getOwnPropertyDescriptor(
        XMLHttpRequest.prototype, 'responseText');
    var origGetter_r = Object.getOwnPropertyDescriptor(
        XMLHttpRequest.prototype, 'response');

    // open override: tag matching requests / 重写 open：标记需拦截的请求
    XMLHttpRequest.prototype.open = function(method, url) {
        this.__skUrl = String(url);
        this.__skGen = window.__skGen;
        this.__skTarget = (
            this.__skUrl.indexOf('ajaxgetadjacentpartnerevents') !== -1 &&
            this.__skUrl.indexOf(TARGET_APPID_STR) !== -1
        );
        if (this.__skUrl.indexOf('ajaxgetadjacentpartnerevents') !== -1 ||
            this.__skUrl.indexOf('partnerevent') !== -1) {
            window.__skXhrLog.push('open:' + this.__skUrl.substring(0, 200) + ' target=' + this.__skTarget);
        }
        return origOpen.apply(this, arguments);
    };

    // doReplace: core replacement logic / 核心：将响应中的目标活动替换为社区公告
    function doReplace(rawText) {
        try {
            var orig = JSON.parse(rawText);
            var ours = window.__skOurEvents;
            if (!orig.events || !ours) return rawText;

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

            var replaced = 0;
            for (var i = 0; i < orig.events.length; i++) {
                var gid = String(orig.events[i].gid);
                var entry = window.__skTargetGids[gid];
                if (!entry) continue;

                var o = orig.events[i];
                var s = ours[entry.idx];
                replaced++;
                window.__skXhrLog.push('hit:gid=' + gid + '->ours[' + entry.idx + ']=' + s.event_name);

                o.event_name = s.event_name;

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

    // send override: lazy getters on matching XHRs / 重写 send：对匹配的 XHR 安装惰性 getter 替换响应
    XMLHttpRequest.prototype.send = function() {
        if (!this.__skTarget || this.__skGen !== GEN) return origSend.apply(this, arguments);

        this.__skTarget = false;
        refreshEvents();

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

    // Flush PartnerEventStore cache for TARGET_APPID so stale entries
    // don't survive across re-injections (MobX ObservableMap).
    var storeCleared = 0;
    try {
        if (typeof g_PartnerEventStore !== 'undefined' && g_PartnerEventStore.m_mapExistingEvents) {
            var evMap = g_PartnerEventStore.m_mapExistingEvents;
            var evData = evMap.data_;
            if (evData) {
                var toDelete = [];
                evData.forEach(function(v, k) {
                    var val = v && v.value_ !== undefined ? v.value_ : v;
                    if (val && val.appid === TARGET_APPID) toDelete.push(k);
                });
                for (var di = 0; di < toDelete.length; di++) evMap.delete(toDelete[di]);
                storeCleared = toDelete.length;
            }
            var appMap = g_PartnerEventStore.m_mapAppIDToGIDs;
            if (appMap && appMap.delete) {
                appMap.delete(TARGET_APPID);
                appMap.delete(String(TARGET_APPID));
            }
            window.__skXhrLog.push('store:cleared ' + storeCleared + ' cached events');
        }
    } catch(e) {
        window.__skXhrLog.push('store:clear error ' + e.message);
    }

    // Patch stale event data already rendered in BigPicture's React tree.
    // Uses semantic DOM attributes (role="button") + React fiber inspection
    // instead of fragile minified CSS class names.
    var bpPatched = 0;
    function patchBPEvents() {
        var ours = window.__skOurEvents;
        if (!ours || !ours.length || !document.body) return;

        var buttons = document.querySelectorAll('[role="button"]');
        for (var bi = 0; bi < buttons.length; bi++) {
            var el = buttons[bi];
            var fiberKey = null;
            var elKeys = Object.keys(el);
            for (var ki = 0; ki < elKeys.length; ki++) {
                if (elKeys[ki].indexOf('__reactFiber') === 0) { fiberKey = elKeys[ki]; break; }
            }
            if (!fiberKey) continue;

            var cur = el[fiberKey];
            for (var fd = 0; fd < 10 && cur; fd++, cur = cur.return) {
                var ev = cur.memoizedProps && cur.memoizedProps.event;
                if (!ev || ev.appid !== TARGET_APPID) continue;
                if (!ev.name || !ev.name.data_) break;

                var nameData = ev.name.data_;
                var firstNameVal = null;
                var langKey = null;
                nameData.forEach(function(v, k) {
                    if (firstNameVal === null) {
                        firstNameVal = v && v.value_ !== undefined ? v.value_ : v;
                        langKey = k;
                    }
                });
                if (!firstNameVal || firstNameVal.charCodeAt(0) === 0x200B) break;

                var gid = ev.GID;
                var entry = window.__skTargetGids && window.__skTargetGids[gid];
                var src = entry ? ours[entry.idx] : ours[0];
                if (!src) break;

                var newName = src.event_name || '';
                ev.name.set(langKey, '\u200B' + newName);
                if (ev.description && ev.description.set) {
                    var rawBody = (src.announcement_body && src.announcement_body.body) || '';
                    ev.description.set(langKey, '\u200B' + rawBody);
                }
                bpPatched++;
                window.__skXhrLog.push('bp-patch:gid=' + gid + ' -> ' + newName);
                break;
            }
        }
    }

    if (typeof document !== 'undefined' && document.body) {
        patchBPEvents();
        var bpObs = new MutationObserver(function() {
            if (window.__skGen !== GEN) { bpObs.disconnect(); return; }
            patchBPEvents();
        });
        bpObs.observe(document.body, { childList: true, subtree: true });
    }

    return JSON.stringify({
        ok: true,
        version: VERSION,
        events: initEvents.length,
        title: initEvents[0].event_name,
        storeCleared: storeCleared,
        bpPatched: bpPatched
    });
})()
