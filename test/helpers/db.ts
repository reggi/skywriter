import {randomUUID} from 'node:crypto'
import {Pool, type PoolClient} from 'pg'
import {config} from 'dotenv'

config()

/**
 * Creates an isolated database context for a test file.
 * Each test file gets its own Pool and PostgreSQL schema,
 * so concurrent test files don't interfere with each other.
 */
export async function createTestContext(): Promise<{client: PoolClient; cleanup: () => Promise<void>}> {
  const connectionString = process.env.DATABASE_URL || 'postgresql://astrodoc:astrodoc_password@localhost:5455/astrodoc'
  const pool = new Pool({connectionString})
  const client = await pool.connect()

  // Create an isolated schema for this test file
  const schemaName = `test_${randomUUID().replace(/-/g, '_')}`
  await client.query(`CREATE SCHEMA ${schemaName}`)

  // Clone all tables, indexes, constraints, triggers, and functions into the new schema
  await client.query(`SET search_path TO ${schemaName}, public`)

  // Recreate the schema structure (from the migration)
  await client.query(`
    CREATE FUNCTION ${schemaName}.check_route_path_conflict() RETURNS trigger
      LANGUAGE plpgsql AS $_$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM routes
          WHERE path = NEW.path
            AND id != COALESCE(NEW.id, -1)
        ) THEN
          RAISE EXCEPTION 'Path "%" already exists in routes', NEW.path;
        END IF;
        IF NEW.path ~ '^/_' THEN
          RAISE EXCEPTION 'Route path "%" cannot start with "/_"', NEW.path;
        END IF;
        IF NEW.path ~ '_$' THEN
          RAISE EXCEPTION 'Route path "%" cannot end with "_"', NEW.path;
        END IF;
        IF NEW.path ~ '/$' AND NEW.path != '/' THEN
          RAISE EXCEPTION 'Route path "%" cannot end with "/"', NEW.path;
        END IF;
        RETURN NEW;
      END;
      $_$;

    CREATE FUNCTION ${schemaName}.update_updated_at_column() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$;

    CREATE TABLE document_records (
      id serial PRIMARY KEY,
      title varchar(500) NOT NULL DEFAULT '',
      content text NOT NULL DEFAULT '',
      data text NOT NULL DEFAULT '',
      style text NOT NULL DEFAULT '',
      script text NOT NULL DEFAULT '',
      server text NOT NULL DEFAULT '',
      template_id integer,
      slot_id integer,
      content_type varchar(20) NOT NULL DEFAULT '',
      data_type varchar(20),
      has_eta boolean NOT NULL DEFAULT false,
      mime_type text NOT NULL DEFAULT 'text/html; charset=UTF-8',
      extension text NOT NULL DEFAULT '.html',
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE documents (
      id serial PRIMARY KEY,
      path_id integer NOT NULL,
      current_record_id integer,
      draft_record_id integer,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      published boolean NOT NULL DEFAULT true,
      CONSTRAINT documents_must_have_content CHECK (current_record_id IS NOT NULL OR draft_record_id IS NOT NULL),
      CONSTRAINT draft_must_differ_from_current CHECK (current_record_id IS DISTINCT FROM draft_record_id)
    );

    CREATE TABLE routes (
      id serial PRIMARY KEY,
      path varchar(1000) NOT NULL UNIQUE,
      document_id integer NOT NULL,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sessions (
      session_id varchar(255) PRIMARY KEY,
      user_id integer NOT NULL,
      expires_at timestamp NOT NULL,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE uploads (
      id serial PRIMARY KEY,
      filename varchar(500) NOT NULL,
      document_id integer,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      original_filename varchar(500) NOT NULL,
      hidden boolean NOT NULL DEFAULT false,
      hash varchar(71) NOT NULL,
      CONSTRAINT uploads_original_filename_document_id_unique UNIQUE (original_filename, document_id)
    );

    CREATE TABLE users (
      id serial PRIMARY KEY,
      username varchar(255) NOT NULL UNIQUE,
      password_hash varchar(255) NOT NULL,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX documents_current_record_id_index ON documents (current_record_id);
    CREATE INDEX documents_draft_record_id_index ON documents (draft_record_id);
    CREATE UNIQUE INDEX documents_path_id_unique ON documents (path_id);
    CREATE INDEX idx_documents_created_at ON documents (created_at);
    CREATE INDEX idx_images_document_id ON uploads (document_id);
    CREATE INDEX idx_images_document_id_original_filename ON uploads (document_id, original_filename);
    CREATE INDEX idx_sessions_expires_at ON sessions (expires_at);
    CREATE INDEX idx_sessions_user_id ON sessions (user_id);
    CREATE INDEX routes_document_id_index ON routes (document_id);
    CREATE INDEX routes_path_index ON routes (path);
    CREATE INDEX users_username_index ON users (username);

    CREATE TRIGGER check_route_path_conflict_trigger
      BEFORE INSERT OR UPDATE ON routes
      FOR EACH ROW EXECUTE FUNCTION ${schemaName}.check_route_path_conflict();

    CREATE TRIGGER update_users_updated_at
      BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION ${schemaName}.update_updated_at_column();

    ALTER TABLE document_records
      ADD CONSTRAINT document_records_slot_id_fkey
      FOREIGN KEY (slot_id) REFERENCES documents(id) ON DELETE SET NULL;

    ALTER TABLE document_records
      ADD CONSTRAINT document_records_template_id_fkey
      FOREIGN KEY (template_id) REFERENCES documents(id) ON DELETE SET NULL;

    ALTER TABLE documents
      ADD CONSTRAINT documents_current_record_id_fkey
      FOREIGN KEY (current_record_id) REFERENCES document_records(id) ON DELETE SET NULL;

    ALTER TABLE documents
      ADD CONSTRAINT documents_draft_record_id_fkey
      FOREIGN KEY (draft_record_id) REFERENCES document_records(id) ON DELETE SET NULL;

    ALTER TABLE documents
      ADD CONSTRAINT documents_path_id_fkey
      FOREIGN KEY (path_id) REFERENCES routes(id) ON DELETE CASCADE;

    ALTER TABLE uploads
      ADD CONSTRAINT images_document_id_fkey
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE;

    ALTER TABLE routes
      ADD CONSTRAINT routes_document_id_fkey
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

    ALTER TABLE sessions
      ADD CONSTRAINT sessions_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  `)

  return {
    client,
    cleanup: async () => {
      try {
        await client.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`)
      } finally {
        client.release()
        await pool.end()
      }
    },
  }
}
