const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const root = __dirname;
const dataDir = path.join(root, 'data');
const uploadsDir = path.join(dataDir, 'uploads');
const photosDb = path.join(dataDir, 'photos.json');

function ensureStorage() {
  fs.mkdirSync(uploadsDir, { recursive: true });
  if (!fs.existsSync(photosDb)) {
    fs.writeFileSync(photosDb, '[]', 'utf8');
  }
}

function readPhotos() {
  ensureStorage();
  try {
    return JSON.parse(fs.readFileSync(photosDb, 'utf8'));
  } catch {
    return [];
  }
}

function writePhotos(photos) {
  ensureStorage();
  fs.writeFileSync(photosDb, JSON.stringify(photos, null, 2), 'utf8');
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(buf);
  });
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.json') return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'photo';
}

function parseJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 25 * 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function decodeDataUrl(dataUrl) {
  const match = /^data:(.+?);base64,(.+)$/.exec(dataUrl || '');
  if (!match) throw new Error('Invalid data URL');
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function makePublicPhoto(photo) {
  return {
    id: photo.id,
    title: photo.title,
    date: photo.date,
    place: photo.place,
    note: photo.note || '',
    imageUrl: `/uploads/${photo.fileName}`,
    createdAt: photo.createdAt,
    updatedAt: photo.updatedAt,
  };
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/photos') {
    return send(res, 200, { photos: readPhotos().map(makePublicPhoto) });
  }

  if (req.method === 'POST' && pathname === '/api/photos/batch') {
    const body = await parseJson(req);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return send(res, 400, { error: 'No items provided' });

    const photos = readPhotos();
    const saved = [];
    for (const item of items) {
      if (!item || !item.dataUrl) continue;
      const { mimeType, buffer } = decodeDataUrl(item.dataUrl);
      const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const base = slugify(item.title || item.place || item.date || 'photo');
      const fileName = `${now.slice(0, 10)}-${base}-${id.slice(0, 8)}.${ext}`;
      fs.writeFileSync(path.join(uploadsDir, fileName), buffer);
      const photo = {
        id,
        title: String(item.title || 'Untitled').trim(),
        date: String(item.date || ''),
        place: String(item.place || '').trim(),
        note: String(item.note || '').trim(),
        fileName,
        createdAt: now,
        updatedAt: now,
      };
      photos.unshift(photo);
      saved.push(makePublicPhoto(photo));
    }
    writePhotos(photos);
    return send(res, 200, { photos: saved });
  }

  if (req.method === 'PATCH' && pathname.startsWith('/api/photos/')) {
    const id = pathname.split('/').pop();
    const body = await parseJson(req);
    const photos = readPhotos();
    const index = photos.findIndex((item) => item.id === id);
    if (index < 0) return send(res, 404, { error: 'Not found' });
    photos[index] = {
      ...photos[index],
      title: body.title ?? photos[index].title,
      date: body.date ?? photos[index].date,
      place: body.place ?? photos[index].place,
      note: body.note ?? photos[index].note,
      updatedAt: new Date().toISOString(),
    };
    writePhotos(photos);
    return send(res, 200, { photo: makePublicPhoto(photos[index]) });
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/photos/')) {
    const id = pathname.split('/').pop();
    const photos = readPhotos();
    const index = photos.findIndex((item) => item.id === id);
    if (index < 0) return send(res, 404, { error: 'Not found' });
    const [removed] = photos.splice(index, 1);
    try {
      fs.unlinkSync(path.join(uploadsDir, removed.fileName));
    } catch {}
    writePhotos(photos);
    return send(res, 200, { ok: true });
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  const { pathname } = url.parse(req.url);

  if (pathname.startsWith('/api/')) {
    try {
      const handled = await handleApi(req, res, pathname);
      if (handled !== false) return;
    } catch (err) {
      return send(res, 500, { error: err.message || 'Server error' });
    }
  }

  const fileMap = {
    '/': path.join(root, 'index.html'),
    '/admin': path.join(root, 'admin.html'),
    '/admin.html': path.join(root, 'admin.html'),
  };

  if (pathname.startsWith('/uploads/')) {
    const filePath = path.join(uploadsDir, pathname.replace('/uploads/', ''));
    return serveFile(res, filePath, mimeFor(filePath));
  }

  const filePath = fileMap[pathname] || path.join(root, pathname.replace(/^\//, ''));
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return serveFile(res, filePath, mimeFor(filePath));
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

ensureStorage();
const port = process.env.PORT || 4173;
server.listen(port, () => {
  console.log(`Server running on http://127.0.0.1:${port}`);
});
