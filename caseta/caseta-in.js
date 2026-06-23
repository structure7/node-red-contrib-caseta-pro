module.exports = function (RED) {
    'use strict';

    function CasetaInNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const bridge = RED.nodes.getNode(config.bridge);

        if (!bridge || !bridge.bus) {
            node.status({ fill: 'red', shape: 'ring', text: 'no bridge configured' });
            return;
        }

        // Build a routable topic: caseta/<type>/<id> (id omitted when absent,
        // e.g. error/unknown). Disambiguates zone vs device id namespaces and
        // lets a switch/MQTT node route on it. Raw id/type stay on the payload.
        function topicFor(evt) {
            let t = 'caseta/' + evt.type;
            if (evt.id != null && !isNaN(evt.id)) { t += '/' + evt.id; }
            return t;
        }

        // Emit every hub event; downstream flows filter as needed.
        function onEvent(evt) {
            node.send({ topic: topicFor(evt), payload: evt });
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
