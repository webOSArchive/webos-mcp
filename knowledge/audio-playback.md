# Audio Playback: `<audio>` Limits and Streaming Through gst-launch From a JS Service

How to play audio a web app's `<audio>` element can't: modern TLS streams, AAC/MP4, and HLS. The working pattern is a JS service (see `js-services.md`) that fetches with `curl` and plays through its own `gst-launch-0.10` pipeline. It is proven in two apps that ship it:

- **SoundCloud Player** ([alan-morford/soundcloudplayer](https://github.com/alan-morford/soundcloudplayer), 4.5.0) — VOD: AAC in fragmented MP4 over HLS, with pause, seek and position. `SCAudioService.js` and `fmp4-adts.js` are the reference implementation for this page.
- **MLB At Bat 11** ([alan-morford/mlbatbat11](https://github.com/alan-morford/mlbatbat11)) — live radio: ADTS AAC over HLS. Its pattern was adapted from Jukie ([achunt2143/jukie](https://github.com/achunt2143/jukie)).

**Verified on:** a TouchPad Go (`deviceInfo.platformVersion` 3.0.5, running LunaCE 4.9.10, with the community TLS 1.3 packages), 2026-10. Parts were also seen on a 9.7" TouchPad. Treat anything marked *Go only* as unconfirmed elsewhere.

---

## What `<audio>` Can and Can't Play

`<audio>` goes through the stock media server (`com.palm.mediad` → a playbin pipeline). It is far more limited than the GStreamer that ships on the device:

| Source | Result | Where seen |
|---|---|---|
| AAC/MP4 (`.m4a`, fragmented MP4) | **Fails** — "Failed to get a pipeline" | Teams connector (`synergy-messaging-connectors.md`). SoundCloud Player relied on this and didn't retest it. |
| Any https URL to a TLS 1.2+ host | **Fails** — `MEDIA_ERR_DECODE`. The TLS packages deliberately keep the media pipeline on the old TLS stack | SoundCloud Player, 9.7" TouchPad |
| Local `file://` mp3, 44.1 kHz | Played | SoundCloud Player, 9.7" TouchPad |
| Direct mp3 | Failed with a decode error (attributed to the missing `audioresample` element) | MLB At Bat 11 |

The two mp3 rows disagree. One explanation fits both: playbin lacks `audioresample`, so only sources that need no rate conversion get through. Either way, don't build on `<audio>` for anything beyond a local 44.1 kHz mp3.

`gst-launch-0.10` on the same device has `aacparse`, `ffdec_aac`, `mpegaudioparse`, `ffdec_mp3`, `qtdemux`, `decodebin`, `fdsrc` and `pulsesink` (`gst-inspect-0.10`). `souphttpsrc` is reported both as absent (`synergy-music-connectors.md`) and as present but aborting at init in a service jail, which has no `/dev/random` (MLB At Bat 11). Either way, **network input comes from curl**.

---

## A Jailed JS Service Can Run gst-launch

`synergy-music-connectors.md` shows a root daemon doing `curl | gst-launch`. An ordinary JS service in the jail can do it too. Spawn gst-launch and write audio to its stdin:

```javascript
var cp = IMPORTS.require('child_process');
var GST = '/usr/bin/gst-launch-0.10';

// "name=scplayer" is a harmless element name used as a marker, so strays can be
// found and killed later without touching another app's gst-launch.
var gst = cp.spawn(GST, ['fdsrc', 'name=scplayer', 'fd=0', '!', 'decodebin', '!',
                         'audioconvert', '!', 'pulsesink']);

gst.stdout.on('data', function (d) {
    // gst-launch prints "Setting pipeline to PLAYING ..." once audio is flowing.
    if (String(d).indexOf('to PLAYING') > -1) { /* playback has started */ }
});
gst.on('exit', function (code) {
    // After you end() stdin, exit code 0 means the stream played to the end.
});
gst.stdin.write(bufferOfAudio);   // ADTS AAC or mp3 frames
```

- **Feed it through stdin (`fdsrc fd=0`), not a named FIFO.** `filesrc` on a FIFO sees size 0 and fails ("Can't typefind empty stream"), and busybox has no `mkfifo` anyway. `cp.spawn` already gives you an anonymous pipe.
- **End of track:** call `stdin.end()` after the last data. gst-launch then exits **0** at end of stream, which is a reliable "track finished" signal (*Go only*).
- **Startup:** about 2.5–3 s from request to PLAYING, including fetching the playlist and first segment (*Go only*). CPU use is about 16% of one core while decoding 160 kbps AAC.
- **Output device:** the PulseAudio sink is `pcm_output` (`pactl list sinks short`). Per-stream volume: find the gst process's sink-input in `pactl list sink-inputs` (match `application.process.id`), then `pactl set-sink-input-volume <idx> <0..65536>`.

---

## HLS With Fragmented MP4 (CMAF): Repackage to ADTS

Many services now serve audio HLS as fragmented MP4: an `#EXT-X-MAP` `init.mp4` plus `.m4s` segments. SoundCloud has done this for almost every track since October 2026. Segments like that can't simply be concatenated into a pipe. **Repackage each segment as ADTS:** copy the AAC frames unchanged and give each one a 7-byte header. ADTS concatenates cleanly, so segments stream one at a time with no container state.

1. **Once per track, from `init.mp4`:** walk `moov/trak/mdia/minf/stbl/stsd/mp4a/esds` to the AudioSpecificConfig (descriptor tag 5). Read the object type (5 bits), the sample-rate index (4 bits) and the channel configuration (4 bits). Refuse `enca` (encrypted).
2. **Per segment:** for each `moof/traf`, read `tfhd` (flags, optional base offset, default sample size) and each `trun` (signed data offset, per-sample sizes). Sample data starts at the `moof` box's own offset plus the data offset.
3. **For each sample**, write a 7-byte ADTS header, then the sample bytes:

```javascript
// frameLen includes the 7-byte header; profile = objectType - 1 (AAC-LC = 1)
out[0] = 0xFF;  out[1] = 0xF1;                       // sync word, MPEG-4, no CRC
out[2] = (profile << 6) | (freqIndex << 2) | (channels >> 2);
out[3] = ((channels & 3) << 6) | (frameLen >> 11);
out[4] = (frameLen >> 3) & 0xFF;
out[5] = ((frameLen & 7) << 5) | 0x1F;
out[6] = 0xFC;
```

The reference implementation ([`fmp4-adts.js`](https://github.com/alan-morford/soundcloudplayer/blob/main/app/com.cmcs.playersoundcloud.service/fmp4-adts.js), about 200 lines) runs on the service's **Node 0.4**. That means no `Buffer.readUInt32BE` (added in 0.5.5) and no `Buffer.concat` (0.8), so bytes are read by hand. On 7 SoundCloud tracks its output was **byte-identical to `ffmpeg -c copy -f adts`**. Raw fMP4 piped into `qtdemux` was never tried, so the repackaging may not be strictly necessary, but it is known to work.

---

## Streaming, Not Downloading

Download one segment at a time to disk, and stay only a few segments ahead of what gst has consumed:

- Write a segment with `gst.stdin.write(buf)`. It returns `false` when Node has to queue data; wait for stdin's **`'drain'`** event before writing the next. `'drain'` only fires once gst has actually read the data. A paused or slow pipeline therefore stops the downloader too, so an hour-long DJ mix uses no more memory or disk than a song.
- Keep about 3 segments (about 30 s) downloaded ahead of the writer. When `'drain'` fires, the pipe still holds a few seconds of audio, so the next write is never late.
- Write segments to `/media/internal` using a flat dotfile prefix. `/tmp` is a small tmpfs, and `mkdirSync` fails in the jail (`js-services.md`).
- One curl per segment costs about 1.2 s of TLS handshake on the device, which is fine against 10-second segments. Use **curl, not Node's http**, for the jail's TLS reasons (`tls-and-networking.md`).

---

## Controls

| Control | How | Notes |
|---|---|---|
| **Pause / resume** | `kill -STOP` / `kill -CONT` on gst-launch | Resume is clean, with no stutter or repeat (*Go only*). **Don't** `pactl suspend-sink` (see below). |
| **Position** | Wall-clock time in PLAYING, minus pauses, plus the start offset | gst-launch has no position query. |
| **Seek** | Kill the pipeline and restart it at the segment containing the target | Lands on a segment boundary. Keep the parsed playlist so a seek doesn't refetch it. |
| **Pause before audio starts** | Remember it, and apply it when PLAYING is seen | Otherwise a pause tapped in the first seconds is dropped and the track starts anyway. |
| **Volume** | `pactl set-sink-input-volume` on gst's sink-input | Retry briefly: the sink-input appears a moment after PLAYING. |

### Don't pause with `pactl suspend-sink`

MLB At Bat 11 pauses with `pactl suspend-sink pcm_output 1` plus SIGSTOP. **Every sound on the device goes through `pcm_output`.** `palerts`, `pnotifications`, `pfeedback` and the other per-role sinks are null-sinks routed into it, so suspending it silences notifications, keyboard clicks and every other app for as long as playback stays paused. A service that died while paused would leave it suspended. SIGSTOP on gst-launch alone pauses cleanly. As a precaution, a service can run `pactl suspend-sink pcm_output 0` at startup.

### Signal children through `/bin/sh`, not `child.kill()`

In the service jail, `ChildProcess.kill('SIGSTOP')` worked, but **`kill('SIGCONT')` and `kill('SIGKILL')` silently did nothing** (*Go only*). A "killed" gst-launch kept running, so a seek left two pipelines playing over each other. Send signals through the shell instead, continuing before killing so a paused process doesn't stay frozen:

```javascript
cp.spawn('/bin/sh', ['-c', 'kill -CONT ' + pid + '; kill -9 ' + pid]);
```

To clean up anything that slipped through (or survived a service restart), kill by marker: ``for p in `ps ax | grep 'name=scplaye[r]' | awk '{print $1}'`; do kill -CONT $p; kill -9 $p; done``. Spare the pid you just spawned; the reap is asynchronous and can race it.

---

## Making It Look Like `<audio>` to the App

The app can keep its existing player UI by wrapping the service in an object with the same surface as its old audio object: `play`/`pause`/`resume`/`paused`, `position`/`setPosition`, `setVolume`, `destruct`, and the progress and finish callbacks. The object polls a status command about every 500 ms and advances the position locally between polls. Two details:

- **Debounce seeks.** Scrubbing calls `setPosition` on every move, and each seek restarts gst.
- **Guard stops with a generation number.** Luna calls from separate `PalmServiceBridge` instances aren't ordered, so an old track's `stop` can arrive *after* the next track's `play`. Tag each stream with a generation number and ignore stale stops.

The pipeline runs in the service's process, not the app's, so it outlives the card. Stop it explicitly in the app window's `unload` handler.

---

## See Also

- `webos://knowledge/js-services` — writing, packaging and registering the service itself
- `webos://knowledge/tls-and-networking` — why curl, and why `<audio>` can't reach modern https
- `webos://knowledge/synergy-music-connectors` — the root-daemon variant (`curl | gst-launch` from an upstart job)
- `webos://knowledge/system-features` — notification-area dashboards for playback controls
