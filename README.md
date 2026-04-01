

## Project Overview

This project implements **Logue**, a real-time collaborative screenplay editor. Multiple users can edit the same script in real time, see each other’s cursors, manage sharing permissions, and export drafts as Word documents.

Key features:
- Real-time collaborative editing using **Yjs** and a WebSocket server.
- Rich text editing with **TipTap**: bold, italic, underline, strike, code blocks, lists, blockquotes, and font-size controls.
- Screenplay-oriented **slash commands**: type `\scene`, `\dialogue`, or `\action` at the start of a line and press Enter to expand into templates.
- Presence and awareness: remote cursors, avatar dots, live collaborator counts, and join/leave toasts.
- Document management: create and open drafts from a list view; per-document room IDs.
- Permissions and access control: document owners can invite collaborators and assign roles (Owner, Editor, Commenter, Viewer).
- Autosave and conflict resolution: powered by Yjs CRDT updates and periodic snapshot persistence to Postgres.
- Download current draft as a **.docx** Word document from the editor toolbar.

The stack is split into three main services plus a Docker setup: a backend API, a collaborative WebSocket server, and a React/Vite frontend.

## Local Development Workflow

This repo has three services you should run together to test collaborative editing end to end.

### 1. Backend API (`backend/`)

```sh
cd backend
npm install
npm run prisma:migrate   # run after updating DATABASE_URL
npm start            # http://localhost:4000
```

Setup details:
- Copy `.env.example` to `.env` and set `DATABASE_URL` to a Postgres instance (local Docker works fine):

```sh
docker run --name logue-postgres \
	-e POSTGRES_PASSWORD=postgres \
	-e POSTGRES_DB=logue \
	-p 5432:5432 -d postgres:16-alpine
```

- Run `npm run prisma:migrate` whenever the schema changes. Use `npm run prisma:deploy` in production.
- Prisma seed logic auto-creates a "Welcome Document" if the table is empty.

Endpoints (high level):
- `GET /health` – quick status check (DB ping).
- `POST /documents`, `GET /documents`, `GET /documents/:id`, `PATCH /documents/:id`, `DELETE /documents/:id` – Postgres-backed document metadata.
- `PUT /documents/:id/snapshot`, `GET /documents/:id/snapshot` – store/load base64 Yjs snapshots in Postgres.
- `GET /documents/:id/members` – list collaborators and their roles for a document.
- `POST /documents/:id/members` – invite or add a collaborator by email with a specific role.
- `PATCH /documents/:id/members/:memberId` – change a collaborator’s role (Owner, Editor, Commenter, Viewer).
- `DELETE /documents/:id/members/:memberId` – remove a collaborator from the document.

### 2. Collaborative WebSocket Server (`collaborative-server/`)

```sh
cd collaborative-server
npm install
npm install y-leveldb   # once; required by @y/websocket-server persistence
BACKEND_URL=http://localhost:4000 npm start   # ws://localhost:1234 by default
```

Environment variables:
- `BACKEND_URL` – where snapshot REST calls should be sent.
- `PORT` – optional, defaults to `1234`.

### 3. Frontend (Vite + TipTap, `frontend/`)

Create `frontend/.env.local` (gitignored) so the UI can find both services:

```
VITE_BACKEND_URL=http://localhost:4000
VITE_COLLAB_SERVER_URL=ws://localhost:1234
```

Then run:

```sh
cd frontend
npm install
npm run dev           # Vite dev server (usually http://localhost:5173)
```

Key UI features in the editor page:
- **Renaming**: click the document title (if you are the owner) to rename it inline; it will PATCH `/documents/:id`.
- **Share dialog**: owners see a **Share** button. Clicking it opens a panel to:
	- Invite collaborators by email, choosing Editor / Commenter / Viewer.
	- View existing collaborators, adjust their roles, or remove them.
- **Slash commands**: type `\scene`, `\dialogue`, or `\action` at the start of a line and press Enter to insert screenplay-style blocks.
- **Formatting toolbar**: bold, italic, underline, strike, code block, bullet/ordered lists, blockquote, undo/redo, and font size selector.
- **Presence indicators**: avatar dots for collaborators, a live presence label, and transient toasts when someone joins or leaves.
- **Download as Word**: use the **Download .docx** button in the toolbar to export the current script to a `.docx` file.

### Manual Test Flow

1. Start all three services (backend, collaborative server, frontend) in separate terminals.
2. Open the frontend URL in two browser windows.
3. Create/select the same document; typing in one window should update the other (Yjs websocket path).
4. Pause for a few seconds—`PUT /documents/:id/snapshot` should appear in backend logs as snapshots are periodically saved.
5. Refresh one window; the editor should reload the last snapshot via `GET /documents/:id/snapshot`.
6. As the owner, click the title to rename the document and verify the updated title is reflected in the documents list and on reload.
7. Click **Share** (as owner) to invite another account by email and change their role between Editor, Commenter, and Viewer.
8. Use the **Download .docx** button in the toolbar to confirm the draft can be exported to a Word document.
9. Use `curl http://localhost:4000/documents` if you want to inspect stored metadata and snapshots.

With this loop you can validate document CRUD, autosave, and collaborative editing without additional tooling.
