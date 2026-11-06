const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class FakeXHR {
    open(_method, url) { this.url = url; }
    send() {}
}
Object.defineProperty(FakeXHR.prototype, 'responseText', {get() { return this.raw; }});
Object.defineProperty(FakeXHR.prototype, 'response', {get() { return this.raw; }});

const window = {};
const context = {window, XMLHttpRequest: FakeXHR, Date, Object, JSON, setTimeout};
const source = fs.readFileSync('src/lib/js/xhr-hook.js', 'utf8')
    .replace('/*PREFETCHED_EVENTS*/null', '/*PREFETCHED_EVENTS*/[{"title":"new"},{"title":"old"},{"title":"older"},{"title":"oldest"}]')
    .replace("/*DETECTED_LANG*/''", "/*DETECTED_LANG*/'english'");
assert.equal(JSON.parse(vm.runInNewContext(source, context)).ok, true);
window.__skValveRank = {'333': 0, '222': 1, '111': 2};

function response(url, gids) {
    const xhr = new FakeXHR();
    xhr.open('GET', url);
    xhr.raw = JSON.stringify({events: gids.map(([gid, time]) => ({gid, rtime32_start_time: time, event_name: 'Valve'}))});
    xhr.send();
    xhr.readyState = 4;
    return JSON.parse(xhr.responseText).events;
}

const base = 'https://store.steampowered.com/events/ajaxgetadjacentpartnerevents/?appid=1675200';
const selected = base + '&gidevent=222&count_before=3';
assert.deepEqual(response(base, [['333', 300], ['222', 200], ['111', 100]]).map(e => e.event_name),
    ['new', 'old', 'older']);
assert.deepEqual(response(selected, [['333', 300], ['222', 200], ['111', 100]]).map(e => e.event_name),
    ['Valve', 'new', 'old']);
assert.equal(window.__skTargetGids['222'].idx, 0);
assert.equal(window.__skTargetGids['333'], undefined);
assert.equal(window.__skTargetGids['111'].idx, 1);
// A later response can reveal an older event between the anchor and 111.
assert.deepEqual(response(selected, [['222', 200], ['150', 150], ['111', 100]]).map(e => e.event_name),
    ['new', 'old', 'older']);
assert.equal(window.__skTargetGids['150'].idx, 1);
assert.equal(window.__skTargetGids['111'].idx, 2);
// Selecting a different event starts a new sequence and drops old mappings.
assert.deepEqual(response(base + '&gidevent=111', [['222', 200], ['111', 100], ['050', 50]]).map(e => e.event_name),
    ['Valve', 'new', 'old']);
assert.equal(window.__skTargetGids['222'], undefined);
