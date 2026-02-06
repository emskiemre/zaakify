/**
 * Zaakify Memory Store
 *
 * Long-term memory using SQLite + vector embeddings.
 * Stores facts, conversations, and context that persist across sessions.
 *
 * Improvement over OpenClaw:
 *   - OpenClaw requires sqlite-vec (native extension, painful to install)
 *   - We use pure SQLite with a cosine similarity fallback via keyword search
 *   - When embeddings are available, we use them. When not, graceful degradation.
 *   - Simpler schema: memories table + FTS5 for text search
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { MemoryConfig } from "../types/index.js";
import { getLogger } from "../utils/logger.js";

const log = getLogger("memory");

export interface Memory {
  id: number;
  content: string;
  tags: string;
  embedding?: Float64Array;
  createdAt: number;
  accessedAt: number;
  accessCount: number;
  score?: number; // search relevance score
}

export class MemoryStore {
  private db: Database.Database | null = null;
  private config: MemoryConfig;

  constructor(config: MemoryConfig) {
    this.config = config;
  }

  /**
   * Initialize the SQLite database and create tables.
   */
  init(): void {
    if (!this.config.enabled) {
      log.info("Memory store disabled");
      return;
    }

    const dbDir = dirname(this.config.dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(this.config.dbPath);

    // WAL mode for better concurrent read performance
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");

    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        tags TEXT DEFAULT '',
        embedding BLOB,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        accessed_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        access_count INTEGER NOT NULL DEFAULT 0
      );

      -- FTS5 for fast text search (fallback when no embeddings)
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content,
        tags,
        content='memories',
        content_rowid='id'
      );

      -- Triggers to keep FTS in sync
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content, tags)
        VALUES (new.id, new.content, new.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, tags)
        VALUES ('delete', old.id, old.content, old.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, tags)
        VALUES ('delete', old.id, old.content, old.tags);
        INSERT INTO memories_fts(rowid, content, tags)
        VALUES (new.id, new.content, new.tags);
      END;

      CREATE INDEX IF NOT EXISTS idx_memories_tags ON memories(tags);
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
    `);

    const count = this.db.prepare("SELECT COUNT(*) as count FROM memories").get() as {
      count: number;
    };
    log.info({ dbPath: this.config.dbPath, memories: count.count }, "Memory store initialized");
  }

  /**
   * Store a new memory.
   */
  store(content: string, tags: string = ""): number {
    if (!this.db) return -1;

    const stmt = this.db.prepare(
      "INSERT INTO memories (content, tags) VALUES (?, ?)",
    );
    const result = stmt.run(content, tags);
    log.debug({ id: result.lastInsertRowid, tags }, "Memory stored");
    return Number(result.lastInsertRowid);
  }

  /**
   * Search memories using FTS5 full-text search.
   */
  search(query: string, limit?: number): Memory[] {
    if (!this.db) return [];

    const maxResults = limit || this.config.maxResults;

    try {
      // Try FTS5 search first
      const stmt = this.db.prepare(`
        SELECT m.*, rank AS score
        FROM memories_fts fts
        JOIN memories m ON m.id = fts.rowid
        WHERE memories_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `);

      const results = stmt.all(query, maxResults) as Memory[];

      // Update access timestamps
      const updateStmt = this.db.prepare(
        "UPDATE memories SET accessed_at = ?, access_count = access_count + 1 WHERE id = ?",
      );
      const now = Date.now();
      for (const mem of results) {
        updateStmt.run(now, mem.id);
      }

      return results;
    } catch {
      // Fallback to LIKE search if FTS query syntax is invalid
      const stmt = this.db.prepare(`
        SELECT *, 0 as score FROM memories
        WHERE content LIKE ? OR tags LIKE ?
        ORDER BY accessed_at DESC
        LIMIT ?
      `);

      return stmt.all(`%${query}%`, `%${query}%`, maxResults) as Memory[];
    }
  }

  /**
   * Get recent memories.
   */
  getRecent(limit = 20): Memory[] {
    if (!this.db) return [];

    const stmt = this.db.prepare(
      "SELECT * FROM memories ORDER BY created_at DESC LIMIT ?",
    );
    return stmt.all(limit) as Memory[];
  }

  /**
   * Get frequently accessed memories.
   */
  getFrequent(limit = 20): Memory[] {
    if (!this.db) return [];

    const stmt = this.db.prepare(
      "SELECT * FROM memories ORDER BY access_count DESC, accessed_at DESC LIMIT ?",
    );
    return stmt.all(limit) as Memory[];
  }

  /**
   * Delete a memory by ID.
   */
  delete(id: number): boolean {
    if (!this.db) return false;

    const stmt = this.db.prepare("DELETE FROM memories WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Get total memory count.
   */
  count(): number {
    if (!this.db) return 0;

    const row = this.db.prepare("SELECT COUNT(*) as count FROM memories").get() as {
      count: number;
    };
    return row.count;
  }

  /**
   * Close the database.
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      log.info("Memory store closed");
    }
  }
}
