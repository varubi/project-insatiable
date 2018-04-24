const fs = require('fs'),
    Denque = require('denque'),
    { URL } = require('url');

function StringReverse(str) {
    var s = '';
    for (let i = str.length; i > 0; i--)
        s += str[i - 1];
    return s;
}
function BeginsWith(haystack, needle) {
    return haystack.substring(0, needle.length) == needle;
}

function History() {
    var queue = new Denque(),
        length = 0,
        total = 0,
        logs = Object.create(null);

    this.length = () => length;
    this.total = () => total;
    this.push = function (href, referrer) {
        if (!logs[href.fullpath]) {
            logs[href.fullpath] = {
                href: href,
                requests: [],
                referrers: {}
            };
            queue.push(href);
            length++;
            total++;
        }
        logs[href.fullpath].referrers[(referrer ? referrer.fullpath : '')] = true;
    }
    this.next = function () {
        if (!length)
            return;
        length--;
        return queue.shift();
    }
    this.emptyQueue = function () {
        queue = new Denque();
    }
    this.reset = function () {
        queue = new Denque();
        logs = Object.create(null);
    }
    this.log = function (obj) {
        var size = Buffer.byteLength(obj.content, 'utf8');
        logs[obj.href.fullpath].requests.push({
            status: obj.responseStatus,
            size: size,
            startTime: obj.startTime,
            ttfb: obj.ttfb,
            time: obj.responseTime,
            parseTime: obj.parseTime,
        });
    }

    this.view = function (limit, sort, direction) {
        var keys = Object.keys(logs)
        var results = [];
        limit = limit || keys.length;
        sort = sort || 'path';
        direction = direction || 1;
        keys.sort();
        for (var i = 0; i < keys.length; i++) {
            results.push(logs[keys[i]]);
        }
        return results.slice(0, limit - 1);
    }
}
function QueueLoop(queue) {
    var _queue = queue,
        _iterator = _queue.length;
    this.shift = function () {
        _iterator--;
        return _queue[_iterator];
        _iterator = _iterator || _queue.length;
    }
}
function CookieJar(cookies) {
    this.domains = {};
    if (Array.isArray(cookies) && cookies.length)
        this.load(cookies)
}
CookieJar.prototype.load = function (cookies) {
    for (var i = 0; i < cookies.length; i++) {
        cookie = {};
        cookie.domain = cookies[i].domain;
        cookie.path = cookies[i].path;
        cookie.name = cookies[i].name;
        cookie.value = cookies[i].value;
        cookie.host_reverse = StringReverse(cookies[i].domain);
        if (cookies[i].secure)
            cookie.secure = '';

        if (!this.domains[cookie.host_reverse])
            this.domains[cookie.host_reverse] = {};
        this.domains[cookie.host_reverse][cookie.name] = cookie;

    }
}
CookieJar.prototype.set = function (referrer, cookies) {
    if (!cookies)
        return;

    var jar = [];
    for (var i = 0; i < cookies.length; i++) {
        jar.push(parseCookie(cookies[i]));
    }
    var secure = referrer.protocol == 'https:';
    var domain = referrer.host;
    var host_reverse = referrer.host_reverse;
    var path = referrer.pathname;

    for (var i = 0; i < jar.length; i++) {
        var name = jar[i].name;
        if (!secure && (jar[i].hasOwnProperty('secure') || name.indexOf('__secure')))
            continue;
        if (!secure && name.indexOf('__secure') && (jar[i].hasOwnProperty('domain') || (jar[i].hasOwnProperty('path') && jar[i].pathname != '/')))
            continue;

        if (jar[i].hasOwnProperty('host_reverse') && (jar[i].host_reverse.indexOf(host_reverse) != 0 || jar[i].host_reverse.length < host_reverse.length))
            continue;

        var usedomain = jar[i].host_reverse || host_reverse;
        if (!this.domains[usedomain])
            this.domains[usedomain] = {};

        this.domains[usedomain][name] = jar[i];
    }

    function parseCookie(cookie) {
        var data = cookie.split(';');
        var kv = data.shift().split('=');
        var cookie = {};
        cookie.name = kv.shift();
        cookie.value = kv.join('=');
        while (data.length) {
            var kv = data.shift().split('=')
            kv[0] = kv[0].toLowerCase();
            var key = kv[0].trim().toLowerCase();
            if (key == 'path' || key == 'domain')
                cookie[key] = (kv[1] || '').trim();
            else if (key == 'secure' || key == '__secure')
                cookie.secure = true;
        }
        if (cookie.domain)
            cookie.host_reverse = StringReverse(cookie.domain)
        return cookie;
    }
}
CookieJar.prototype.get = function (referrer) {
    var secure = referrer.protocol == 'https:';
    var domain = referrer.host;
    var host_reverse = referrer.host_reverse;
    var path = referrer.pathname;
    var cookies = [];

    for (var drev in this.domains) {
        if (drev.indexOf(host_reverse) != 0 || drev.length < host_reverse.length)
            continue;

        var jar = this.domains[drev];
        for (var i in jar) {
            var name = jar[i].name;
            if (!secure && (jar[i].hasOwnProperty('secure') || name.indexOf('__secure')))
                continue;
            if (!secure && name.indexOf('__secure') && (jar[i].hasOwnProperty('domain') || (jar[i].hasOwnProperty('path') && jar[i].pathname != '/')))
                continue;

            if (jar[i].hasOwnProperty('host_reverse') && (jar[i].host_reverse.indexOf(host_reverse) != 0 || jar[i].host_reverse.length < host_reverse.length))
                continue;
            cookies.push(jar[i].name + '=' + jar[i].value);
        }
    }
    return cookies.join('; ')
}
function Url(href, referrer) {
    try {
        if (referrer) {
            href = (BeginsWith(href, '//') == 0 ? referrer.protocol : '') + href;
            href = new URL(href, referrer.fullpath);
        } else {
            href = new URL(href);
        }
        var obj = Object.create(null);
        obj.hash = href.hash
        obj.host = href.host
        obj.hostname = href.hostname
        obj.href = href.href
        obj.origin = href.origin
        obj.password = href.password
        obj.port = href.port
        obj.protocol = href.protocol
        obj.search = href.search
        obj.searchParams = href.searchParams
        obj.username = href.username
        obj.pathname = (href.pathname || '/');
        obj.path = (BeginsWith(obj.pathname, '/') ? '' : '/') + obj.pathname.trim();
        obj.fullpath = obj.origin + obj.path;
        obj.host_reverse = StringReverse(href.host);
        return obj;
    } catch (error) {
        return null;
    }
}
exports.CookieJar = CookieJar;
exports.History = History;
exports.URL = Url;

