# Skywriter

I believe in a small, personal web. Making a website can be an art form—a simple, expressive space that reflects a person's ideas, experiments, and voice. Skywriter is an open source project built around that spirit: creating minimal, thoughtful web experiences that make it easy to publish small, meaningful sites.

I started building websites when things felt handmade. With just HTML, CSS, and a bit of JavaScript, I could create a page about anything. It was a quieter time—less about metrics and feeds, more about discovery, webrings, and the early indieweb ethos of sharing and self-hosting.

The web has changed. Many experiences now live inside large platforms and profiles. But the tools for independent publishing still exist, and they are powerful. Technologies like RSS continue to make it possible to share self-hosted content in open, flexible ways.

Skywriter is an invitation to return to that sense of ownership and creativity—to build something small, personal, and lasting. A corner of the web that feels like yours.

— Tea ✨

## What is Skywriter?

Skywriter is a self-hosted platform for publishing one-off HTML pages. Each page is a self-contained unit—HTML (EJS or Markdown), CSS, JavaScript, and data—stored in PostgreSQL and served at its own URL path.

### Core Philosophy

The main question behind Skywriter: **How can we manage a personal website easily?**

The approach:

- Manage **individual pages**, not entire websites
- Driven by url **paths** with a unique API
- Provide **a web editor** and a way to **download and edit locally**
- Store **HTML, CSS, JavaScript, data** in a **database**
- Support **Markdown, HTML, or [ETA/EJS](https://eta.js.org/)**
- Provide a simple **layout / templating** system
- Associate **uploads** / **images** to a specific page

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm
- PostgreSQL (or Docker & Docker Compose)

### Option A: Install via npm

1. **Install globally:**

```bash
npm install -g skywriter
```

2. **Set up your environment:**

Set your PostgreSQL connection string and enable signup:

```bash
export DATABASE_URL="postgresql://user:password@localhost:5432/skywriter"
export ALLOW_SIGNUP=true
```

You can also create a `.env` file in the current working directory — Skywriter will load it automatically. See [Environment Variables](#environment-variables) for the full list of options.

3. **Start the server:**

```bash
skywriter host --migrate
```

The `--migrate` flag runs any pending database migrations before starting. Your Skywriter instance is now running at `http://localhost:3000`. See the [`host` command reference](#skywriter-host) for all available options.

### Option B: Clone the repository

1. **Clone and install:**

```bash
git clone https://github.com/reggi/skywriter
cd skywriter
npm install
```

2. **Set up the database:**

```bash
# Start PostgreSQL with Docker Compose
npm run db:up

# Run migrations
npm run migrate:up
```

3. **Configure environment:**

```bash
cp .env.example .env
```

Edit `.env` with your database credentials, or set them directly:

```bash
export DATABASE_URL="postgresql://user:password@localhost:5432/skywriter"
export ALLOW_SIGNUP=true
```

4. **Start the server:**

```bash
npm run start
```

Your Skywriter instance is now running at `http://localhost:3000`.

### Create Your Account

Open `http://localhost:3000/edit` in your browser. You'll be prompted to sign up and create your first admin account (when `ALLOW_SIGNUP=true`).

## The Server

Skywriter runs as a Node.js server built with [Hono](https://hono.dev/) and backed by PostgreSQL.

### How It Works

The server handles everything: serving pages, the editor UI, file uploads, Git operations, authentication, and the API. When a request comes in for a path like `/about`, the server looks up that document in the database, renders it through the ETA template engine, and returns the final HTML.

### Routes Overview

Every document path exposes a set of endpoints. For a page at `/:path`:

| Endpoint                | Redirect                     | Description                                | Public |
| ----------------------- | ---------------------------- | ------------------------------------------ | ------ |
| `/:path`                |                              | Rendered page                              | ✓      |
| `/:path/edit`           |                              | Web editor                                 | ✗      |
| `/:path.html`           | `/:path`                     | Rendered page                              | ✓      |
| `/:path/index.html`     | `/:path`                     | Rendered page                              | ✓      |
| `/:path/style.css`      |                              | Page stylesheet                            | ✓      |
| `/:path/style`          | `/style.css`                 |                                            | ✓      |
| `/:path.css`            | `/style.css`                 |                                            | ✓      |
| `/:path/script.js`      |                              | Client-side JavaScript                     | ✓      |
| `/:path/script`         | `/script.js`                 |                                            | ✓      |
| `/:path.js`             | `/script.js`                 |                                            | ✓      |
| `/:path/server.js`      |                              | Server-side JavaScript                     | ✓      |
| `/:path/server`         | `/server.js`                 |                                            | ✓      |
| `/:path/content.md`     |                              | Raw Markdown content                       | ✓      |
| `/:path/content.html`   |                              | Rendered HTML content                      | ✓      |
| `/:path/content.eta`    |                              | ETA source (if applicable)                 | ✓      |
| `/:path/content`        | content file                 | Redirects to appropriate content variant   | ✓      |
| `/:path.md`             | `/content.md`                |                                            | ✓      |
| `/:path.eta`            | `/content.eta`               |                                            | ✓      |
| `/:path/data.json`      |                              | Page data (JSON)                           | ✓      |
| `/:path/data.yaml`      |                              | Page data (YAML)                           | ✓      |
| `/:path/data`           | `/data.json` or `/data.yaml` | Based on data type                         | ✓      |
| `/:path/data.yml`       | `/data.yaml`                 |                                            | ✓      |
| `/:path.yaml`           | `/data.yaml`                 |                                            | ✓      |
| `/:path.yml`            | `/data.yaml`                 |                                            | ✓      |
| `/:path/settings.json`  |                              | Page settings                              | ✓      |
| `/:path/settings`       | `/settings.json`             |                                            | ✓      |
| `/:path/api.json`       |                              | List of all asset URLs                     | ✓      |
| `/:path/api`            | `/api.json`                  |                                            | ✓      |
| `/:path.json`           | `/api.json`                  |                                            | ✓      |
| `/:path/edit.json`      |                              | Editor API                                 | ✗      |
| `/:path/uploads.json`   |                              | Upload metadata                            | ✓      |
| `/:path/uploads`        | `/uploads.json`              |                                            | ✓      |
| `/:path/total.md`       |                              | Full document as Markdown with frontmatter | ✓      |
| `/:path/archive.tar.gz` |                              | Downloadable archive                       | ✓      |
| `/:path/archive`        | `/archive.tar.gz`            |                                            | ✓      |
| `/:path.git/*`          |                              | Git operations                             | ✗      |

### Authentication

Skywriter uses session-based authentication with cookies for the web interface and HTTP Basic Auth for Git and CLI operations. User passwords are hashed with bcrypt.

### Environment Variables

| Variable         | Default       | Description                                              |
| ---------------- | ------------- | -------------------------------------------------------- |
| `DATABASE_URL`   | —             | PostgreSQL connection string                             |
| `PORT`           | `3000`        | Server port                                              |
| `GIT_REPOS_PATH` | `.git-repos`  | Path for Git repositories                                |
| `UPLOADS_PATH`   | `./uploads`   | Path for uploaded files                                  |
| `ALLOW_SIGNUP`   | `false`       | Allow new user registration                              |
| `SIGNUP_LIMIT`   | `1`           | Maximum number of users (e.g., `1` for single-user mode) |
| `NODE_ENV`       | `development` | Environment mode                                         |
| `DEBUG`          | —             | Enable debug output in CLI (set to `1`)                  |

You can also use individual PostgreSQL connection parameters (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`) as an alternative to `DATABASE_URL`.

## The Editor

The web editor is your primary tool for creating and editing pages. Access it by appending `/edit` to any path.

### Accessing the Editor

- **Edit any page:** `/<path>/edit` (e.g., `/about/edit`)
- **Create a new page:** Navigate to any new path with `/edit` appended (e.g., `/blog/my-first-post/edit`)
- **Edit the homepage:** `/edit`

### Editor Tabs

Once logged in, you'll see the editor interface with multiple tabs:

| Tab          | Purpose                                                                |
| ------------ | ---------------------------------------------------------------------- |
| **Content**  | Your page content — Markdown, HTML, or ETA templates                   |
| **Data**     | Structured data in JSON or YAML, accessible via `<%= data.property %>` |
| **Style**    | Custom CSS for this specific page                                      |
| **Script**   | Client-side JavaScript that runs in the browser                        |
| **Server**   | Server-side JavaScript that runs at render time                        |
| **Settings** | Page metadata, uploads, redirects, template/slot assignments           |

### Key Editor Features

- **Auto-save drafts** — Changes are saved as drafts automatically as you type
- **Save / Revert** — Click **Save** to publish changes, **Revert** to discard drafts
- **Live preview** — Preview your page in real-time
- **Drag-and-drop uploads** — Drop files onto any editor panel to upload
- **Keyboard shortcuts** — Indent, save, and more
- **Syntax highlighting** — Powered by ACE editor with custom Markdown and dark theme support

### Publishing Control

Every page has a **Published** toggle in Settings:

- **Published** — Page is publicly visible
- **Unpublished** — Page is hidden from public view (draft mode)

### Working with Uploads

1. Drag and drop files onto any editor panel, or use the upload button
2. Manage uploads in the **Settings** tab
3. Uploaded files are accessible at: `/<page-path>/uploads/<filename>`

### Renaming a Page

When you change a page's path in the **Settings** tab, the old path is automatically added to the redirects list. This means any existing links to the old URL will still work — they'll redirect (301) to the new path. You can view and manage redirects in the **Settings** tab.

### Logout

When you're done editing, use the **Logout** button in the editor, or `POST` to `/edit?logout`.

## The CLI

The Skywriter CLI lets you manage pages from your terminal — create, pull, push, and serve pages locally.

### Installation

```bash
skywriter <command>
```

### Global Options

| Option                | Description                                                                   |
| --------------------- | ----------------------------------------------------------------------------- |
| `--auth-type <type>`  | Override credential storage (`file`)                                          |
| `-s, --silent`        | Suppress all output                                                           |
| `--json`              | Output as JSON                                                                |
| `--log-level <level>` | Set log level (`error`, `warn`, `notice`, `http`, `info`, `verbose`, `silly`) |

### Commands

#### `skywriter login`

Log in to a Skywriter server and save credentials.

```bash
skywriter login http://myuser@mysite.com
```

Options: `-y, --yes` (set as default without prompting), `--use-env` (read from `SKYWRITER_SECRET` env var)

#### `skywriter logout`

Remove credentials for a server.

#### `skywriter whoami`

Show the current logged-in server and user.

#### `skywriter init`

Initialize a new document with default files locally.

```bash
skywriter init /my-page
```

Options: `-e, --extension <ext>` (default: `.eta`), `-d, --draft`, `-p, --published`, `--template [name]`, `--slot [name]`

#### `skywriter pull`

Pull a document from the server to your local filesystem.

```bash
skywriter pull /my-page
```

Options: `--via <transport>` (`git` or `tar`), `--no-git` (skip git init), `--prompt` (confirm before executing)

#### `skywriter clone`

Clone a document from the server (like `pull` but for first-time downloads).

```bash
skywriter clone /my-page ./local-folder
```

#### `skywriter push`

Push local document changes to the server (auto-detects transport method).

```bash
skywriter push
```

Options: `--via <transport>` (`git` or `tar`), `--no-git` (use tar), `--prompt`

#### `skywriter serve`

Serve a local document for preview in the browser.

```bash
skywriter serve
```

Options: `-p, --port <port>` (default: `3001`), `-w, --watch` (default: `true`), `--clear-cache`

#### `skywriter host`

Start the production Skywriter server backed by PostgreSQL. This is how you run your own Skywriter instance from the CLI.

```bash
skywriter host
```

Options: `-p, --port <port>` (default: `3000`), `--migrate` (run pending database migrations before starting), `--no-seed` (skip seeding demo content on empty database)

The `host` command reads configuration from [environment variables](#environment-variables) (e.g., `DATABASE_URL`, `UPLOADS_PATH`). It also supports a `.env` file in the current working directory — any variables defined there will be loaded automatically.

```bash
# Start with migrations on port 1337
skywriter host --port=1337 --migrate
```

#### `skywriter render`

Render a local document and output the result as JSON (useful for debugging templates).

```bash
skywriter render
```

#### `skywriter settings`

Display and validate the local `settings.json`. Use `--fix` to auto-fix issues.

#### `skywriter vscode`

Set up and open a VS Code workspace for editing.

```bash
skywriter vscode --init --open
```

#### `skywriter remote`

Manage remote server connections:

| Subcommand            | Description                         |
| --------------------- | ----------------------------------- |
| `remote list`         | List all configured remotes         |
| `remote switch [url]` | Switch the default server           |
| `remote remove [url]` | Remove a remote server connection   |
| `remote login [url]`  | Login (same as top-level `login`)   |
| `remote logout [url]` | Logout (same as top-level `logout`) |

### Typical Workflow

```bash
# 1. Log in to your server
skywriter login http://me@mysite.com

# 2. Pull an existing page (or init a new one)
skywriter pull /about

# 3. Edit files locally (content.eta, style.css, etc.)

# 4. Preview locally
skywriter serve

# 5. Push changes to the server
skywriter push
```

## Page Structure

Think of your Skywriter instance as **an npm registry for webpages** — each page is self-contained with its own HTML, CSS, JavaScript (including server-side code), and YAML or JSON data.

Every page in Skywriter is a self-contained document made up of these files:

| File                      | Required | Description                                                         |
| ------------------------- | -------- | ------------------------------------------------------------------- |
| `settings.json`           | Yes      | Page metadata — path, draft status, published state                 |
| `content.*`               | Yes      | Main content (`.md`, `.html`, `.eta`, or any extension)             |
| `data.yaml` / `data.json` | No       | Structured data accessible via `<%= data.property %>`               |
| `style.css`               | No       | Page-specific CSS (auto-injected if not explicitly referenced)      |
| `script.js`               | No       | Client-side JavaScript (auto-injected if not explicitly referenced) |
| `server.js`               | No       | Server-side JavaScript executed at render time                      |

<div class="callout note">
<div class="callout-title">📝 Note</div>
<p><code>style.css</code> and <code>script.js</code> are auto-injected into the page — you don't need to reference them in your content. If you do reference them explicitly, the auto-injection is removed.</p>
</div>

### settings.json

```json
{
  "path": "/about",
  "draft": false,
  "published": true
}
```

### Content Files

Only one `content.*` file is allowed per page. The extension determines rendering behavior:

- `.md`, `.html`, `.eta` — Treated as HTML for rendering, with ETA templating support
- Other extensions (e.g., `.csv`, `.xml`) — Served with the appropriate MIME type (configure in Settings)

<div class="callout important">
<div class="callout-title">⚡ Important</div>
<p>Only one <code>content.*</code> file is allowed per page. Having multiple content files will cause errors.</p>
</div>

### Paths Are Everything

Every document has a **path** (like `/about` or `/blog/post-title`). The path IS the URL. There's no separate routing configuration — just create a page at the path you want.

Use paths to organize content:

```
/blog/2024/first-post
/blog/2024/second-post
/docs/api/authentication
/docs/api/endpoints
/projects/website/overview
```

## Templates and Slots

Skywriter supports reusable templates and content slots for building consistent, maintainable sites. Templates and slots are not unique "themes" or separate entity types — they're just pages, like everything else in Skywriter. Any page can be used as a template or slot for another page.

### Templates

Templates wrap your content with shared layouts — headers, footers, navigation, etc. A template is itself a page that uses the `<%= slot %>` variables to include child content.

When a page has a template assigned (via Settings), the rendering pipeline:

1. Renders the page content first
2. Passes the rendered content to the template as `slot` variables
3. Renders the template with the page content embedded

In a template's content, use these variables to include the child page:

- `<%~ slot.html %>` — The rendered HTML of the child page
- `<%= slot.title %>` — The child page's title
- `<%= slot.path %>` — The child page's path
- `<%= slot.data %>` — The child page's data
- `<%~ slot.style.tag %>` — The child page's stylesheet link
- `<%~ slot.script.tag %>` — The child page's script tag

### Slots

Slots are reusable content blocks (navigation, sidebars, shared components). When a page has a slot assigned, the slot is rendered first and passed as `slot.*` variables during content rendering.

### Assigning Templates and Slots

Set them in the **Settings** tab of the editor, or in `settings.json` when working locally.

<div class="callout warning">
<div class="callout-title">⚠️ Warning</div>
<p>Templates and slots are not recursive. They are only traversed to a single depth — a template or slot cannot itself have a template or slot applied.</p>
</div>

## ETA Templating

Skywriter uses the [ETA template engine](https://eta.js.org) for dynamic content rendering. ETA syntax works in Markdown, HTML, and `.eta` files.

### Syntax

| Syntax              | Purpose                     |
| ------------------- | --------------------------- |
| `<%= expression %>` | Output (HTML-escaped)       |
| `<%~ expression %>` | Output (raw/unescaped HTML) |
| `<% code %>`        | Execute JavaScript logic    |

### Available Variables

<div class="callout tip">
<div class="callout-title">💡 Tip</div>
<p>The <code>skywriter render</code> command will show you everything that ETA has access to:</p>
<pre><code>skywriter render | jq 'keys'
[
  "data",
  "html",
  "markdown",
  "meta",
  "path",
  "script",
  "server",
  "slot",
  "style",
  "title",
  "variableUsage"
]</code></pre>
</div>

#### Page Data

- `<%= title %>` — The page title
- `<%= path %>` — The current page path
- `<%= meta %>` — Metadata object (`createdAt`, `updatedAt`, `toc`, `headings`)
- `<%= data %>` — Parsed JSON/YAML from the Data tab

#### Dynamic Content

- `<%= server %>` — Data returned from your `server.js` default export
- `<%= fn %>` — Query functions (`fn.getPage()`, `fn.getPages()`, `fn.getUploads()`) — see [The `fn` Object](#the-fn-object)
- `<%~ html %>` — Rendered HTML content (available in templates)
- `<%~ markdown %>` — Rendered Markdown content (available in templates)

#### Style Helpers

- `<%= style.content %>` — Raw CSS
- `<%~ style.inlineTag %>` — `<style>...</style>` tag
- `<%= style.href %>` — URL to the CSS file
- `<%~ style.tag %>` — `<link rel="stylesheet" href="...">` tag

#### Script Helpers

- `<%= script.content %>` — Raw JavaScript
- `<%~ script.inlineTag %>` — `<script>...</script>` tag
- `<%= script.href %>` — URL to the JS file
- `<%~ script.tag %>` — `<script src="..."></script>` tag

#### Slot Variables

All the above are also available for slots via `slot.*`:

- `<%= slot.title %>`, `<%= slot.path %>`, `<%= slot.data %>`
- `<%~ slot.html %>`, `<%~ slot.markdown %>`
- `<%~ slot.style.tag %>`, `<%~ slot.script.tag %>`

### Example

```html
<h1><%= title %></h1>
<p>Current path: <%= path %></p>

<% if (data.author) { %>
<p>Written by <%= data.author %></p>
<% } %> <%= server.greeting %>
```

### Raw Blocks

To output literal ETA syntax without it being processed, wrap it in raw blocks using <code>&lt;%raw%&gt;</code> and <code>&lt;%endraw%&gt;</code> tags. Everything between them is passed through as-is without being evaluated.

This is useful when documenting ETA syntax or displaying template code as-is on a page.

### Debugging

Use the CLI to inspect all template variables:

```bash
skywriter render
```

This outputs all variable values as JSON — useful for understanding what's available in your templates.

## Server-Side JavaScript

The **Server** tab (or `server.js` file) lets you write JavaScript that runs on the server at render time. The result is available in your content via the `server` variable.

### Basic Usage

```javascript
function helper() {
  return 'hello world'
}

export default async function (context) {
  return {
    greeting: helper(),
  }
}
```

In your content:

```markdown
<%= server.greeting %>
```

This renders: **hello world**

### What You Can Do

- Define helper functions in the same file
- Return any data structure (strings, objects, arrays)
- Perform async operations (fetch data, query databases)
- Access the context parameter for request information

### The `fn` Object

The `fn` object is available in both ETA templates and `server.js`. It provides functions for querying other pages and uploads from the database.

| Function                  | Description                                            |
| ------------------------- | ------------------------------------------------------ |
| `fn.getPage(query)`       | Get a single page by path or id                        |
| `fn.getPages(options?)`   | Get multiple pages with optional filtering and sorting |
| `fn.getUploads(options?)` | Get uploads for the current page or a specific path    |

#### `fn.getPage(query)`

Returns a fully rendered page object or `null` if not found. The query can be a path string or an object.

```javascript
// By path string
const page = await fn.getPage('/about')

// By path object
const page = await fn.getPage({path: '/about'})
```

The returned object contains the same properties available as ETA variables: `title`, `path`, `html`, `markdown`, `data`, `meta`, `style`, `script`, `server`.

#### `fn.getPages(options?)`

Returns an array of fully rendered page objects. Each item has the same shape as `fn.getPage()`.

| Option           | Type                                                      | Description                                   |
| ---------------- | --------------------------------------------------------- | --------------------------------------------- |
| `sortBy`         | `'created_at'` \| `'updated_at'` \| `'title'` \| `'path'` | Sort field                                    |
| `sortOrder`      | `'asc'` \| `'desc'`                                       | Sort direction                                |
| `published`      | `boolean`                                                 | Filter by published status                    |
| `limit`          | `number`                                                  | Max results                                   |
| `offset`         | `number`                                                  | Skip results                                  |
| `startsWithPath` | `string`                                                  | Filter pages by path prefix (e.g., `"/blog"`) |

```javascript
const posts = await fn.getPages({
  startsWithPath: '/blog',
  sortBy: 'created_at',
  sortOrder: 'desc',
  published: true,
  limit: 10,
})
```

#### `fn.getUploads(options?)`

Returns an array of upload objects for the current page (or a specific path).

| Option           | Type                                                    | Description                                            |
| ---------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| `path`           | `string`                                                | Get uploads for a different page (defaults to current) |
| `sortBy`         | `'created_at'` \| `'original_filename'` \| `'filename'` | Sort field                                             |
| `sortOrder`      | `'asc'` \| `'desc'`                                     | Sort direction                                         |
| `limit`          | `number`                                                | Max results                                            |
| `offset`         | `number`                                                | Skip results                                           |
| `startsWithPath` | `string`                                                | Filter by document path prefix                         |

Each upload object contains: `id`, `filename`, `original_filename`, `hash`, `created_at`, `hidden`.

```javascript
const uploads = await fn.getUploads()
const otherUploads = await fn.getUploads({path: '/gallery'})
```

### Local `fn` Support

When working locally with `skywriter serve`, the `fn` functions work by making API calls to the remote server. On `skywriter pull`, the responses from these calls are cached locally, creating a local replica of the data your document depends on. This means if your page uses `fn.getPages()` or `fn.getPage()`, you can preview it locally without a live server connection — as long as the cache is up to date.

## Git Integration

Every page in Skywriter can optionally be managed as its own Git repository. No repositories exist on the server until you clone or pull a page for the first time. You can delete the repos at any time and start fresh — you'll lose all history and need to re-clone locally, but the page content in the database is unaffected.

### How It Works

Repositories are stored on disk at the path defined by the `GIT_REPOS_PATH` environment variable (defaults to `.git-repos`), organized by document ID. Repositories are not pre-created — when you clone or pull a page for the first time, the server creates a non-bare Git repository on the fly, exports the page's files from the database, and commits them.

If the page has a draft, the server layers it on top: the published version is committed first, then the draft is committed as a second commit on the same branch. This means when you clone a page with a pending draft, the most recent commit contains the draft and the commit before it contains the published version.

When you push changes back, the server reads the files from the repository and upserts them into the database, keeping everything in sync.

Note that this is not a true version history — the repository is created fresh on first clone or pull, starting from the current state of the page in the database. There is no persistent history of past edits. Furthermore, once a repo exists, normal edits made through the web editor do not create individual commits — the current state of the document is only committed at the remote level when you pull new changes. Git here is essentially a mechanism for downloading and uploading documents to and from a database, not for storing full revision history.

### Cloning a Page

```bash
git clone http://localhost:3000/<path>.git
```

For example:

```bash
git clone http://localhost:3000/about.git
git clone http://localhost:3000/blog/my-post.git
```

<div class="callout tip">
<div class="callout-title">💡 Tip</div>
<p>While you can use <code>git clone</code> and <code>git pull</code> directly, using <code>skywriter pull</code> provides extra features — it also pulls down uploads, and resolves slot and template assignments that plain git does not handle.</p>
</div>

### Pushing Changes

Push operations require authentication:

```bash
git push
# You'll be prompted for username/password
```

When you push, the server:

1. Cleans the working directory
2. Accepts your push
3. Reads the repository files
4. Upserts the content into the database

### Pulling Changes

Pull operations require authentication:

```bash
git pull
```

### Authentication

- **Clone/Pull** — Requires Basic Auth (uses your Skywriter credentials)
- **Push** — Requires Basic Auth (uses your Skywriter credentials)

<div class="callout note">
<div class="callout-title">📝 Note</div>
<p>If you don't need remote git repos, see <a href="#tar-transport">Tar Transport</a> for a lighter alternative that keeps git local-only.</p>
</div>

## Tar Transport

`skywriter pull` and `skywriter push` support a `--via=tar` option that downloads and uploads documents as tar archives instead of using git over the network. This behaves the same as `--via=git` — you still get the same files locally — but no git repository is created on the server.

This is useful if you want to use git locally to track your own edits without creating any server-side state. You can initialize a local git repo yourself and manage document history locally.

```bash
# Pull a page via tar (no server-side git repo created)
skywriter pull /about --via=tar

# Initialize your own local git repo
cd about
git init
git add .
git commit -m "initial pull"

# Make edits, commit locally, then push back
# skywriter push auto-detects tar when there's no git remote
skywriter push
```

## Redirects

Moving a page? Skywriter automatically creates redirects when you change a page's path. The old URL redirects (301) to the new location, so all your links keep working.

You can also manually add or remove redirects in the **Settings** tab of the editor.

## Architecture

| Layer               | Technology                                                       |
| ------------------- | ---------------------------------------------------------------- |
| **Web Framework**   | [Hono](https://hono.dev/)                                        |
| **Database**        | [PostgreSQL](https://www.postgresql.org/)                        |
| **Template Engine** | [ETA](https://eta.js.org/)                                       |
| **Code Editor**     | [ACE Editor](https://ace.c9.io/)                                 |
| **Language**        | TypeScript (Node.js)                                             |
| **Migrations**      | [node-pg-migrate](https://github.com/thomwright/node-pg-migrate) |

### Database Schema

- **documents** — Main content storage with drafts, templates, and slots
- **routes** — URL path management with validation rules
- **sessions** — User session tracking
- **uploads** — File upload metadata
- **users** — User accounts

## Development

### Running in Development Mode

```bash
npm run dev
```

This starts the server with hot reload using `--env-file=.env`.

### Running Tests

```bash
npm test                # Full test suite (coverage + typecheck + format)
npm run test:only       # Unit tests only
npm run test:coverage   # Tests with coverage report
npm run e2e             # End-to-end tests (Playwright)
```

### Building

```bash
npm run build           # Production build
npm run build:dev       # Development build
npm run build:watch     # Watch mode
```

### Database Migrations

```bash
npm run migrate:up              # Apply pending migrations
npm run migrate:down            # Rollback last migration
npm run migrate:create <name>   # Create a new migration
```

### Code Quality

```bash
npm run lint            # ESLint
npm run format          # Prettier (write)
npm run format:check    # Prettier (check only)
npm run typecheck       # TypeScript type checking
```

## Deployment

Skywriter can be deployed to any platform that supports:

- Node.js
- PostgreSQL
- File system storage (for uploads and Git repos)

## Inspiration

Skywriter draws from projects that shaped how we think about publishing on the web:

- **[WordPress](https://wordpress.org/)** — The original self-hosted publishing platform. Skywriter shares that self-hosting ethos but focuses on individual pages rather than blogs.
- **[GitHub Gist](https://gist.github.com/)** — Small, self-contained snippets you can share with a URL. Skywriter applies that idea to full web pages.
- **[GitHub Pages](https://pages.github.com/)** — Showed that Git can be a publishing workflow. Skywriter takes this further by giving every page its own Git repository.
- **[npm](https://www.npmjs.com/)** — A registry of self-contained packages, each with its own metadata and versioning. Skywriter treats pages the same way — each one is an independent, publishable unit.
- **[HedgeDoc](https://hedgedoc.org/)** — A collaborative, self-hosted editor that respects your data. Its approach inspired Skywriter's web editor.
