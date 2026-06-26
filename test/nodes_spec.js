'use strict';

const assert = require('assert');
const helper = require('node-red-node-test-helper');

const bridgeNode = require('../caseta/caseta-bridge.js');
const inNode = require('../caseta/caseta-in.js');
const outNode = require('../caseta/caseta-out.js');

helper.init(require.resolve('node-red'));

// These tests exercise the Node-RED wiring/contract of the nodes without a real
// bridge: the config node is given an empty host so it never opens a socket
// (it just creates its event bus and reports "no host configured").
describe('caseta nodes (wiring)', function () {
    before(function (done) { helper.startServer(done); });
    after(function (done) { helper.stopServer(done); });
    afterEach(function () { helper.unload(); });

    it('registers all three node types', function (done) {
        const flow = [{ id: 'b1', type: 'caseta-bridge', name: 'b', host: '' }];
        helper.load([bridgeNode, inNode, outNode], flow, function () {
            assert.ok(helper.getNode('b1'), 'caseta-bridge node should load');
            done();
        });
    });

    it('caseta-in emits a bridge event as { topic, payload }', function (done) {
        const flow = [
            { id: 'b1', type: 'caseta-bridge', name: 'b', host: '' },
            { id: 'n1', type: 'caseta-in', name: 'in', bridge: 'b1', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        helper.load([bridgeNode, inNode], flow, function () {
            const b1 = helper.getNode('b1');
            const h1 = helper.getNode('h1');
            h1.on('input', function (msg) {
                try {
                    assert.strictEqual(msg.topic, 'caseta/output/6');
                    assert.strictEqual(msg.payload.id, 6);
                    assert.strictEqual(msg.payload.level, 100);
                    done();
                } catch (e) { done(e); }
            });
            // Simulate the bridge surfacing a parsed event on its bus.
            b1.bus.emit('event', { type: 'output', id: 6, level: 100, raw: '~OUTPUT,6,1,100' });
        });
    });

    it('caseta-out forwards a built command to bridge.sendCommand', function (done) {
        const flow = [
            { id: 'b1', type: 'caseta-bridge', name: 'b', host: '' },
            { id: 'n1', type: 'caseta-out', name: 'out', bridge: 'b1' }
        ];
        helper.load([bridgeNode, outNode], flow, function () {
            const b1 = helper.getNode('b1');
            const n1 = helper.getNode('n1');
            const sent = [];
            b1.sendCommand = function (cmd) { sent.push(cmd); };
            n1.receive({ payload: { id: 26, level: 50 } });
            setImmediate(function () {
                try {
                    assert.deepStrictEqual(sent, ['#OUTPUT,26,1,50']);
                    done();
                } catch (e) { done(e); }
            });
        });
    });

    it('caseta-out accepts an array payload (scene)', function (done) {
        const flow = [
            { id: 'b1', type: 'caseta-bridge', name: 'b', host: '' },
            { id: 'n1', type: 'caseta-out', name: 'out', bridge: 'b1' }
        ];
        helper.load([bridgeNode, outNode], flow, function () {
            const b1 = helper.getNode('b1');
            const n1 = helper.getNode('n1');
            const sent = [];
            b1.sendCommand = function (cmd) { sent.push(cmd); };
            n1.receive({ payload: [{ id: 1, level: 100 }, { id: 2, level: 0, fade: 2 }] });
            setImmediate(function () {
                try {
                    assert.deepStrictEqual(sent, ['#OUTPUT,1,1,100', '#OUTPUT,2,1,0,2']);
                    done();
                } catch (e) { done(e); }
            });
        });
    });
});
