const assert = require('assert');
const BITBOXSDK = require('../node_modules/bitbox-sdk/lib/bitbox-sdk').default;
const BITBOX = new BITBOXSDK();

const Slp = require('../lib/slp').Slp;
const scriptUnitTestData = require('../node_modules/slp-unit-test-data/script_tests.json');

let slp = new Slp(BITBOX);

describe('Slp', function() {
    describe('parseSlpOutputScript() -- SLP OP_RETURN Unit Tests', function() {
        scriptUnitTestData.forEach((test, i)=> {
            it(test.msg, () => {
                let script = new Buffer.from(test.script, 'hex');
                let eCode = test.code;
                if(eCode) {
                    assert.throws(function() { slp.parseSlpOutputScript(script) });
                } else {
                    let parsedOutput = slp.parseSlpOutputScript(script);
                    assert(typeof parsedOutput, 'object');
                }
            });
        });
    });
    describe('buildRawGenesisTx()', function() {
        it('works', () => {
            assert.equal(true, false);
        });
    });
    describe('buildRawSendTx()', function() {
        it('works', () => {
            assert.equal(true, false);
        });
    });
    describe('()', function() {
        it('works', () => {
            assert.equal(true, false);
        });
    });
});