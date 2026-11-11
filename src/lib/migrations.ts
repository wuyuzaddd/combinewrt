export interface Migration {
  version: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: "001_init",
    sql: `
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      INSERT INTO app_meta (key, value)
      VALUES ('schema', '1')
      ON CONFLICT (key) DO NOTHING;
    `,
  },
];
