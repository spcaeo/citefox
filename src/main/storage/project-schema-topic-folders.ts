import type { Migration } from './migrate'

/**
 * Project migration 050: topic folders (the Topics dashboard's Folder › Topic tree).
 *
 * - `topic_folders`: the folders the user made. Names are unique, ignoring case.
 * - `topics.folder_id`: the folder a topic sits in. Null is "No folder", where every
 *   topic made before 050 and every new topic lands. Deleting a folder sends its
 *   topics back to "No folder" (the storage code clears them; the foreign key is a
 *   second guard when foreign keys are on).
 *
 * Page groups (`groups`, `group_pages`, migration 018) stay for pages only: they show
 * on Pages and in reports, so topic folders are kept apart from them.
 */
export const TOPIC_FOLDERS_VERSION = 50

export const TOPIC_FOLDERS_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: TOPIC_FOLDERS_VERSION,
    name: `${String(TOPIC_FOLDERS_VERSION).padStart(3, '0')}_topic_folders`,
    up(db) {
      db.exec(`
        CREATE TABLE topic_folders (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL COLLATE NOCASE UNIQUE
            CHECK (length(name) BETWEEN 1 AND 80),
          created_at TEXT NOT NULL CHECK (length(created_at) > 0)
        );
        ALTER TABLE topics ADD COLUMN folder_id TEXT
          REFERENCES topic_folders (id) ON DELETE SET NULL;
        CREATE INDEX topics_folder ON topics (folder_id);
      `)
    }
  }
]
