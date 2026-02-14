import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = process.env.DB_PATH || path.join(__dirname, 'casino.db');

const dbPromise = open({
  filename: dbPath,
  driver: sqlite3.Database,
});

const parseInventory = (raw) => {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const initDb = async (initialBalance) => {
  const db = await dbPromise;

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id TEXT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      balance INTEGER NOT NULL DEFAULT ${Number(initialBalance) || 1000},
      inventory_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_users_updated_at ON users(updated_at);
  `);
};

export const getUserByTelegramId = async (telegramId) => {
  const db = await dbPromise;
  const row = await db.get('SELECT * FROM users WHERE telegram_id = ?', telegramId);

  if (!row) {
    return null;
  }

  return {
    telegramId: row.telegram_id,
    balance: Number(row.balance) || 0,
    inventory: parseInventory(row.inventory_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export const upsertTelegramUser = async (user, initialBalance) => {
  const db = await dbPromise;
  const telegramId = String(user.id);

  await db.run(
    `
    INSERT INTO users (telegram_id, username, first_name, last_name, balance, inventory_json)
    VALUES (?, ?, ?, ?, ?, '[]')
    ON CONFLICT(telegram_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      updated_at = CURRENT_TIMESTAMP
    `,
    telegramId,
    user.username || null,
    user.first_name || null,
    user.last_name || null,
    Number(initialBalance) || 1000,
  );

  return getUserByTelegramId(telegramId);
};

export const updateUserState = async (telegramId, balance, inventory) => {
  const db = await dbPromise;
  const inventoryJson = JSON.stringify(Array.isArray(inventory) ? inventory : []);

  await db.run(
    `
    UPDATE users
    SET balance = ?, inventory_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE telegram_id = ?
    `,
    Number(balance) || 0,
    inventoryJson,
    String(telegramId),
  );

  return getUserByTelegramId(String(telegramId));
};

export const getDbPath = () => dbPath;

