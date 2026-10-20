# Diagram sources

The docs show PNGs from `docs/images/`, rendered from these SVGs at 2× so they look the same on every machine and stay sharp on high-DPI screens. SVG text depends on the viewer's fonts; a PNG does not.

To change a diagram, edit its SVG (or, for the data model, `data-model.cjs`, then run it), and re-render:

```bash
chrome --headless=new --hide-scrollbars --force-device-scale-factor=2 \
  --default-background-color=00000000 --window-size=1160,<height> \
  --screenshot=docs/images/<name>.png file:///<repo>/docs/diagrams/<name>.svg
```

Heights: architecture-cloudflare 640, architecture-local 640, cron-jobs 620, request-flow 660, data-model 1000.
