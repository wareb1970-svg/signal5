# Signal 5

Signal 5 is public AI risk intelligence for everyone.

It answers:

1. What changed?
2. Why?
3. Does it matter?
4. How confident are we?

## Version 2

This static MVP includes:

- responsive public dashboard
- six expandable signal categories
- transparent 0–100 risk scale
- key-change feed
- dark/light display toggle
- keyboard-accessible cards
- demonstration data stored in `data.json`

## Run locally

Because the application loads JSON, use a local server:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Important

The current data is illustrative. Live public sources and automated scoring will be connected in a later build.
