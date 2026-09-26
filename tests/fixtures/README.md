# Director preview fixture

`director-preview.mp4` is a synthetic blue grid, generated locally for browser tests. It is one second of 320 × 180 H.264 video at 24 fps, without audio. No user media or provider requests are involved.

Generated with:

```sh
ffmpeg -f lavfi -i 'color=c=0x486da6:s=320x180:r=24:d=1' \
  -vf 'drawgrid=width=64:height=60:thickness=2:color=white@0.4' \
  -c:v libx264 -pix_fmt yuv420p -movflags +faststart director-preview.mp4
```

FFmpeg is not required to run the tests; the fixture is checked in.
