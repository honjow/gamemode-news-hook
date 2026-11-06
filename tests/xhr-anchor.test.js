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
    .replace('/*PREFETCHED_EVENTS*/null', '/*PREFETCHED_EVENTS*/[{"title":"new"},{"title":"old"}]')
    .replace("/*DETECTED_LANG*/''", "/*DETECTED_LANG*/'english'");
assert.equal(JSON.parse(vm.runInNewContext(source, context)).ok, true);
window.__skValveRank = {'333': 0, '222': 1};

function response(url, gids) {
    const xhr = new FakeXHR();
    xhr.open('GET', url);
    xhr.raw = JSON.stringify({events: gids.map(([gid, time]) => ({gid, rtime32_start_time: time, event_name: 'Valve'}))});
    xhr.send();
    xhr.readyState = 4;
    return JSON.parse(xhr.responseText).events;
}

const url = 'https://store.steampowered.com/events/ajaxgetadjacentpartnerevents/?appid=1675200&gidevent=older&count_before=3';
// The selected GID is numeric in Steam requests.
const selected = url.replace('older', '222');
assert.equal(response(selected, [['222', 200], ['111', 100]])[0].event_name, 'new');
assert.equal(response(selected, [['222', 200], ['111', 100]])[1].event_name, 'old');
assert.equal(response(selected, [['333', 300], ['222', 200]])[1].event_name, 'new');
assert.equal(window.__skTargetGids['222'].idx, 0);
assert.equal(window.__skTargetGids['333'], undefined);
