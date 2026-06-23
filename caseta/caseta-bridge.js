module.exports = function (RED) {
    'use strict';

    const net = require('net');
    const EventEmitter = require('events');

    // Login / connection state machine phases
    const PHASE = {
        DISCONNECTED: 'disconnected',
        CONNECTING: 'connecting',
        AWAIT_LOGIN: 'awaitLogin',
        AWAIT_PASSWORD: 'awaitPassword',
        AWAIT_READY: 'awaitReady',
        READY: 'ready'
    };

    const MAX_RECONNECT_DELAY = 30000;  // backoff cap (ms)
    const INITIAL_RECONNECT_DELAY = 1000;
    const COALESCE_MS = 120;            // per-id trailing debounce for ~OUTPUT bursts

    function CasetaBridgeNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.host = (config.host || '').trim();
        node.port = parseInt(config.port, 10) || 23;
        node.username = config.username || 'lutron';
        node.password = config.password || 'integration';

        // Event bus that caseta-in / caseta-out nodes subscribe to.
        // 'event'  → parsed hub events (output/device/group/error/unknown)
        // 'status' → { fill, shape, text } for node status mirroring
        node.bus = new EventEmitter();
        node.bus.setMaxListeners(0); // any number of in/out nodes may attach

        // Parse the pasted integration report (Zones drive seeding).
        node.zones = [];
        node.devices = [];
        if (config.integrationReport && config.integrationReport.trim()) {
            try {
                const report = JSON.parse(config.integrationReport);
                const lip = report.LIPIdList || {};
                node.zones = Array.isArray(lip.Zones) ? lip.Zones : [];
                node.devices = Array.isArray(lip.Devices) ? lip.Devices : [];
            } catch (e) {
                node.warn('caseta-bridge: integration report is not valid JSON — ' +
                    'zone seeding disabled. ' + e.message);
            }
        }

        // Build id→info lookups (Name / Area) for message enrichment.
        node.zoneById = {};
        node.zones.forEach(function (z) { if (z && z.ID != null) { node.zoneById[z.ID] = z; } });
        node.deviceById = {};
        node.devices.forEach(function (d) { if (d && d.ID != null) { node.deviceById[d.ID] = d; } });

        // Owner's custom names (from the Names tab), keyed by id within kind.
        const customNames = { zones: {}, devices: {} };
        if (config.names) {
            try {
                const n = JSON.parse(config.names);
                if (n && typeof n === 'object') {
                    customNames.zones = n.zones || {};
                    customNames.devices = n.devices || {};
                }
            } catch (e) {
                node.warn('caseta-bridge: custom names are not valid JSON — ignoring. ' + e.message);
            }
        }

        // Attach name (custom → Lutron) and area to an event by id, in place.
        function enrich(evt) {
            let info, custom;
            if (evt.type === 'output') {
                info = node.zoneById[evt.id];
                custom = customNames.zones[evt.id];
            } else if (evt.type === 'device' || evt.type === 'group') {
                info = node.deviceById[evt.id];
                custom = customNames.devices[evt.id];
            }
            const name = custom || (info && info.Name);
            const area = info && info.Area && info.Area.Name;
            if (name) { evt.name = name; }
            if (area) { evt.area = area; }
            return evt;
        }

        function emitEvent(evt) {
            node.bus.emit('event', enrich(evt));
        }

        // ---- mutable connection state ----
        let socket = null;
        let phase = PHASE.DISCONNECTED;
        let buffer = '';
        let reconnectDelay = INITIAL_RECONNECT_DELAY;
        let reconnectTimer = null;
        let authFailed = false;   // wrong creds — stop reconnecting (avoid lockout)
        let closing = false;      // node is being redeployed/shut down
        const cmdQueue = [];      // commands queued until READY
        const outputTimers = new Map(); // id -> coalesce timer

        node.lastStatus = { fill: 'grey', shape: 'dot', text: 'initializing' };

        function setStatus(fill, text) {
            node.lastStatus = { fill: fill, shape: 'dot', text: text };
            node.bus.emit('status', node.lastStatus);
        }

        function rawWrite(str) {
            if (socket && !socket.destroyed) {
                try {
                    socket.write(str, 'latin1');
                } catch (e) {
                    node.error('caseta-bridge: socket write failed — ' + e.message);
                }
            }
        }

        // Public: queue a command (no CRLF) until the bridge is ready, then write it.
        // NB: named sendCommand (not send) so we don't clobber Node-RED's node.send().
        node.sendCommand = function (cmd) {
            if (phase === PHASE.READY) {
                rawWrite(cmd + '\r\n');
            } else {
                cmdQueue.push(cmd);
            }
        };

        function flushQueue() {
            while (cmdQueue.length) {
                rawWrite(cmdQueue.shift() + '\r\n');
            }
        }

        function onReady() {
            setStatus('green', 'connected');
            flushQueue();
            // Re-seed current levels for every known zone on each (re)connect.
            node.zones.forEach(function (z) {
                if (z && z.ID != null) {
                    rawWrite('?OUTPUT,' + z.ID + ',1\r\n');
                }
            });
        }

        // Coalesce ~OUTPUT bursts (a dim gesture emits many intermediate floats):
        // emit only the last value after COALESCE_MS of quiet, per id.
        function handleOutput(id, level, raw) {
            if (outputTimers.has(id)) {
                clearTimeout(outputTimers.get(id));
            }
            outputTimers.set(id, setTimeout(function () {
                outputTimers.delete(id);
                emitEvent({ type: 'output', id: id, level: level, raw: raw });
            }, COALESCE_MS));
        }

        function parseLine(line) {
            const parts = line.split(',');
            const head = parts[0];

            if (head === '~OUTPUT') {
                const id = parseInt(parts[1], 10);
                const action = parseInt(parts[2], 10);
                const level = parseFloat(parts[3]);
                if (action === 1 && !isNaN(id) && !isNaN(level)) {
                    handleOutput(id, level, line);
                }
                return;
            }
            if (head === '~DEVICE') {
                emitEvent({
                    type: 'device',
                    id: parseInt(parts[1], 10),
                    component: parseInt(parts[2], 10),
                    action: parseInt(parts[3], 10),
                    raw: line
                });
                return;
            }
            if (head === '~GROUP') {
                emitEvent({
                    type: 'group',
                    id: parseInt(parts[1], 10),
                    action: parseInt(parts[2], 10),
                    state: parseInt(parts[3], 10),
                    raw: line
                });
                return;
            }
            if (head === '~ERROR') {
                emitEvent({ type: 'error', raw: line });
                return;
            }
            // Unrecognised ~-response — surface it rather than drop it silently.
            if (head.charAt(0) === '~') {
                emitEvent({ type: 'unknown', raw: line });
            }
        }

        function onData(chunk) {
            buffer += chunk.toString('latin1');

            // --- Login handshake: prompts arrive with NO trailing newline ---
            if (phase === PHASE.AWAIT_LOGIN && /login:/i.test(buffer)) {
                rawWrite(node.username + '\r\n');
                phase = PHASE.AWAIT_PASSWORD;
                buffer = '';
                return;
            }
            if (phase === PHASE.AWAIT_PASSWORD && /password:/i.test(buffer)) {
                rawWrite(node.password + '\r\n');
                phase = PHASE.AWAIT_READY;
                buffer = '';
                return;
            }
            if (phase === PHASE.AWAIT_READY) {
                // A fresh login: prompt here means our credentials were rejected.
                if (/login:/i.test(buffer)) {
                    onAuthFailed();
                    return;
                }
                if (buffer.includes('GNET>')) {
                    phase = PHASE.READY;
                    reconnectDelay = INITIAL_RECONNECT_DELAY; // reset backoff on success
                    buffer = buffer.replace(/GNET>\s*/g, '');
                    onReady();
                    // fall through to drain any events already buffered
                }
            }

            if (phase !== PHASE.READY) {
                return;
            }

            // --- Process complete, newline-terminated lines ---
            let idx;
            while ((idx = buffer.indexOf('\n')) >= 0) {
                let line = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 1);
                // Strip embedded GNET> prompt (can appear mid-line) and control chars.
                line = line.replace(/GNET>\s*/g, '').replace(/[\r\x00-\x1f]/g, '').trim();
                if (line) {
                    parseLine(line);
                }
            }
            // Keep the residual (partial-line) buffer free of prompt noise.
            buffer = buffer.replace(/GNET>\s*/g, '');
        }

        function onAuthFailed() {
            authFailed = true;
            node.error('caseta-bridge: authentication failed (bad username/password). ' +
                'Not reconnecting — fix credentials and redeploy.');
            setStatus('red', 'auth failed');
            if (socket) {
                socket.destroy();
            }
        }

        function clearReconnect() {
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
        }

        function scheduleReconnect() {
            if (closing || authFailed) {
                return;
            }
            clearReconnect();
            const delay = reconnectDelay;
            setStatus('red', 'reconnecting in ' + Math.round(delay / 1000) + 's');
            reconnectTimer = setTimeout(function () {
                reconnectTimer = null;
                reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
                connect();
            }, delay);
        }

        function connect() {
            if (closing || authFailed) {
                return;
            }
            clearReconnect();
            phase = PHASE.CONNECTING;
            buffer = '';
            setStatus('grey', 'connecting');

            socket = new net.Socket();
            socket.setKeepAlive(true, 30000);

            socket.on('connect', function () {
                phase = PHASE.AWAIT_LOGIN;
                setStatus('yellow', 'logging in');
            });
            socket.on('data', onData);
            socket.on('error', function (err) {
                node.warn('caseta-bridge: socket error — ' + err.message);
                // 'close' fires next and drives reconnect.
            });
            socket.on('close', function () {
                phase = PHASE.DISCONNECTED;
                if (closing || authFailed) {
                    return;
                }
                setStatus('red', 'disconnected');
                scheduleReconnect();
            });

            try {
                socket.connect(node.port, node.host);
            } catch (e) {
                node.warn('caseta-bridge: connect failed — ' + e.message);
                scheduleReconnect();
            }
        }

        // ---- start ----
        if (!node.host) {
            setStatus('red', 'no host configured');
        } else {
            connect();
        }

        // ---- teardown on redeploy / shutdown ----
        node.on('close', function (done) {
            closing = true;
            clearReconnect();
            outputTimers.forEach(function (t) { clearTimeout(t); });
            outputTimers.clear();
            cmdQueue.length = 0;
            if (socket) {
                socket.removeAllListeners();
                socket.destroy();
                socket = null;
            }
            node.bus.removeAllListeners();
            done();
        });
    }

    RED.nodes.registerType('caseta-bridge', CasetaBridgeNode);
};
