import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { getDbPath, getUserByTelegramId, initDb, updateUserState, upsertTelegramUser } from './db.js';

const app = express();
const port = Number(process.env.PORT) || 3001;
const initialBalance = Number(process.env.DEFAULT_BALANCE) || 1000;
const botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const parseTelegramUserFromInitData = (initData) => {
  const params = new URLSearchParams(initData);
  const userRaw = params.get('user');

  if (!userRaw) {
    return null;
  }

  try {
    return JSON.parse(userRaw);
  } catch {
    return null;
  }
};

const verifyTelegramInitData = (initData, token) => {
  if (!token) {
    return false;
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');

  if (!hash) {
    return false;
  }

  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  return expectedHash === hash;
};

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, dbPath: getDbPath() });
});

app.post('/api/session', async (req, res) => {
  try {
    const { user, initData } = req.body || {};

    let resolvedUser = null;

    if (typeof initData === 'string' && initData.length > 0 && botToken) {
      const isValid = verifyTelegramInitData(initData, botToken);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid Telegram initData hash' });
      }
      resolvedUser = parseTelegramUserFromInitData(initData);
    }

    if (!resolvedUser && user && user.id) {
      resolvedUser = user;
    }

    if (!resolvedUser || !resolvedUser.id) {
      return res.status(400).json({ error: 'Telegram user payload is missing' });
    }

    const account = await upsertTelegramUser(resolvedUser, initialBalance);
    return res.json(account);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.get('/api/users/:telegramId', async (req, res) => {
  try {
    const account = await getUserByTelegramId(req.params.telegramId);

    if (!account) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json(account);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.put('/api/users/:telegramId/state', async (req, res) => {
  try {
    const { balance, inventory } = req.body || {};

    if (!Number.isFinite(balance)) {
      return res.status(400).json({ error: 'Balance must be a finite number' });
    }

    const account = await updateUserState(req.params.telegramId, Number(balance), inventory);

    if (!account) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

initDb(initialBalance)
  .then(() => {
    app.listen(port, () => {
      console.log(`API server started on http://localhost:${port}`);
      console.log(`SQLite database: ${getDbPath()}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize database', error);
    process.exit(1);
  });

