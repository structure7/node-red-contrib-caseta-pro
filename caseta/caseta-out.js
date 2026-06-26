module.exports = function (RED) {
    'use strict';

    const protocol = require('./protocol');

    function CasetaOutNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const bridge = RED.nodes.getNode(config.bridge);

        if (!bridge || typeof bridge.sendCommand !== 'function') {
            node.status({ fill: 'red', shape: 'ring', text: 'no bridge configured' });
            return;
        }

        function onStatus(s) {
            node.status(s);
        }
        bridge.bus.on('status', onStatus);
        if (bridge.lastStatus) {
            node.status(bridge.lastStatus);
        }

        let revertTimer = null;
        function flashSent(text) {
            node.status({ fill: 'blue', shape: 'dot', text: text });
            if (revertTimer) { clearTimeout(revertTimer); }
            revertTimer = setTimeout(function () {
                node.status(bridge.lastStatus || {});
            }, 1500);
        }

        node.on('input', function (msg, send, done) {
            // Accept a single { id, level, ... } or an array of them. The bridge paces the
            // whole batch (its Cmd spacing) so a multi-light scene won't flood the hub.
            const p = msg.payload;
            const items = Array.isArray(p) ? p : [p];

            const valid = [];
            let skipped = 0;
            items.forEach(function (it) {
                // A delay without a fade can't be expressed in #OUTPUT — warn (it's dropped).
                if (protocol.delayWithoutFade(it)) {
                    node.warn('caseta-out: delay ignored for id ' + it.id + ' — needs a fade value too');
                }
                const cmd = protocol.buildCommand(it);
                if (cmd) { valid.push({ cmd: cmd, id: it.id, level: it.level }); }
                else { skipped++; }
            });

            if (valid.length === 0) {
                node.error('caseta-out: msg.payload must be { id, level } or an array of them', msg);
                if (done) { done(); }
                return;
            }
            if (skipped > 0) {
                node.warn('caseta-out: skipped ' + skipped + ' item(s) missing id/level');
            }

            valid.forEach(function (c) { bridge.sendCommand(c.cmd); });

            flashSent(valid.length === 1 ?
                ('Sent: id ' + valid[0].id + ' → ' + valid[0].level + '%') :
                ('Sent ' + valid.length + ' commands'));
            if (done) { done(); }
        });

        node.on('close', function () {
            if (revertTimer) { clearTimeout(revertTimer); }
            bridge.bus.removeListener('status', onStatus);
        });
    }

    RED.nodes.registerType('caseta-out', CasetaOutNode);
};
