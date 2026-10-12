# ASCII Realm

A browser game rendered entirely in ASCII characters. Every frame is a grid of
coloured glyphs: grass is made of `/ | \` blades that sway in the wind, water is
streaked with `~ - ≈` ripples and reflects whatever stands on the shore, and the
player is a hooded wanderer drawn from shaded characters.

For now it is a single character walking around procedurally generated terrain.

## Running

No build step. Serve the folder with any static file server and open it:

```sh
python -m http.server 8000
# then open http://localhost:8000
```

## Controls

| Key | Action |
| --- | --- |
| `W A S D` / arrow keys | Walk |
| `Shift` | Run |
