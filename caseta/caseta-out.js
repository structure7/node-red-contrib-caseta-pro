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

        node.on('input', function (msg, send, done) {
            const p = msg.payload || {};
            // id may legitimately be 0? Zone IDs start at 1, but guard on null/undefined only.
            if (p.id == null || p.level == null) {
                node.error('caseta-out: msg.payload must include { id, level }', msg);
                if (done) { done(); }
                return;
            }

            // #OUTPUT,<id>,1,<level>[,<fade>[,<delay>]]
            let cmd = '#OUTPUT,' + p.id + ',1,' + p.level;
            if (p.fade != null) {
                cmd += ',' + p.fade;
                if (p.delay != null) {
                    cmd += ',' + p.delay;
                }
            } else if (p.delay != null) {
                node.warn('caseta-out: delay ignored — it requires a fade value too');
            }

            bridge.sendCommand(cmd);
            flashSent('Sent: id ' + p.id + ' → ' + p.level + '%');
            if (done) { done(); }
        });

        node.on('close', function () {
            if (revertTimer) { clearTimeout(revertTimer); }
            bridge.bus.removeListener('status', onStatus);
        });
    }

    RED.nodes.registerType('caseta-out', CasetaOutNode);
};
