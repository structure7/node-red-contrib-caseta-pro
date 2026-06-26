module.exports = function (RED) {
    'use strict';

    const protocol = require('./protocol');

    function CasetaInNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const bridge = RED.nodes.getNode(config.bridge);

        if (!bridge || !bridge.bus) {
            node.status({ fill: 'red', shape: 'ring', text: 'no bridge configured' });
            return;
        }

        // Emit every hub event; downstream flows filter as needed. The topic is
        // caseta/<type>/<id> (see protocol.topicFor) so a switch/MQTT node can route.
        function onEvent(evt) {
            node.send({ topic: protocol.topicFor(evt), payload: evt });
        }
        function onStatus(s) {
            node.status(s);
        }

        bridge.bus.on('event', onEvent);
        bridge.bus.on('status', onStatus);

        // Reflect the bridge's current status immediately on (re)deploy.
        if (bridge.lastStatus) {
            node.status(bridge.lastStatus);
        }

        node.on('close', function () {
            bridge.bus.removeListener('event', onEvent);
            bridge.bus.removeListener('status', onStatus);
        });
    }

    RED.nodes.registerType('caseta-in', CasetaInNode);
};
