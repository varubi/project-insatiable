const path = require('path'),
    http = require('http'),
    https = require('https'),
    events = require('events'),
    { fork } = require('child_process'),
    { Parser } = require('./parser.js'),
    { History, CookieJar, URL } = require('./model.js');


function Client(config) {
    // Private 
    var _this = this,
        _status = {
            Stopped: 0,
            Pause: 1,
            Running: 2
        },
        _state = {
            counter: 0,
            time_remaining: 0,
            time_started: 0,
            request_open: 0,
            request_completed: 0,
            request_last: Date.now(),
            request_interval: false,
            kms_interval: false,
            cookies: new CookieJar(),
            history: new History(),
            parser: new Parser(_parseEnd),
            status: _status.Stopped
        },
        _config = {
            url_limit: 1000,
            url_passes: 0,
            duration: 0,
            request_maxpersecond: 50,
            request_concurrent: 50,
            request_wait: 30000,
            follow_external: false,
            auto_queue: true,
            log_stats: true,
            follow_subdomain: false,
            case_sensitive: false,
            query_strings: false,
            request_headers: {},
            host: 'localhost'
        },
        _hooks = {
            parseStart: null,
            parseComplete: null,
            beforeRequest: null
        },
        _KMSEvent = new KMSEvent();
    _state.queue = _state.history;

    function _KMSEventPoll(force) {
        if (!force && (Date.now() - _KMSEvent.timestamp) < 1000)
            return;
        _KMSEvent.requests.total = _state.request_completed;
        _KMSEvent.requests.active = _state.request_open;
        _KMSEvent.requests.queued = _state.queue.length();
        _this.emit('kms', _KMSEvent);
        _KMSEvent = new KMSEvent(_KMSEvent.timestamp + 1000);
    }

    function _parseEnd(responses) {
        _KMSEventPoll();
        for (var i = 0; i < responses.length; i++) {
            if (_config.auto_queue && _state.status != _status.Stopped)
                responses[i].hrefs.forEach(h => _autoQueue(h, responses[i].href));
            if (_config.log_stats)
                _state.history.log(responses[i]);
            _state.request_completed++;
            _state.request_open--;
        }
    }
    function _request(href) {
        var headers = Object.assign({}, _config.request_headers, { Cookie: _state.cookies.get(href) })
        var options = { headers: headers }
        if (typeof _hooks.beforeRequest == 'function')
            _hooks.beforeRequest.apply(options);
        options.host = href.host;
        options.path = href.path;
        _KMSEvent.requests.urls.push(href);
        _KMSEvent.requests.opened++;
        _state.counter++;
        var req = (href.protocol == 'https:' ? https : http).request(options, responseHandler).on('error', end);
        req.setTimeout(_config.request_wait, () => { req.abort(); });
        req.end();
        var start = Date.now(),
            ttfb = 0,
            responseCode = 0,
            body = '';
        _state.request_open++;
        _state.request_last = start;
        function responseHandler(response) {
            _KMSEventPoll();
            response.setTimeout(_config.request_wait, () => { req.abort(); });
            if (response.headers['set-cookie'])
                _state.cookies.set(href, response.headers['set-cookie']);
            response.setEncoding('utf8');
            responseCode = response.statusCode;
            ttfb = Date.now() - start;
            response.on('data', function (chunk) {
                _KMSEvent.bandwidth += chunk.length;
                body += chunk;
            });
            response.on('end', end);
        }
        function end(e) {
            _KMSEventPoll();
            _KMSEvent.requests.closed++;
            _KMSEvent.responses.codes[responseCode] = (_KMSEvent.responses.codes[responseCode] || 0) + 1;
            _KMSEvent.responses.ttfb.push(ttfb);
            _state.parser.parse({ ttfb: ttfb, href: href, responseStatus: responseCode, startTime: start, responseTime: (Date.now() - start), content: body });
        }
    }
    function _queue(href, referrer) {
        if (_config.query_strings)
            href.path += href.search;
        if (!_config.case_sensitive)
            href.path = href.pathname.toLowerCase();
        href.fullpath = href.origin + href.path;
        _state.queue.push(href, referrer);
    }
    function _autoQueue(href, referrer) {
        if (href.protocol != 'http:' && href.protocol != 'https:')
            return;
        if (_config.url_limit && _config.url_limit <= _state.history.total())
            return;
        if (!_config.follow_subdomain && href.host != _config.host)
            return;
        if (!_config.follow_external && href.host.substring(href.host.length - _config.host.length) != _config.host)
            return;
        _queue(href, referrer)
    }
    function _complete() {

    }
    function _continue() {
        _KMSEventPoll();
        var now = Date.now();
        if (_config.request_concurrent && _config.request_concurrent <= _state.request_open)
            return;
        if (_config.duration && _state.time_started + _state.time_remaining <= now)
            return _this.stop();
        if (_state.request_completed == _config.url_limit)
            return _this.stop();
        var href = _state.queue.next();
        if (!href)
            return _state.request_open <= 0 && _this.stop();
        _request(href);
    }
    // Public
    this.queue = function (href, referrer) {
        var href = URL(href, referrer);
        if (!href || !('http:' == href.protocol || 'https:' == href.protocol))
            return _this;
        _queue(href, referrer)
        return _this;
    }
    this.start = function () {
        if (_state.status != _status.Running) {
            clearInterval(_state.request_interval);
            clearInterval(_state.kms_interval);
            _state.request_interval = setInterval(() => _continue(), 1000 / _config.request_maxpersecond);
            _state.kms_interval = setInterval(() => _KMSEventPoll(), 1000);
            _state.parser.start();
            _state.status = _status.Running;
            _state.time_started = Date.now();
            _this.emit('started');
            _continue();
        }
        return _this;
    }
    this.pause = function () {
        if (_state.status == _status.Running) {
            clearInterval(_state.request_interval);
            _state.request_interval = false;
            if (_config.duration) {
                var now = Date.now();
                _state.time_remaining = _state.time_started - now;
            }
            _state.status = _status.Pause;
            _this.emit('pause');
        }
        return _this;
    }
    this.stop = function (m) {
        if (_state.status != _status.Stopped) {
            console.log(m)
            clearInterval(_state.request_interval);
            clearInterval(_state.kms_interval);
            _state.request_interval = false;
            _state.kms_interval = false;
            _state.status = _status.Stopped;
            _state.history.emptyQueue();
            _state.parser.stop();
            _KMSEventPoll(true);
            _this.emit('complete');
        }
        return _this;
    }
    this.reset = function () {
        _this.stop();
        _state.history.reset();
        return _this;
    }

    this.configure = function (config) {
        if (typeof config.url_limit == 'number')
            _config.url_limit = parseInt(config.url_limit);
        if (typeof config.url_passes == 'number')
            _config.url_passes = parseInt(config.url_passes);
        if (typeof config.request_maxpersecond == 'number')
            _config.request_maxpersecond = parseInt(config.request_maxpersecond);
        if (typeof config.request_concurrent == 'number')
            _config.request_concurrent = parseInt(config.request_concurrent);
        if (typeof config.request_wait == 'number')
            _config.request_wait = parseInt(config.request_wait);
        if (config.hasOwnProperty('follow_external'))
            _config.follow_external = !!config.follow_external;
        if (config.hasOwnProperty('log_stats'))
            _config.log_stats = !!config.log_stats;
        if (config.hasOwnProperty('follow_subdomain'))
            _config.follow_subdomain = !!config.follow_subdomain;
        if (config.hasOwnProperty('case_sensitive'))
            _config.case_sensitive = !!config.case_sensitive;
        if (config.hasOwnProperty('query_strings'))
            _config.query_strings = !!config.query_strings;

        if (_state.status == _status.Stopped) {
            if (config.parser) {
                if (typeof config.parser.start != 'function' || typeof config.parser.stop != 'function' || typeof config.parser.parse != 'function')
                    throw 'Invalid Parser';
                _state.parser = config.parser;
            } else if (config.hasOwnProperty('parser_method') || config.hasOwnProperty('parser_threads')) {
                _state.parser = new Parser(_parseEnd);
                if (config.parser_method)
                    _state.parser.setParseMethod(config.parse_method);
                if (typeof config.parser_threads == 'number')
                    _state.parser.fork(parseInt(config.parser_threads));
            }
            if (config.hasOwnProperty('auto_queue'))
                _config.auto_queue = !!config.auto_queue;
            if (config.hasOwnProperty('cookies'))
                _state.cookies = new CookieJar(config.cookies);
            if (config.hasOwnProperty('headers'))
                _config.request_headers = config.headers;
            if (config.duration) {
                _config.duration = config.duration;
                _state.time_remaining = config.duration;
            }
            if (config.base_url) {
                var href = URL(config.base_url);
                _config.host = href.host;
                _this.queue(config.base_url)
            }
        }
    }
    this.configure(config);
    return _this;
}
Client.prototype = new events.EventEmitter;

function KMSEvent(timestamp) {
    this.requests = {
        total: 0,
        opened: 0,
        closed: 0,
        active: 0,
        queued: 0,
        urls: []
    };
    this.responses = {
        codes: { 0: 0, 200: 0 },
        ttfb: []
    }
    this.timestamp = timestamp || Date.now();
    this.bandwidth = 0;
}
exports.Client = Client;