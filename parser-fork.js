var { Parser } = require('./parser.js');
var parser = new Parser();
process.on('message', async obj => {
    obj = JSON.parse(obj);
    switch (obj.type) {
        case 'parse':
            obj.content = await Promise.all(obj.content.map(c => parser.parse(c)));
            process.send(JSON.stringify(obj.content));
            break;
        case 'setup':
            parser.setParseMethod(obj.method)
            break;
    }
});