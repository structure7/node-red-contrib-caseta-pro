'use strict';

// Pure, dependency-free helpers for the Lutron Integration Protocol (LIP).
//
// Everything here is side-effect-free: no sockets, no timers, no Node-RED. The
// node files (caseta-bridge / caseta-in / caseta-out) own all I/O, state, and
// timers and call into these functions. Keeping the protocol logic pure makes it
// directly unit-testable (see test/protocol_spec.js) without standing up a fake
// telnet server.

// Strip the bridge's "GNET> " prompt (which can appear mid-line) and any control
// characters, then trim. Applied to each newline-terminated line before parsing.
function cleanLine(line) {
    return String(line)
        .replace(/GNET>\s*/g, '')
        // Stripping control chars is the intent here, hence the disable.
        // eslint-disable-next-line no-control-regex
        .replace(/[\r\x00-\x1f]/g, '')
        .trim();
}

// Parse one cleaned LIP response line into an event object, or null if the line
// is not a recognised/emittable response.
//
// Returns one of:
//   { type:'output', id, level, raw }            // ~OUTPUT level report (action 1)
//   { type:'device', id, component, action, raw }// ~DEVICE button event
//   { type:'group',  id, action, state, raw }    // ~GROUP occupancy event
//   { type:'error',  raw }                        // ~ERROR (bridge rejected a command)
//   { type:'unknown', raw }                       // any other ~-prefixed response
//   null                                          // ~OUTPUT non-level/invalid, or non-~ line
//
// Callers coalesce 'output' events (bursty during a dim gesture); all other
// types are emitted as-is.
function parseLine(line) {
    const parts = String(line).split(',');
    const head = parts[0];

    if (head === '~OUTPUT') {
        const id = parseInt(parts[1], 10);
        const action = parseInt(parts[2], 10);
        const level = parseFloat(parts[3]);
        // Action 1 = "output level"; ignore other actions (e.g. raise/lower start/stop)
        // and malformed reports.
        if (action === 1 && !isNaN(id) && !isNaN(level)) {
            return { type: 'output', id: id, level: level, raw: line };
        }
        return null;
    }
    if (head === '~DEVICE') {
        return {
            type: 'device',
            id: parseInt(parts[1], 10),
            component: parseInt(parts[2], 10),
            action: parseInt(parts[3], 10),
            raw: line
        };
    }
    if (head === '~GROUP') {
        return {
            type: 'group',
            id: parseInt(parts[1], 10),
            action: parseInt(parts[2], 10),
            state: parseInt(parts[3], 10),
            raw: line
        };
    }
    if (head === '~ERROR') {
        return { type: 'error', raw: line };
    }
    // Unrecognised ~-response — surface it rather than drop it silently.
    if (head.charAt(0) === '~') {
        return { type: 'unknown', raw: line };
    }
    return null;
}

// Build a routable topic for an event: caseta/<type>/<id>. The id is omitted when
// absent (e.g. error/unknown), giving caseta/error and caseta/unknown. Including
// the type disambiguates the separate zone (output) vs device id namespaces.
function topicFor(evt) {
    let t = 'caseta/' + evt.type;
    if (evt.id != null && !isNaN(evt.id)) { t += '/' + evt.id; }
    return t;
}

// Build a "#OUTPUT,<id>,1,<level>[,<fade>[,<delay>]]" command from one item, or
// null if it lacks the required id/level. delay is only appended when a fade is
// also present (LIP positional args); a delay without a fade is dropped here — the
// caller may warn about it.
function buildCommand(item) {
    if (!item || item.id == null || item.level == null) { return null; }
    let cmd = '#OUTPUT,' + item.id + ',1,' + item.level;
    if (item.fade != null) {
        cmd += ',' + item.fade;
        if (item.delay != null) { cmd += ',' + item.delay; }
    }
    return cmd;
}

// True when an item carries a delay but no fade — the delay will be dropped by
// buildCommand, so the caller can warn. (Only meaningful for otherwise-valid items.)
function delayWithoutFade(item) {
    return !!item && item.id != null && item.level != null &&
        item.fade == null && item.delay != null;
}

module.exports = { cleanLine, parseLine, topicFor, buildCommand, delayWithoutFade };
