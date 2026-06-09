# Deploy

This project is ready to run as a small Node server.

## Local run

```bash
npm start
```

## Environment variables

- `PORT` - port to bind to. Defaults to `4173`.
- `HOST` - listen host. Defaults to `0.0.0.0`.
- `DATA_DIR` - optional custom directory for photo storage. Defaults to `./data`.

## What gets persisted

- Uploaded image files are stored in `DATA_DIR/uploads`
- Photo metadata is stored in `DATA_DIR/photos.json`

## Admin

- Public gallery: `/`
- Admin panel: `/admin`

## Cloud/VPS notes

This app is deployable on any Node host that supports long-lived files on disk.
If you use a stateless platform, point `DATA_DIR` at a persistent volume.
