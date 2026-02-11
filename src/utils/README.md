# Function Context API

This document describes the function context API for making server-side function calls from client-side code and templates.

## Overview

The function context API provides a way to call server-side functions from:

- Client-side JavaScript in the editor
- Template server.js code that runs in the browser
- Any client code that needs to fetch documents, uploads, or other data

## Architecture

### Server-Side: `functionContext`

Located in `operations/functionContext.ts`, this provides the actual implementation of functions that run on the server with database access.

```typescript
import {functionContext} from './operations/functionContext.ts'

// On the server, pass to render with db connection
const renderResult = await render(document, {
  fn: functionContext(db, document),
})
```

### Client-Side: `functionContextClient`

Located in `operations/functionContextClient.ts`, this provides a drop-in replacement that makes HTTP requests to the server API.

```typescript
import {functionContextClient} from './operations/functionContextClient.ts'

// On the client, creates fetch-based implementation
const fn = functionContextClient() // Uses same origin by default
// or
const fn = functionContextClient('https://example.com') // Custom server URL
```

### Server API Endpoint

The server exposes `POST /edit?fn=<functionName>` to handle client function calls.

Route handler in `server/routes/edit.ts` dispatches to the appropriate server-side function.

## Available Functions

All functions are available on both server and client sides with identical signatures:

### `getPage(query: DocumentQuery)`

Fetch and render a single page.

```javascript
const result = await fn.getPage({path: '/about'})
// Returns: RenderedDoc with html, markdown, etc.
```

### `getPages(options?: RenderDocumentsManyQuery)`

Fetch and render multiple pages.

```javascript
const results = await fn.getPages({
  limit: 10,
  orderBy: 'updated_at',
  orderDirection: 'desc',
})
// Returns: Array of RenderedDoc
```

### `getUploads(options?: UploadsManyQuery & {path?: string})`

Fetch uploads for a document.

```javascript
const uploads = await fn.getUploads({
  path: '/blog/my-post',
  limit: 20,
})
// Returns: Array of Upload objects
```

## Usage Examples

### In Editor JavaScript (Client-Side)

The editor state includes `serverUrl`, so you can create the function context:

```javascript
// In editor client code
const state = parseStateFromDOM()
const fn = functionContextClient(state.serverUrl)

// Fetch a page
const aboutPage = await fn.getPage({path: '/about'})
console.log(aboutPage.html)

// Fetch multiple pages
const posts = await fn.getPages({
  limit: 10,
})
```

### In Template server.js (Client-Side)

Templates receive the `fn` object in their server.js context when rendered in the editor:

```javascript
// In template's server.js file
export async function handler({fn}) {
  // Fetch related pages
  const posts = await fn.getPages({limit: 5})

  return {
    recentPosts: posts,
  }
}
```

### Server-Side Rendering

On the server, use the direct implementation:

```javascript
import {functionContext} from './operations/functionContext.ts'
import {render} from './render/index.ts'

const doc = await db.getRenderDocument(
  {path: '/blog'},
  {
    includeSlot: true,
    includeTemplate: true,
  },
)

const rendered = await render(doc, {
  fn: functionContext(db, doc),
})
```

## API Request Format

Client calls are translated to HTTP requests:

```
POST /edit?fn=getPage
Content-Type: application/json

{
  "query": {"path": "/about"}
}
```

```
POST /edit?fn=getPages
Content-Type: application/json

{
  "options": {"limit": 10}
}
```

```
POST /edit?fn=getUploads
Content-Type: application/json

{
  "options": {"path": "/blog/post", "limit": 20}
}
```

## Authentication

All function context API calls require authentication:

- Requests must include session cookies
- The `/edit` endpoint is protected by auth middleware
- Unauthenticated requests will receive 401 responses

## Error Handling

Both client and server implementations throw errors on failure:

```javascript
try {
  const page = await fn.getPage({path: '/nonexistent'})
} catch (error) {
  console.error('Failed to fetch document:', error.message)
}
```

Client-side errors include:

- Network failures
- HTTP error status codes (401, 404, 500, etc.)
- JSON parsing errors

## Type Safety

Both implementations share the same TypeScript types:

```typescript
import type {DocumentQuery, RenderDocumentsManyQuery, UploadsManyQuery} from '../db/types.ts'
```

This ensures type safety across client and server boundaries.

## Implementation Details

### Server Route Handler

The `createFunctionContextRoutes` function in `server/routes/functionContext.ts`:

1. Parses the `fn` query parameter to determine which function to call
2. Validates the request body contains required parameters
3. Calls the appropriate server-side function
4. Returns JSON response

### Client Implementation

The `functionContextClient` function in `operations/functionContextClient.ts`:

1. Constructs the API URL with function name
2. Makes POST request with JSON body
3. Handles response and errors
4. Returns typed result

## Adding New Functions

To add a new function to the context:

1. Add implementation to `operations/functionContext.ts`:

```typescript
async function myNewFunction(db: DatabaseConnection, params: MyParams) {
  // Implementation
}

export function functionContext(db: DatabaseConnection, doc: RenderDocument) {
  return {
    // ... existing functions
    myNewFunction: async (params: MyParams) => {
      return await myNewFunction(db, params)
    },
  }
}
```

2. Add client wrapper to `operations/functionContextClient.ts`:

```typescript
export function functionContextClient(serverUrl?: string) {
  return {
    // ... existing functions
    myNewFunction: async (params: MyParams) => {
      return await callFunction('myNewFunction', {params})
    },
  }
}
```

3. Add route handler case in `server/routes/functionContext.ts`:

```typescript
case 'myNewFunction': {
  const {params} = body as {params: MyParams}
  const result = await myNewFunction(db, params)
  return c.json(result)
}
```

4. Add types to `db/types.ts` if needed
