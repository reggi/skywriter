# GitHub Copilot Instructions

## Critical Rules

- Imports must always use the `.ts` extension when importing TypeScript files.

### Database Migrations

**NEVER edit migration files once they have been run.**

Migration files are immutable records of database schema changes. Once a migration has been executed:

- ❌ Do NOT modify existing migration files
- ❌ Do NOT delete migration files
- ❌ Do NOT reorder migration files
- ✅ Always create a NEW migration file to make schema changes
- ✅ Use `npm run migrate:create <name>` to generate new migrations
- ✅ Write both `up` and `down` functions for reversibility

**Why?**

- Migrations may have already been applied to production databases
- Editing them creates inconsistencies between environments
- The migration history must remain accurate and reproducible
- Changes can break rollback functionality

**Instead:**
Create forward migrations that modify the schema, such as:

- `ALTER TABLE` to add/drop columns
- `CREATE INDEX` / `DROP INDEX` for indexes
- `ALTER TABLE ... DROP CONSTRAINT` / `ADD CONSTRAINT` for constraints
- Data migration scripts when needed

### Migration Best Practices

1. **Test migrations thoroughly** - Run both up and down migrations in development
2. **Keep migrations atomic** - One logical change per migration
3. **Include data migrations carefully** - Handle existing data when changing schemas
4. **Document breaking changes** - Add comments explaining complex migrations
5. **Consider backwards compatibility** - Especially for columns/tables still in use

## Common Issues

### Import Extension Errors

If you see this error:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/.../src/types.js' imported from /Users/.../src/index.ts
```

**This is because you imported `.js` instead of `.ts`**

In TypeScript files, always import other TypeScript files using the `.js` extension (not `.ts`), as TypeScript expects the compiled output extension. However, if you're getting this error, it means you need to fix the import statement to use the correct extension.

Example:

```typescript
// ❌ Wrong
import {Type} from './types.js'

// ✅ Correct (in TypeScript source files)
import {Type} from './types'
```

## Project Structure

This is a Node.js database migration project using:

- `node-pg-migrate` for migrations
- PostgreSQL as the database
- Docker Compose for local development

Always use the provided npm scripts:

- `npm run migrate:up` - Apply pending migrations
- `npm run migrate:down` - Rollback last migration
- `npm run migrate:create <name>` - Create new migration
- `npm run db:up` - Start database container
- `npm run db:down` - Stop database container

## Database Access

### PostgreSQL via Docker Compose

When querying the PostgreSQL database via command line:

**Correct command format:**

```bash
docker compose exec postgres psql -U astrodoc -d astrodoc -c "SQL QUERY HERE" --no-psqlrc -P pager=off
```

**Important:**

- User: `astrodoc`
- Database: `astrodoc`
- Always use `--no-psqlrc -P pager=off` to prevent the pager from hanging the terminal

### Database Schema Notes

- Documents have a `published` boolean field (default: false)
- The `get` operation returns all documents by default (no filtering)
- To filter by published status, use: `db.get(path, { published: true })` or `db.get(path, { published: false })`
- To retrieve draft content, use: `db.get(path, { draft: true })`

## Database Access

### PostgreSQL via Docker Compose

When querying the PostgreSQL database via command line:

**Correct command format:**

```bash
docker compose exec postgres psql -U astrodoc -d astrodoc -c "SQL QUERY HERE" --no-psqlrc -P pager=off
```

**Important:**

- User: `astrodoc`
- Database: `astrodoc`
- Always use `--no-psqlrc -P pager=off` to prevent the pager from hanging the terminal
- The docker-compose.yml is in `/Users/thomasreggi/Desktop/quandoc2/db/`

### Database Schema Notes

- Documents have a `published` boolean field (default: false)
- The `get` operation filters out unpublished documents by default
- To retrieve unpublished documents, use: `db.get(path, { unpublished: true })`

## Testing / file organization

Files in tests and src should be organized in parallel structure where possible. For example, tests for src/operations/upsert.ts should be in test/operations/upsert.test.ts.

**Test Structure:**

- Each `describe` block should test a single function or logical group of functionality
- When a function is exported and tested independently, it should have its own `describe` block
- Tests should be organized by function name to make it clear what is being tested

We use native nodejs tests and need to accomidate for this issue:

> Unknown file extension ".ts" for /Users/thomasreggi/Desktop/quandoc2/db/test/operations/upsert.test.ts

Try optimistically to only test things branches / statments and functions through function(s) that are exported. This ensures that the surface area of the function is tested as it is used in practice. However, if there is complex logic inside a function that is not directly testable through the exported interface, consider exporting helper functions or breaking down the function into smaller, testable units, and export those functions. Never alter the code drastically just to make it testable.
