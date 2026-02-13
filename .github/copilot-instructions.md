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

**Skywriter** is a self-hosted platform for publishing one-off HTML pages. Each page is a self-contained unit (HTML/EJS/Markdown, CSS, JavaScript, and data) stored in PostgreSQL and served at its own URL path.

### Key Features

- **Document Management**: Individual pages with templates, slots, and drafts
- **Content Types**: Markdown, HTML, or ETA/EJS templates
- **Web Editor**: Built-in editor with syntax highlighting (Ace Editor)
- **CLI Tool**: Command-line interface for syncing and managing pages
- **PostgreSQL Storage**: All content, styles, scripts stored in database
- **File Uploads**: Associate images/files with specific pages
- **Git Integration**: Download/upload pages as archives
- **Authentication**: User system with bcrypt password hashing

### Technology Stack

- **Backend**: Hono web framework with @hono/node-server
- **Database**: PostgreSQL with node-pg-migrate for migrations
- **Frontend**: Vanilla JavaScript with Ace Editor
- **Templating**: ETA templates for rendering
- **Testing**: Native Node.js test runner with c8 for coverage
- **E2E Testing**: Playwright
- **Build**: esbuild for bundling editor assets
- **TypeScript**: Using --experimental-strip-types (no compilation needed for running)

### Directory Structure

- `src/` - Source code
  - `cli/` - CLI commands and utilities
  - `db/` - Database connection and utilities
  - `editor/` - Web-based editor frontend
  - `operations/` - Database operations (CRUD for documents)
  - `render/` - Document rendering logic
  - `responder/` - HTTP response handling
  - `server/` - Hono server and routes
  - `server-bin/` - Server entry point
  - `utils/` - Shared utilities and types
- `test/` - Test files (mirror src/ structure)
- `e2e/` - End-to-end Playwright tests
- `migrations/` - Database migrations
- `pages/` - Static pages and templates
- `scripts/` - Build and development scripts

### Key npm Scripts

- `npm run migrate:up` - Apply pending migrations
- `npm run migrate:down` - Rollback last migration
- `npm run migrate:create <name>` - Create new migration
- `npm run db:up` - Start database container
- `npm run db:down` - Stop database container
- `npm run db:reset` - Reset database (warning: deletes data)
- `npm test` - Run tests, typecheck, and format check
- `npm run test:only` - Run tests only (with --experimental-strip-types)
- `npm run test:coverage` - Run tests with coverage report
- `npm run build` - Build editor and package
- `npm run dev` - Start development server with watch mode
- `npm start` - Start production server
- `npm run cli` - Run CLI tool
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier
- `npm run typecheck` - Type check all TypeScript files
- `npm run e2e` - Run Playwright tests

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
- Container name: `quandoc-postgres`
- Port: `5455` (mapped to container's `5432`)
- Always use `--no-psqlrc -P pager=off` to prevent the pager from hanging the terminal

### Document Publishing and Draft Behavior

Documents in Skywriter have a `published` boolean field (default: `false`) and support draft versions:

**For public (unauthenticated) requests:**

- Only published documents are returned (`{published: true}` is used)
- Draft versions are never shown to unauthenticated users

**For authenticated requests:**

- Draft versions are returned if they exist (`{draft: true}` is used)
- Both published and unpublished documents can be accessed

**Query options:**

- `{published: true}` - Only return published documents
- `{published: false}` - Only return unpublished documents
- `{published: undefined}` - Return both published and unpublished (no filter)
- `{draft: true}` - Include draft version in response (if exists)
- `{draft: false}` - Exclude draft version from response

## Testing / File Organization

Files in tests and src should be organized in parallel structure where possible. For example, tests for `src/operations/upsert.ts` should be in `test/operations/upsert.test.ts`.

**Test Structure:**

- Each `describe` block should test a single function or logical group of functionality
- When a function is exported and tested independently, it should have its own `describe` block
- Tests should be organized by function name to make it clear what is being tested

We use native Node.js tests and need to accommodate for this issue:

> Unknown file extension ".ts" for /home/runner/work/skywriter/skywriter/test/operations/upsert.test.ts

Try optimistically to only test things branches / statements and functions through function(s) that are exported. This ensures that the surface area of the function is tested as it is used in practice. However, if there is complex logic inside a function that is not directly testable through the exported interface, consider exporting helper functions or breaking down the function into smaller, testable units, and export those functions. Never alter the code drastically just to make it testable.

### Running Tests

- `npm run test:only` - Run all tests with the required flags: `--experimental-strip-types --experimental-test-module-mocks --test --test-concurrency=1`
- Tests require the `--experimental-test-module-mocks` flag for mocking
- Tests run with concurrency=1 to avoid database conflicts

## Code Style and Conventions

### TypeScript

- Use TypeScript with `--experimental-strip-types` (no compilation needed for development)
- Prefer explicit types for function parameters and return values
- Use `type` for object shapes, `interface` for extensible contracts
- Unused variables should be prefixed with `_` (enforced by ESLint)

### Imports

- **Always use `.ts` extension** when importing TypeScript files
- Use absolute imports when referencing types from shared locations
- Group imports: external packages first, then internal modules

### Formatting

- Use Prettier with `@github/prettier-config`
- Run `npm run format` to auto-format code
- Format is checked in CI with `npm run format:check`

### Naming Conventions

- Use camelCase for variables and functions
- Use PascalCase for types, interfaces, and classes
- Use UPPER_SNAKE_CASE for constants
- Database operations exported as named functions (e.g., `findDocument`, `getDualDocument`)

### Error Handling

- Use custom error classes (e.g., `NotFoundError`) for specific error types
- Always wrap database transactions in try/catch with ROLLBACK
- Provide descriptive error messages
