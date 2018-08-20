const path = require('path'),
    { URL } = require('./model.js'),
    { fork } = require('child_process');

function Parser(callback) {
    var _this = this,
        _forks = [],
        _queue = [],
        _lb = 0,
        _interval = false,
        _callback = callback,
        _parseMethod = _defaultParseMethod,
        _configuredMethod = null,
        _outstanding = 0,
        _killCommand = false,
        _threads = 0;

    function _defaultParseMethod(href, content) {
        var hrefs = [];
        var regex = /<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1\s*(?:[^>]*?\s+)?(?:rel=(["'])(.*?)\3)?[^>]*>/g;
        var match = regex.exec(content);
        while (match != null) {
            if (!match[4])
                hrefs.push(match[2]);
            match = regex.exec(content);
        }
        return hrefs;
    }
    async function _parse(obj) {
        var start = Date.now();
        obj.hrefs = (await _parseMethod(obj.href, obj.content))
            .map(url => URL(url, obj.href))
            .filter(u => u);
        obj.parseTime = Date.now() - start;
        if (_callback)
            _callback([obj]);
        return obj;
    }
    function _parseFork(obj) {
        if (_killCommand) {
            _parse(obj)
            return;
        }
        _lb--;
        _queue[_lb].push(obj);
        _lb = _lb || _queue.length;
    }
    function _kill() {
        for (let i = _forks.length; i > 0; i--) {
            _forks[i - 1].kill();
            _forks.pop();
            _queue.pop();
        }
        _lb = 0;
    }
    function _handler(m) {
        _outstanding--;
        if (_killCommand && !_outstanding)
            _kill();
        _callback(JSON.parse(m))
    }
    this.parse = _parse;
    this.start = function () {
        if (_threads && !_interval) {
            _killCommand = false;
            _this.fork(_threads);
            _interval = setInterval(() => {
                _queue = _queue.map((q, i) => {
                    _forks[i].send(JSON.stringify({ type: 'parse', content: q }));
                    _outstanding++;
                    return [];
                })
            }, 1000);
        }
    }
    this.stop = function () {
        clearInterval(_interval)
        _interval = false;
        _killCommand = true;
        if (!_outstanding)
            _kill();
    };
    this.fork = function (threads) {
        _threads = threads;
        for (let i = _forks.length; i < threads; i++) {
            _queue[i] = [];
            _forks[i] = fork(path.join(__dirname, 'parser-fork.js'));
            _forks[i].on('message', (m) => _handler(m));
            if (_configuredMethod)
                _forks[i].send(JSON.stringify({ type: 'setup', method: _configuredMethod }));
        }
        for (let i = _forks.length; i > threads; i--) {
            _forks[i - 1].kill();
            _forks.pop();
            _queue.pop();
        }

        if (threads > 0) {
            _lb = _queue.length;
            _this.parse = _parseFork;
        } else {
            _this.parse = _parse;
            _this.stop();
        }
    }
    this.setParseMethod = function (method) {
        if (typeof method == 'function') {
            _parseMethod = method;
            _configuredMethod = method.toString();
        }
        if (typeof method == 'string') {
            _configuredMethod = method;
            _parseMethod = /^function\s*\(/.test(method) ? new Function('return ' + method)() : require(method);
        }
        for (let i = 0; i < _forks.length; i++) {
            _forks[i].send(JSON.stringify({ type: 'setup', method: _configuredMethod }));
        }
    }
}

exports.Parser = Parser;