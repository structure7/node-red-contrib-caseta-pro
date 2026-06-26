'use strict';

const assert = require('assert');
const protocol = require('../caseta/protocol');

describe('protocol.cleanLine', function () {
    it('strips a leading GNET> prompt and trailing CR', function () {
        assert.strictEqual(protocol.cleanLine('GNET> ~OUTPUT,6,1,100.00\r'), '~OUTPUT,6,1,100.00');
    });
    it('strips a GNET> prompt that appears mid-line', function () {
        assert.strictEqual(protocol.cleanLine('~OUTPUT,6,1,GNET> 100.00'), '~OUTPUT,6,1,100.00');
    });
    it('strips control characters and trims', function () {
        assert.strictEqual(protocol.cleanLine('\x00 ~ERROR,Enum \x01 '), '~ERROR,Enum');
    });
    it('returns empty string for a prompt-only line', function () {
        assert.strictEqual(protocol.cleanLine('GNET> '), '');
    });
});

describe('protocol.parseLine', function () {
    it('parses an ~OUTPUT level report (action 1)', function () {
        assert.deepStrictEqual(protocol.parseLine('~OUTPUT,6,1,100.00'),
            { type: 'output', id: 6, level: 100, raw: '~OUTPUT,6,1,100.00' });
    });
    it('parses a zero level', function () {
        assert.deepStrictEqual(protocol.parseLine('~OUTPUT,6,1,0.00'),
            { type: 'output', id: 6, level: 0, raw: '~OUTPUT,6,1,0.00' });
    });
    it('ignores ~OUTPUT actions other than 1', function () {
        assert.strictEqual(protocol.parseLine('~OUTPUT,6,2,'), null);
    });
    it('ignores a malformed ~OUTPUT (non-numeric id)', function () {
        assert.strictEqual(protocol.parseLine('~OUTPUT,x,1,50'), null);
    });
    it('parses a ~DEVICE button event', function () {
        assert.deepStrictEqual(protocol.parseLine('~DEVICE,4,2,3'),
            { type: 'device', id: 4, component: 2, action: 3, raw: '~DEVICE,4,2,3' });
    });
    it('parses a ~GROUP occupancy event', function () {
        assert.deepStrictEqual(protocol.parseLine('~GROUP,12,3,3'),
            { type: 'group', id: 12, action: 3, state: 3, raw: '~GROUP,12,3,3' });
    });
    it('parses a ~ERROR line', function () {
        assert.deepStrictEqual(protocol.parseLine('~ERROR,Enum=(1, 0x00000001)'),
            { type: 'error', raw: '~ERROR,Enum=(1, 0x00000001)' });
    });
    it('surfaces an unrecognised ~-response as unknown', function () {
        assert.deepStrictEqual(protocol.parseLine('~SYSTEM,4'),
            { type: 'unknown', raw: '~SYSTEM,4' });
    });
    it('returns null for a non-~ line', function () {
        assert.strictEqual(protocol.parseLine('GNET>'), null);
    });
    it('returns null for an empty line', function () {
        assert.strictEqual(protocol.parseLine(''), null);
    });
});

describe('protocol.topicFor', function () {
    it('builds caseta/<type>/<id> for an id-bearing event', function () {
        assert.strictEqual(protocol.topicFor({ type: 'output', id: 6 }), 'caseta/output/6');
        assert.strictEqual(protocol.topicFor({ type: 'device', id: 4 }), 'caseta/device/4');
        assert.strictEqual(protocol.topicFor({ type: 'group', id: 12 }), 'caseta/group/12');
    });
    it('omits the id when absent (error/unknown)', function () {
        assert.strictEqual(protocol.topicFor({ type: 'error' }), 'caseta/error');
        assert.strictEqual(protocol.topicFor({ type: 'unknown' }), 'caseta/unknown');
    });
    it('omits a non-numeric id', function () {
        assert.strictEqual(protocol.topicFor({ type: 'output', id: NaN }), 'caseta/output');
    });
});

describe('protocol.buildCommand', function () {
    it('builds a basic level command', function () {
        assert.strictEqual(protocol.buildCommand({ id: 26, level: 50 }), '#OUTPUT,26,1,50');
    });
    it('builds level 0 (off) — level 0 is valid, not missing', function () {
        assert.strictEqual(protocol.buildCommand({ id: 26, level: 0 }), '#OUTPUT,26,1,0');
    });
    it('appends a fade', function () {
        assert.strictEqual(protocol.buildCommand({ id: 26, level: 100, fade: 2 }), '#OUTPUT,26,1,100,2');
    });
    it('appends fade and delay', function () {
        assert.strictEqual(protocol.buildCommand({ id: 26, level: 100, fade: 2, delay: 5 }),
            '#OUTPUT,26,1,100,2,5');
    });
    it('drops a delay given without a fade', function () {
        assert.strictEqual(protocol.buildCommand({ id: 26, level: 50, delay: 5 }), '#OUTPUT,26,1,50');
    });
    it('returns null when id is missing', function () {
        assert.strictEqual(protocol.buildCommand({ level: 50 }), null);
    });
    it('returns null when level is missing', function () {
        assert.strictEqual(protocol.buildCommand({ id: 26 }), null);
    });
    it('returns null for null/undefined input', function () {
        assert.strictEqual(protocol.buildCommand(null), null);
        assert.strictEqual(protocol.buildCommand(undefined), null);
    });
});

describe('protocol.delayWithoutFade', function () {
    it('is true for a valid item with delay but no fade', function () {
        assert.strictEqual(protocol.delayWithoutFade({ id: 26, level: 50, delay: 5 }), true);
    });
    it('is false when a fade is also present', function () {
        assert.strictEqual(protocol.delayWithoutFade({ id: 26, level: 50, fade: 2, delay: 5 }), false);
    });
    it('is false with no delay', function () {
        assert.strictEqual(protocol.delayWithoutFade({ id: 26, level: 50 }), false);
    });
    it('is false for an invalid item (missing id/level)', function () {
        assert.strictEqual(protocol.delayWithoutFade({ delay: 5 }), false);
        assert.strictEqual(protocol.delayWithoutFade(null), false);
    });
});
