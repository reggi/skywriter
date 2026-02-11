# Quandoc CLI

Command-line interface for syncing documents between your local filesystem and a Quandoc server.

## Installation

The CLI is included in this repository. You can run it using npm scripts:

```bash
npm run cli -- <command>
```

Or directly with Node.js:

```bash
node --experimental-strip-types cli/index.ts <command>
```

## Credential Storage

Quandoc CLI securely stores your credentials using platform-specific secure storage:

### macOS

- **Uses**: macOS Keychain (via `security` command)
- **Storage**: Credentials stored in system keychain
- **Security**: Protected by system encryption and authentication

### Linux

- **Uses**: Secret Service API (via `secret-tool`)
- **Storage**: Credentials stored in system keyring (GNOME Keyring, KWallet, etc.)
- **Requirements**: `libsecret-tools` must be installed

  ```bash
  # Ubuntu/Debian
  sudo apt-get install libsecret-tools

  # Fedora/RHEL
  sudo dnf install libsecret

  # Arch
  sudo pacman -S libsecret
  ```

### Windows

- **Uses**: Windows Credential Manager
- **Note**: Currently falls back to file storage (see below)

### Fallback (All Platforms)

- **Uses**: Encrypted file in home directory
- **Storage**: `~/.quandoc-cli-credentials.json`
- **Security**: File permissions set to 600 (owner read/write only)
- **Warning**: Shows warning when saving credentials

### Multi-Server Support

You can be logged into multiple servers simultaneously:

```bash
# Login to first server
npm run cli:login
# Server: https://server1.example.com
# (Set as default)

# Login to second server
npm run cli:login
# Server: https://server2.example.com
# Set as default? No

# List all configured servers
npm run cli -- servers

# Switch default server
npm run cli -- switch

# Remove a server
npm run cli -- logout
```

### Migration

If you have an existing plain-text config file (`~/.quandoc-cli-config.json`), it will be automatically migrated to secure storage on first use. The old file will be deleted after successful migration.

## Quick Start

1. **Login to your server:**

   ```bash
   npm run cli:login
   ```

2. **Pull a document from the server:**

   ```bash
   npm run cli:pull -- /my-document
   ```

3. **Push local changes back to the server:**
   ```bash
   npm run cli:push
   ```

## Commands

### `login`

Login to Quandoc server and save credentials securely.

```bash
npm run cli:login
```

**Interactive Prompts:**

- **Server URL**: The base URL of your Quandoc server (e.g., `https://quandoc.example.com`)
  - Automatically sanitized (removes trailing slashes, paths, queries)
- **Username**: Your username
- **Password**: Your password (hidden input)
- **Set as default?**: Whether to use this server by default (asked if other servers exist)

**What it does:**

- Shows which credential backend is being used
- Validates the server URL format
- Tests connectivity to the server
- Saves credentials securely using platform-specific storage
- Optionally sets the server as default

**Example:**

```
$ npm run cli:login

Login to Quandoc

Using: macOS Keychain

? Server URL: https://quandoc.example.com
? Username: john
? Password: ********
? Set this server as the default? Yes

✓ Login successful
Credentials saved securely (set as default)

You can now use 'quandoc pull' and 'quandoc push' commands.
```

---

### `servers`

List all configured servers.

```bash
npm run cli -- servers
```

**Example:**

```
$ npm run cli -- servers

Configured servers (using macOS Keychain):

1. https://server1.example.com
   Username: john (default)
2. https://server2.example.com
   Username: jane
```

---

### `switch`

Switch the default server.

```bash
npm run cli -- switch
```

**Interactive:**

- Shows list of all configured servers
- Prompts to select which one should be default

---

### `logout`

Remove credentials for a server.

```bash
npm run cli -- logout
```

**Interactive:**

- Shows list of all configured servers
- Prompts to select which one to remove
- Asks for confirmation before deletion

---

### `pull [path]`

Download a document from the server to your local directory.

```bash
npm run cli:pull -- [path]
```

**Arguments:**

- `path` (optional): Document path to pull. If not provided, reads from `settings.json`

**Prerequisites:**

- Must be logged in (run `login` first)
- Git must be installed
- Current directory must be either:
  - Completely empty (for fresh install), OR
  - A git repository with `settings.json` (for updates)

**What it does:**

**Fresh Install Mode** (empty directory):

1. Downloads archive from `${serverUrl}/${path}/archive.tar.gz`
2. Extracts all files to current directory
3. Initializes git repository
4. Creates initial commit

**Update Mode** (existing project):

1. Checks for uncommitted changes (warns and prompts)
2. Downloads archive from server
3. Removes all files **except** `.git` directory
4. Extracts new files
5. Does NOT auto-commit (you must review changes)

**Example - Fresh Install:**

```
$ mkdir my-project && cd my-project
$ npm run cli:pull -- /my-document

Pulling document: /my-document

Downloading archive...
Extracting files...
Initializing git repository...

✓ Pull completed successfully
```

**Example - Update Existing:**

```
$ cd my-project
$ npm run cli:pull

Pulling document: /my-document

Downloading archive...
Removing old files...
Extracting files...

✓ Pull completed successfully

Files have been updated. Review changes with:
  git status
  git diff

Then commit when ready:
  git add .
  git commit -m "Update from server"
```

**Safety Features:**

- Warns about uncommitted changes
- Prompts for confirmation before overwriting
- Preserves `.git` directory during updates

---

### `push [path]`

