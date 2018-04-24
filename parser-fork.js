var { Parser } = require('./parser.js');
var parser = new Parser();
process.on('message', (obj) => {
    obj = JSON.parse(obj);
    switch (obj.type) {
        case 'parse':
            obj.content = obj.content.map(c => parser.parse(c))
            process.send(JSON.stringify(obj.content));
            break;
        case 'setup':
            parser.setParseMethod(obj.method)
            break;
    }
});