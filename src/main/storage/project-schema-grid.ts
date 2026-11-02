import type { Migration } from './migrate'

/**
 * Project migration 019: the data grid's saved views (SRS section 10
 * `saved_views`: id, grid, name, state_json) and All pages' ignored citations.
 */
export const GRID_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: 19,
    name: '019_saved_views_and_ignored_citations',
    up(db) {
      // FR-21.2. One row per saved view. `grid` is the grid id, such as
      // `all-pages`. Names are unique per grid. `state_json` is GridViewState.
      // `created_at` and `updated_at` are ISO-8601 UTC and are not in the SRS
      // column list; they order the menu and show when a view changed.
      //
      // FR-20.5. `ignored_cited_urls` is an approved extra: the own URLs the user
      // chose to Ignore in "Your pages cited but not tracked". One row per
      // normalized URL; Undo deletes the row.
      db.exec(`
        CREATE TABLE saved_views (
          id TEXT PRIMARY KEY,
          grid TEXT NOT NULL,
          name TEXT NOT NULL,
          state_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (length(id) > 0),
          CHECK (length(grid) BETWEEN 1 AND 64),
          CHECK (length(name) BETWEEN 1 AND 80),
          CHECK (json_valid(state_json) AND json_type(state_json) = 'object'),
          CHECK (length(created_at) > 0),
          CHECK (length(updated_at) > 0),
          UNIQUE (grid, name)
        );

        CREATE INDEX idx_saved_views_grid ON saved_views (grid, created_at);

        CREATE TABLE ignored_cited_urls (
          normalized_url TEXT PRIMARY KEY,
          url TEXT NOT NULL,
          ignored_at TEXT NOT NULL,
          CHECK (length(normalized_url) > 0),
          CHECK (length(url) BETWEEN 1 AND 2000),
          CHECK (length(ignored_at) > 0)
        );
      `)
    }
  }
]
