(function() {
    var TARGET_APPID = /*TARGET_APPID*/1675200;
    var LANG_LIST = /*LANG_LIST*/'6_0';
    var CURRENT_BRANCH = /*CURRENT_BRANCH*/'';
    var REPO_MIRRORS = /*REPO_MIRRORS*/[];
    var DETECTED_LANG = /*DETECTED_LANG*/'';
    var PREFETCHED_EVENTS = /*PREFETCHED_EVENTS*/null;
    var VERSION = /*VERSION*/'0.0.0';
    window.__skXhrLog = [];
    window.__skVersion = VERSION;

    var TARGET_APPID_STR = 'appid=' + TARGET_APPID;

    // Exposed via window.__skParseRepo at the bottom of this IIFE so external
    // callers (e.g. Python pushing fresh announcements over CDP) can reuse
    // the exact same filtering / event-construction pipeline as the in-page
    // refresh path. / 在 IIFE 末尾通过 window.__skParseRepo 暴露，
    // 供外部（如 Python 通过 CDP 推送新公告时）复用同一套过滤/构造流程。
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
                            applyNewEvents(events);
                            window.__skXhrLog.push('repo-refresh:' + events.length + ' events (via apply)');
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

    // Throttle window between in-page refresh attempts.
    // Python daemon also performs periodic background fetch (with ETag),
    // so this only needs to cover bursty user-triggered refreshes.
    // 页内刷新节流间隔。Python 守护进程会按 ETag 周期性后台回拉，
    // 这里只需覆盖用户操作引发的密集触发。
    var REFRESH_THROTTLE_MS = 60000;

    function refreshEvents() {
        var now = Date.now();
        if (window.__skLastRefresh && (now - window.__skLastRefresh) < REFRESH_THROTTLE_MS) return;
        window.__skLastRefresh = now;
        if (REPO_MIRRORS.length > 0) { refreshRepoAsync(); return; }
    }

    var initEvents = parseRepoJSON(PREFETCHED_EVENTS);
    if (!initEvents || initEvents.length === 0)
        return JSON.stringify({error: 'failed to fetch our events'});

    window.__skOurEvents = initEvents;
    window.__skOurTitle = initEvents[0].event_name;
    window.__skLastRefresh = Date.now();

    // Preserve the truly original XHR natives from the very first injection;
    // on re-injection, restore the prototype first to prevent hook stacking.
    // Must run BEFORE async prefetch so those XHRs use native methods.
    if (!window.__skOrigOpen) {
        window.__skOrigOpen = XMLHttpRequest.prototype.open;
        window.__skOrigSend = XMLHttpRequest.prototype.send;
        window.__skOrigGetter_rt = Object.getOwnPropertyDescriptor(
            XMLHttpRequest.prototype, 'responseText');
        window.__skOrigGetter_r = Object.getOwnPropertyDescriptor(
            XMLHttpRequest.prototype, 'response');
    } else {
        XMLHttpRequest.prototype.open = window.__skOrigOpen;
        XMLHttpRequest.prototype.send = window.__skOrigSend;
    }
    var origOpen = window.__skOrigOpen;
    var origSend = window.__skOrigSend;
    var origGetter_rt = window.__skOrigGetter_rt;
    var origGetter_r = window.__skOrigGetter_r;

    // Pre-fetch Valve frontpage events for sort order (async to avoid blocking UI)
    window.__skValveRank = {};
    window.__skNextFallbackIdx = 0;

    (function prefetchValveEventsAsync() {
        var screenGids = [];
        var screenSeen = {};
        var tagSets = ['&require_tags=patchnotes', '&require_tags=patchnotes,stablechannel'];
        var pending = tagSets.length;

        function onAllDone() {
            screenGids.sort(function(a, b) { return b.time - a.time; });
            for (var si = 0; si < screenGids.length; si++) {
                window.__skValveRank[screenGids[si].gid] = si;
                window.__skXhrLog.push('screen:' + screenGids[si].gid + '->rank' + si + ' t=' + screenGids[si].time);
            }
            window.__skNextFallbackIdx = screenGids.length;
        }

        function handleResponse(xv) {
            try {
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
            if (--pending <= 0) onAllDone();
        }

        for (var ti = 0; ti < tagSets.length; ti++) {
            try {
                var xv = new XMLHttpRequest();
                xv.open('GET',
                    'https://store.steampowered.com/events/ajaxgetadjacentpartnerevents/'
                    + '?appid=' + TARGET_APPID
                    + '&count_before=0&count_after=1&lang_list=' + LANG_LIST
                    + '&only_summaries=true'
                    + tagSets[ti],
                    true);
                xv.timeout = 8000;
                xv.onload = (function(req) { return function() { handleResponse(req); }; })(xv);
                xv.onerror = xv.ontimeout = (function(req) { return function() { handleResponse(req); }; })(xv);
                xv.send();
            } catch(e) {
                if (--pending <= 0) onAllDone();
            }
        }
    })();

    window.__skTargetGids = {};
    window.__skTargetCount = 0;
    window.__skOrderLocked = false;

    // Generation mechanism: invalidate stale hooks / 代际标记：使旧钩子失效，避免重复叠加
    var GEN = Date.now();
    window.__skGen = GEN;

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

            // Build set of ours indices already assigned in this response
            var usedIdx = {};
            for (var i = 0; i < orig.events.length; i++) {
                var entry = window.__skTargetGids[String(orig.events[i].gid)];
                if (entry) usedIdx[entry.idx] = true;
            }

            for (var i = 0; i < orig.events.length && window.__skTargetCount < ours.length; i++) {
                var g = String(orig.events[i].gid);
                if (!window.__skTargetGids[g]) {
                    var rank = window.__skValveRank[g];
                    var idx = -1;
                    if (rank !== undefined && rank < ours.length && !usedIdx[rank]) {
                        idx = rank;
                    } else {
                        for (var fi = 0; fi < ours.length; fi++) {
                            if (!usedIdx[fi]) { idx = fi; break; }
                        }
                    }
                    if (idx >= 0 && idx < ours.length) {
                        window.__skTargetGids[g] = {
                            idx: idx,
                            time: orig.events[i].rtime32_start_time || 0
                        };
                        usedIdx[idx] = true;
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
                } else if (s.announcement_body) {
                    o.announcement_body = {
                        gid: s.announcement_body.gid || s.gid,
                        headline: s.event_name,
                        body: '\u200B' + (s.announcement_body.body || ''),
                        posttime: s.announcement_body.posttime || o.rtime32_start_time,
                        updatetime: s.announcement_body.updatetime || o.rtime32_start_time
                    };
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

    // Flush PartnerEventStore caches for TARGET_APPID so stale entries
    // don't survive across re-injections / refreshes (MobX ObservableMap).
    // 清空 PartnerEventStore 中目标 appid 的缓存条目，避免跨注入/刷新残留。
    function clearPartnerStore() {
        var cleared = 0;
        try {
            if (typeof g_PartnerEventStore === 'undefined') return 0;
            var store = g_PartnerEventStore;

            if (store.m_mapExistingEvents && store.m_mapExistingEvents.data_) {
                var toDelete = [];
                store.m_mapExistingEvents.data_.forEach(function(v, k) {
                    var val = v && v.value_ !== undefined ? v.value_ : v;
                    if (val && val.appid === TARGET_APPID) toDelete.push(k);
                });
                for (var di = 0; di < toDelete.length; di++) store.m_mapExistingEvents.delete(toDelete[di]);
                cleared += toDelete.length;
            }

            // Values lack appid, clear all entries unconditionally.
            if (store.m_mapAnnouncementBodyToEvent && store.m_mapAnnouncementBodyToEvent.data_) {
                var abDel = [];
                store.m_mapAnnouncementBodyToEvent.data_.forEach(function(v, k) { abDel.push(k); });
                for (var di = 0; di < abDel.length; di++) store.m_mapAnnouncementBodyToEvent.delete(abDel[di]);
                cleared += abDel.length;
            }

            if (store.m_mapAppIDToGIDs && store.m_mapAppIDToGIDs.delete) {
                store.m_mapAppIDToGIDs.delete(TARGET_APPID);
                store.m_mapAppIDToGIDs.delete(String(TARGET_APPID));
            }

            if (store.m_mapClanToGIDs && store.m_mapClanToGIDs.data_) {
                var clanDel = [];
                store.m_mapClanToGIDs.data_.forEach(function(v, k) { clanDel.push(k); });
                for (var di = 0; di < clanDel.length; di++) store.m_mapClanToGIDs.delete(clanDel[di]);
            }
        } catch(e) {
            window.__skXhrLog.push('store:clear error ' + e.message);
        }
        return cleared;
    }

    // Re-apply a fresh set of events in-place: swap __skOurEvents, reset
    // mapping state when shape changes, flush MobX caches and patch any
    // already-rendered React fibers. Used by both the in-page XHR refresh
    // path and external CDP-pushed refresh from the Python daemon.
    // 就地应用一组新公告：替换 __skOurEvents、按需重置映射、清 MobX 缓存、
    // 修补已渲染的 React fiber。XHR 内刷新与 Python 守护推送共用此函数。
    function applyNewEvents(newOurs) {
        if (!newOurs || !newOurs.length) return 0;
        var prev = window.__skOurEvents || [];
        var changed = newOurs.length !== prev.length
            || (prev[0] && newOurs[0].event_name !== prev[0].event_name);
        window.__skOurEvents = newOurs;
        window.__skOurTitle = newOurs[0].event_name;
        if (changed) {
            window.__skTargetGids = {};
            window.__skTargetCount = 0;
            window.__skNextFallbackIdx = Object.keys(window.__skValveRank || {}).length;
        }
        var c = clearPartnerStore();
        if (typeof patchBPEvents === 'function') patchBPEvents();
        if (typeof patchStaleBBCode === 'function') patchStaleBBCode();
        window.__skXhrLog.push('apply:' + newOurs.length + ' events storeCleared=' + c
            + (changed ? ' (reset)' : ''));
        return newOurs.length;
    }

    var storeCleared = clearPartnerStore();
    window.__skXhrLog.push('store:cleared ' + storeCleared + ' cached entries');

    // Patch stale event data already rendered in BigPicture's React tree.
    var bpPatched = 0;
    var _lastBBCodeScan = 0;

    function _findFiberKey(el) {
        var keys = Object.keys(el);
        for (var i = 0; i < keys.length; i++)
            if (keys[i].indexOf('__reactFiber') === 0) return keys[i];
        return null;
    }

    function _getExpected(gid, eventObj) {
        var ours = window.__skOurEvents;
        if (!ours || !ours.length) return null;
        var src = null;
        var entry = window.__skTargetGids && window.__skTargetGids[gid];
        if (entry) {
            src = ours[entry.idx];
        } else if (eventObj) {
            // In BP context targetGids may be empty; match by name
            var curName = null;
            if (eventObj.name && eventObj.name.data_) {
                eventObj.name.data_.forEach(function(v) {
                    if (curName === null) curName = v && v.value_ !== undefined ? v.value_ : v;
                });
            }
            if (curName) {
                var clean = curName.charCodeAt(0) === 0x200B ? curName.substring(1) : curName;
                for (var i = 0; i < ours.length; i++) {
                    if (ours[i].event_name === clean) { src = ours[i]; break; }
                }
            }
        }
        if (!src) src = ours[0];
        if (!src) return null;
        return {
            name: '\u200B' + (src.event_name || ''),
            body: '\u200B' + ((src.announcement_body && src.announcement_body.body) || '')
        };
    }

    function patchBPEvents() {
        var ours = window.__skOurEvents;
        if (!ours || !ours.length || !document.body) return;

        // Phase 1: patch event MobX maps via [role="button"] (card titles)
        var buttons = document.querySelectorAll('[role="button"]');
        for (var bi = 0; bi < buttons.length; bi++) {
            var fk = _findFiberKey(buttons[bi]);
            if (!fk) continue;

            var cur = buttons[bi][fk];
            for (var fd = 0; fd < 10 && cur; fd++, cur = cur.return) {
                var ev = cur.memoizedProps && cur.memoizedProps.event;
                if (!ev || ev.appid !== TARGET_APPID) continue;
                if (!ev.name || !ev.name.data_) break;

                var langKey = null;
                var nameVal = null;
                ev.name.data_.forEach(function(v, k) {
                    if (nameVal === null) {
                        nameVal = v && v.value_ !== undefined ? v.value_ : v;
                        langKey = k;
                    }
                });
                if (!nameVal) break;

                var exp = _getExpected(ev.GID, ev);
                if (!exp) break;
                if (nameVal === exp.name) break;

                ev.name.set(langKey, exp.name);
                if (ev.description && ev.description.set)
                    ev.description.set(langKey, exp.body);
                bpPatched++;
                window.__skXhrLog.push('bp-patch:gid=' + ev.GID + ' -> ' + exp.name.substring(1, 30));
                break;
            }
        }

    }

    var _bpPatchTimer = null;
    function scheduleBPPatch() {
        if (_bpPatchTimer) clearTimeout(_bpPatchTimer);
        _bpPatchTimer = setTimeout(patchBPEvents, 150);
    }

    // Phase 2: fix stale BBCode renderers in expanded detail view.
    // Debounced — runs 200ms after the last DOM mutation so the expanded view
    // is fully built before we scan.
    var _bbcodeTimer = null;
    function scheduleBBCodePatch() {
        if (_bbcodeTimer) clearTimeout(_bbcodeTimer);
        _bbcodeTimer = setTimeout(patchStaleBBCode, 200);
    }

    function patchStaleBBCode() {
        var ours = window.__skOurEvents;
        if (!ours || !ours.length || !document.body) return;

        var els = document.body.querySelectorAll('div, b, ul, li, span, br, p');
        for (var si = 0; si < els.length; si++) {
            var sfk = _findFiberKey(els[si]);
            if (!sfk) continue;

            var scur = els[si][sfk];
            for (var sfd = 0; sfd < 3 && scur; sfd++, scur = scur.return) {
                if (!scur.memoizedProps || typeof scur.memoizedProps.text !== 'string') continue;
                if (scur.memoizedProps.text.charCodeAt(0) !== 0x200B) continue;

                var sevt = scur.memoizedProps.event;
                if (!sevt || sevt.appid !== TARGET_APPID) continue;

                var sexp = _getExpected(sevt.GID, sevt);
                if (!sexp || scur.memoizedProps.text === sexp.body) continue;

                var sLang = 6;
                if (sevt.description && sevt.description.set) {
                    if (sevt.description.data_)
                        sevt.description.data_.forEach(function(v, k) { sLang = k; });
                    sevt.description.set(sLang, sexp.body);
                }
                if (sevt.name && sevt.name.set) {
                    var nLang = 6;
                    if (sevt.name.data_)
                        sevt.name.data_.forEach(function(v, k) { nLang = k; });
                    sevt.name.set(nLang, sexp.name);
                }

                var kCur = scur.return;
                for (var kd = 0; kd < 10 && kCur; kd++, kCur = kCur.return) {
                    if (kCur.memoizedProps && kCur.memoizedProps.event === sevt) {
                        kCur.memoizedProps = Object.assign({}, kCur.memoizedProps, {__skV: Date.now()});
                        if (kCur.alternate && kCur.alternate.memoizedProps)
                            kCur.alternate.memoizedProps = Object.assign({}, kCur.alternate.memoizedProps, {__skV: Date.now()});
                        break;
                    }
                }

                var fuCur = scur.return;
                for (var fud = 0; fud < 15 && fuCur; fud++, fuCur = fuCur.return) {
                    if (fuCur.stateNode && typeof fuCur.stateNode.forceUpdate === 'function') {
                        fuCur.stateNode.forceUpdate();
                        break;
                    }
                }
                bpPatched++;
                window.__skXhrLog.push('bp-bbcode-fix:gid=' + sevt.GID + ' patched + forceUpdate');
            }
        }
    }

    if (typeof document !== 'undefined' && document.body) {
        patchBPEvents();
        patchStaleBBCode();
        var bpObs = new MutationObserver(function() {
            if (window.__skGen !== GEN) { bpObs.disconnect(); return; }
            scheduleBPPatch();
            scheduleBBCodePatch();
        });
        bpObs.observe(document.body, { childList: true, subtree: true });
    }

    // Expose a stable surface for external refresh (Python daemon over CDP)
    // and for sharing the parse pipeline.
    // 对外稳定接口：供 Python 守护进程通过 CDP 触发外部刷新，并共享解析流程。
    window.__skParseRepo = parseRepoJSON;
    window.__skApply = applyNewEvents;

    return JSON.stringify({
        ok: true,
        version: VERSION,
        events: initEvents.length,
        title: initEvents[0].event_name,
        storeCleared: storeCleared,
        bpPatched: bpPatched
    });
})()