Upload your local document to the server.

```bash
npm run cli:push -- [path]
```

**Arguments:**

- `path` (optional): Document path to push to. If not provided, reads from `settings.json`

**Prerequisites:**

- Must be logged in (run `login` first)
- Required files must exist in current directory

**Required Files:**

- `README.*` (any extension, e.g., `README.md`)
- `data.*` (any extension, e.g., `data.yaml`, `data.json`)

**Optional Files** (included if present):

- `style.css`
- `redirects.json`
- `uploads.json`
- `settings.json`
- `uploads/` directory

**What it does:**

1. Validates all files (checks for required files, warns about unexpected files)
2. Lists files to be uploaded
3. Prompts for confirmation
4. Creates tarball containing validated files
5. Uploads to `${serverUrl}/document/archive` via POST with Basic Auth
6. Updates `settings.json` if path argument differs from existing path

**Example:**

```
$ cd my-project
$ npm run cli:push -- /my-document

Pushing document: /my-document

Validating files...

Files to upload:
  ✓ README.md
  ✓ data.yaml
  ✓ style.css
  ✓ redirects.json
  ✓ uploads.json
  ✓ settings.json
  ✓ uploads

? Push to "/my-document"? Yes

Creating archive...
Uploading to server...

✓ Push completed successfully
Document published to: https://quandoc.example.com/my-document
```

**Path Management:**

- If you provide a different path than what's in `settings.json`, it will prompt to update
- The path in `settings.json` becomes the default for future push/pull commands
- Path changes require confirmation

**File Validation:**

- Throws error if multiple `README.*` files found
- Throws error if multiple `data.*` files found
- Warns about unexpected files (but doesn't upload them)

---

## Configuration

### Config File Location

`~/.quandoc-cli-config.json`

**Contents:**

```json
{
  "serverUrl": "https://quandoc.example.com",
  "username": "john",
  "password": "secret"
}
```

**Security Notes:**

- File is automatically created with restrictive permissions (chmod 600)
- Passwords are stored in plaintext (consider using token-based auth in future)
- Keep this file secure and never commit it to git

### Project Settings

`settings.json` (in your project directory)

**Contents:**

```json
{
  "path": "/my-document"
}
```

**Purpose:**

- Stores the document path for this project
- Automatically created/updated by push command
- Used as default path if not specified in pull/push commands

---

## Typical Workflows

### Starting a New Project from Server

```bash
# 1. Login once
npm run cli:login

# 2. Create project directory
mkdir my-project && cd my-project

# 3. Pull document from server
npm run cli:pull -- /my-document

# 4. Work on your files...
# (edit README.md, data.yaml, etc.)
```

### Pushing Changes to Server

```bash
# 1. Make changes to your files
# 2. Commit to git
git add .
git commit -m "Updated content"

# 3. Push to server
npm run cli:push
```

### Syncing with Server Updates

```bash
# 1. Commit any local changes first
git add .
git commit -m "My changes"

# 2. Pull latest from server
npm run cli:pull

# 3. Review changes
git diff

# 4. Commit if satisfied
git add .
git commit -m "Synced with server"
```

---

## Error Handling

### Common Errors

**"Not logged in. Please run: quandoc login"**

- You haven't logged in yet, or config file is missing
- Run `npm run cli:login` first

**"Git is not installed"**

- Install Git: https://git-scm.com/downloads

**"Authentication failed"**

- Your credentials may be incorrect or expired
- Run `npm run cli:login` again

**"Document not found: /path"**

- The document doesn't exist on the server
- Check the path is correct

**"No README file found"**

- Push requires a README file (e.g., `README.md`)
- Create one before pushing

**"Multiple README files found"**

- Only one README file is allowed
- Keep only one (e.g., `README.md`)

**"You have uncommitted changes"**

- Pull detected uncommitted changes in your git repo
- Commit your changes first:
  ```bash
  git add .
  git commit -m "Your message"
  ```

### Debug Mode

For detailed error information including stack traces:

```bash
DEBUG=1 npm run cli -- <command>
```

---

## Architecture

### Files

- **`cli/index.ts`** - Main CLI entry point with command routing
- **`cli/config.ts`** - Configuration file management utilities
- **`cli/login.ts`** - Login command implementation
- **`cli/pull.ts`** - Pull command implementation
- **`cli/push.ts`** - Push command implementation
- **`cli/git-utils.ts`** - Git helper functions

### Dependencies

- **commander** - Command-line argument parsing
- **@inquirer/prompts** - Interactive user prompts
- **tar** - Archive creation and extraction
- **formdata-node** - Multipart form data for uploads

### Server Endpoints

**Pull:** `GET /${path}/archive.tar.gz`

- Requires HTTP Basic Auth
- Returns tar.gz archive containing all document files

**Push:** `POST /document/archive`

- Requires HTTP Basic Auth
- Accepts multipart/form-data with:
  - `file`: The tar.gz archive
  - `path`: The document path
- Creates document as draft initially

---

## Implementation Status

✅ **Completed:**

- Login command with interactive prompts
- Pull command with git integration
- Push command with file validation
- Configuration file management
- Git safety checks
- Error handling and user feedback
- Comprehensive documentation

🔄 **Testing:**

- Manual end-to-end testing needed
- Integration with real server

---

## Support

For issues or questions, refer to the error messages and this documentation. Most common issues are resolved by:

1. Ensuring you're logged in
2. Checking git repository status
3. Validating required files exist
