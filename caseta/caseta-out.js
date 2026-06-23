module.exports = function (RED) {
    'use strict';

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

        // Build "#OUTPUT,<id>,1,<level>[,<fade>[,<delay>]]" from one item, or null if invalid.
        function buildCmd(it) {
            if (!it || it.id == null || it.level == null) { return null; }
            let cmd = '#OUTPUT,' + it.id + ',1,' + it.level;
            if (it.fade != null) {
                cmd += ',' + it.fade;
                if (it.delay != null) { cmd += ',' + it.delay; }
            } else if (it.delay != null) {
                node.warn('caseta-out: delay ignored for id ' + it.id + ' — needs a fade value too');
            }
            return cmd;
        }

        node.on('input', function (msg, send, done) {
            // Accept a single { id, level, ... } or an array of them. The bridge paces the
            // whole batch (its Cmd spacing) so a multi-light scene won't flood the hub.
            const p = msg.payload;
            const items = Array.isArray(p) ? p : [p];

            const valid = [];
            let skipped = 0;
            items.forEach(function (it) {
                const cmd = buildCmd(it);
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
