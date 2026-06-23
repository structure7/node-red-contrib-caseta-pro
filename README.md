# node-red-contrib-caseta-pro

Node-RED nodes for controlling and monitoring a **Lutron Caséta Smart Bridge Pro**
over the Lutron Integration Protocol (LIP) — raw telnet on port 23.

A clean, maintainable replacement for the abandoned `node-red-contrib-caseta`:

- **Single shared connection** — one config node owns the socket; all flow nodes share it
  (Caséta bridges accept only a few telnet clients, so one connection avoids starving the app).
- **Dynamic device selection** — no per-device nodes. Send `{ id, level }` to control anything.
- **Emit everything** — the input node streams all hub output; downstream flows filter as needed.
- **No dependencies** — uses Node's built-in `net` module.

## Nodes

| Node | Type | Purpose |
|------|------|---------|
| `caseta-bridge` | config | Holds connection settings, owns the socket, shared by all nodes. |
| `caseta-in` | input (0→1) | Emits every hub event (OUTPUT, DEVICE, GROUP, ERROR). |
| `caseta-out` | output (1→0) | Sends commands to control dimmers / switches / fans. |

## Setup

1. Drop a `caseta-in` (or `caseta-out`) onto the canvas and create a new **caseta-bridge** config:
   - **Host** — bridge IP, e.g. `192.168.0.104`
   - **Port** — `23`
   - **Username / Password** — Lutron's LAN defaults `lutron` / `integration` (pre-filled)
   - **Integration Report** — paste the JSON from Lutron's emailed integration report (see below).
2. Deploy. The node status goes grey (connecting) → yellow (logging in) → green (connected).

### Integration report

Paste Lutron's native report JSON as-is. **Zones** are OUTPUT devices (controllable/monitorable);
**Devices** are button senders (Picos, keypads, motion sensors). The report is used to seed
current zone levels on every connect — it's optional; without it the node still connects and
monitors all events, it just skips seeding.

```json
{
  "LIPIdList": {
    "Zones": [
      { "ID": 26, "Name": "Lights", "Area": { "Name": "Tool Room" } }
    ],
    "Devices": [
      { "ID": 4, "Name": "Pico 1", "Area": { "Name": "Living Room" },
        "Buttons": [ { "Number": 2 }, { "Number": 3 } ] }
    ]
  }
}
```

## Usage

### Receiving events — `caseta-in`

Wire `caseta-in` to a debug node. Every hub event arrives as `msg.payload`:

```js
// Zone level changed (app, Pico, schedule, or your own command echo)
{ type: 'output', id: 26, level: 100, raw: '~OUTPUT,26,1,100.00' }

// Button event — action 3 = press, 4 = release (Pico buttons are components 2-6)
{ type: 'device', id: 4, component: 2, action: 3, raw: '~DEVICE,4,2,3' }

// Occupancy — action 3 = occupancy, state 3 = occupied, 4 = unoccupied
{ type: 'group', id: 12, action: 3, state: 3, raw: '~GROUP,12,3,3' }

// Bridge rejected the last command (non-fatal)
{ type: 'error', raw: '~ERROR,Enum=(1, 0x00000001)' }
```

### Sending commands — `caseta-out`

Send a payload with a zone `id` and a `level` (0–100):

```js
msg.payload = {
  id: 26,      // Zone / OUTPUT ID (required)
  level: 50,   // 0-100 (required) — 0 = off, 100 = full
  fade: 2,     // optional: fade time in seconds (or "HH:MM:SS")
  delay: 0     // optional: delay in seconds
}
```

There's no node output — the resulting `~OUTPUT` echo comes back through `caseta-in`.

## Protocol notes

- The bridge re-emits the `GNET> ` prompt after every command, sometimes **mid-line**; the
  parser buffers and strips it before parsing.
- Do **not** send `#MONITORING,255,1` — the Caséta bridge rejects it; events stream automatically.
- Auto-reconnect uses exponential backoff (1s → 30s cap). Wrong credentials fail fast without
  looping (so you don't lock yourself out).

## License

MIT © Michael Kemper
