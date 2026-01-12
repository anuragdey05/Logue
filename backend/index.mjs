import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import prismaPkg from '@prisma/client';

const { PrismaClient, DocumentRole } = prismaPkg;

const app = express();
const port = process.env.PORT || 4000;
const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

const NODE_ENV = process.env.NODE_ENV ?? 'development';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret';
const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS ?? 60 * 60 * 24 * 30);
const COOKIE_NAME = 'logue_session';
const ALLOWED_STATUSES = new Set(['active', 'archived']);
const ALLOWED_ROLES = new Set(Object.values(DocumentRole));
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:5173';
const FRONTEND_ORIGINS = APP_BASE_URL.split(',').map((value) => value.trim()).filter(Boolean);
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI || `http://localhost:${port}/auth/google/callback`;
const SERVICE_API_KEY = process.env.SERVICE_API_KEY || 'dev-service-key';

const oauthClient =
  GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET
    ? new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)
    : null;

const GOOGLE_SCOPES = ['openid', 'profile', 'email'];
const palette = ['#ff6b6b', '#feca57', '#1dd1a1', '#54a0ff', '#5f27cd'];

const corsOptions = {
  origin: FRONTEND_ORIGINS.length === 0 ? true : FRONTEND_ORIGINS,
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

const makeId = () =>
  crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');

const selectColor = (seed) => {
  if (!seed) return palette[0];
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0; // eslint-disable-line no-bitwise
  }
  const index = Math.abs(hash) % palette.length;
  return palette[index];
};

const createSessionToken = (userId) =>
  jwt.sign({ sub: userId }, SESSION_SECRET, { expiresIn: SESSION_TTL_SECONDS });

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: NODE_ENV === 'production',
  maxAge: SESSION_TTL_SECONDS * 1000,
  path: '/',
};

const clearCookieOptions = { ...cookieOptions, maxAge: 0 };

const mapUser = (user) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  avatarUrl: user.avatarUrl,
  accentColor: user.accentColor,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const mapMember = (member) => ({
  id: member.id,
  role: member.role,
  createdAt: member.createdAt,
  user: member.user ? mapUser(member.user) : null,
});

async function findDocumentForUser(userId, documentId, select = null) {
  if (!userId) return null;
  return prisma.document.findFirst({
    where: {
      id: documentId,
      OR: [
        { ownerId: userId },
        { members: { some: { userId } } },
      ],
    },
    select: select || undefined,
  });
}

async function getMembership(documentId, userId) {
  if (!userId) return null;
  return prisma.documentMember.findFirst({
    where: { documentId, userId },
  });
}

const decodeState = (value) => {
  if (!value) return {};
  try {
    const json = Buffer.from(value, 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch (error) {
    return {};
  }
};

const encodeState = (payload) =>
  Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

const normalizeRedirect = (target) => {
  if (!target) return APP_BASE_URL;
  try {
    const normalized = new URL(target, APP_BASE_URL).toString();
    return normalized.startsWith(APP_BASE_URL) ? normalized : APP_BASE_URL;
  } catch (error) {
    return APP_BASE_URL;
  }
};

const appendQueryParam = (urlString, param, value) => {
  const url = new URL(urlString);
  url.searchParams.set(param, value);
  return url.toString();
};

const requireAuth = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return next();
};

// Middleware to allow either user auth or service API key
const requireAuthOrService = (req, res, next) => {
  const serviceKey = req.headers['x-service-api-key'];
  if (serviceKey === SERVICE_API_KEY) {
    // Service-to-service request, allow it
    return next();
  }
  // Otherwise require user authentication
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return next();
};

app.use(async (req, res, next) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return next();
  }
  try {
    const decoded = jwt.verify(token, SESSION_SECRET);
    const user = await prisma.user.findUnique({ where: { id: decoded.sub } });
    if (!user) {
      res.clearCookie(COOKIE_NAME, clearCookieOptions);
      return next();
    }
    req.user = user;
    return next();
  } catch (error) {
    res.clearCookie(COOKIE_NAME, clearCookieOptions);
    return next();
  }
});

async function seedDocs() {
  const count = await prisma.document.count();
  if (count > 0) return;

  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@logue.local' },
    update: {},
    create: {
      email: 'demo@logue.local',
      name: 'Demo Author',
      accentColor: palette[0],
      authProvider: 'GOOGLE',
      authProviderId: `demo-${makeId()}`,
    },
  });

  await prisma.document.create({
    data: {
      title: 'Welcome Document',
      description: 'A starter doc so the UI is not empty.',
      roomId: `room-${makeId()}`,
      status: 'active',
      ownerId: demoUser.id,
      members: {
        create: {
          userId: demoUser.id,
          role: DocumentRole.OWNER,
        },
      },
    },
  });
}

seedDocs().catch((err) => {
  console.error('Failed to seed default document', err);
});

app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  } catch (error) {
    console.error('Health check failed', error);
    res.status(500).json({ ok: false, error: 'Database unavailable' });
  }
});

app.get('/auth/user', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.json(mapUser(req.user));
});

app.post('/auth/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, clearCookieOptions);
  res.status(204).send();
});

app.get('/auth/google', (req, res) => {
  if (!oauthClient) {
    return res.status(500).json({ error: 'Google OAuth not configured' });
  }
  const redirect = normalizeRedirect(req.query.redirect);
  const state = encodeState({ redirect });
  const authorizationUrl = oauthClient.generateAuthUrl({
    access_type: 'offline',
    prompt: 'select_account',
    scope: GOOGLE_SCOPES,
    state,
  });
  return res.redirect(authorizationUrl);
});

app.get('/auth/google/callback', async (req, res) => {
  if (!oauthClient || !GOOGLE_CLIENT_ID) {
    return res.status(500).send('Google OAuth not configured');
  }

  const { code, state } = req.query;
  const { redirect: stateRedirect } = decodeState(state);
  const redirectTarget = normalizeRedirect(stateRedirect);

  if (!code) {
    const redirectUrl = appendQueryParam(redirectTarget, 'authError', 'missing_code');
    return res.redirect(redirectUrl);
  }

  try {
    const { tokens } = await oauthClient.getToken(code);
    if (!tokens.id_token) {
      throw new Error('Missing id_token');
    }
    const ticket = await oauthClient.verifyIdToken({ idToken: tokens.id_token, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload?.email || !payload.sub) {
      throw new Error('Missing profile fields');
    }

    const user = await prisma.user.upsert({
      where: { authProviderId: payload.sub },
      update: {
        email: payload.email,
        name: payload.name,
        avatarUrl: payload.picture,
      },
      create: {
        email: payload.email,
        name: payload.name,
        avatarUrl: payload.picture,
        accentColor: selectColor(payload.sub),
        authProvider: 'GOOGLE',
        authProviderId: payload.sub,
      },
    });

    const sessionToken = createSessionToken(user.id);
    res.cookie(COOKIE_NAME, sessionToken, cookieOptions);
    return res.redirect(appendQueryParam(redirectTarget, 'authSuccess', '1'));
  } catch (error) {
    console.error('Google OAuth callback failed', error);
    const redirectUrl = appendQueryParam(redirectTarget, 'authError', 'oauth_failed');
    return res.redirect(redirectUrl);
  }
});

app.post('/documents', requireAuth, async (req, res) => {
  try {
    const { title, description, roomId, status } = req.body || {};

    if (title && typeof title !== 'string') {
      return res.status(400).json({ error: 'title must be a string' });
    }

    if (description && typeof description !== 'string') {
      return res.status(400).json({ error: 'description must be a string' });
    }

    if (roomId && typeof roomId !== 'string') {
      return res.status(400).json({ error: 'roomId must be a string' });
    }

    if (status && !ALLOWED_STATUSES.has(status)) {
      return res.status(400).json({
        error: `status must be one of: ${[...ALLOWED_STATUSES].join(', ')}`,
      });
    }

    const doc = await prisma.document.create({
      data: {
        title: title?.trim() || 'Untitled Document',
        description: description?.trim() || '',
        roomId: roomId?.trim() || `room-${makeId()}`,
        status: status || 'active',
        ownerId: req.user.id,
        members: {
          create: {
            userId: req.user.id,
            role: DocumentRole.OWNER,
          },
        },
      },
    });

    res.status(201).json(doc);
  } catch (error) {
    console.error('Failed to create document', error);
    res.status(500).json({ error: 'Failed to create document' });
  }
});

app.get('/documents', requireAuth, async (req, res) => {
  try {
    const docs = await prisma.document.findMany({
      where: {
        OR: [
          { ownerId: req.user.id },
          { members: { some: { userId: req.user.id } } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(docs);
  } catch (error) {
    console.error('Failed to list documents', error);
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

app.get('/documents/:id', requireAuth, async (req, res) => {
  try {
    const doc = await prisma.document.findFirst({
      where: {
        id: req.params.id,
        OR: [
          { ownerId: req.user.id },
          { members: { some: { userId: req.user.id } } },
        ],
      },
    });
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    return res.json(doc);
  } catch (error) {
    console.error('Failed to fetch document', error);
    res.status(500).json({ error: 'Failed to fetch document' });
  }
});

app.get('/documents/:id/members', requireAuth, async (req, res) => {
  try {
    const doc = await findDocumentForUser(req.user.id, req.params.id, { id: true });
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const members = await prisma.documentMember.findMany({
      where: { documentId: doc.id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
            accentColor: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });

    return res.json(members.map(mapMember));
  } catch (error) {
    console.error('Failed to list members', error);
    res.status(500).json({ error: 'Failed to list members' });
  }
});

app.patch('/documents/:id', requireAuth, async (req, res) => {
  try {
    const { title, description, status } = req.body || {};

    if (title !== undefined && typeof title !== 'string') {
      return res.status(400).json({ error: 'title must be a string' });
    }

    if (description !== undefined && typeof description !== 'string') {
      return res.status(400).json({ error: 'description must be a string' });
    }

    if (status !== undefined && !ALLOWED_STATUSES.has(status)) {
      return res.status(400).json({
        error: `status must be one of: ${[...ALLOWED_STATUSES].join(', ')}`,
      });
    }

    const doc = await prisma.document.findFirst({
      where: {
        id: req.params.id,
        OR: [
          { ownerId: req.user.id },
          {
            members: {
              some: {
                userId: req.user.id,
                role: { in: [DocumentRole.OWNER, DocumentRole.EDITOR] },
              },
            },
          },
        ],
      },
    });

    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const updateData = {};
    if (title !== undefined) {
      updateData.title = title.trim() || 'Untitled Document';
    }
    if (description !== undefined) {
      updateData.description = description.trim();
    }
    if (status !== undefined) {
      updateData.status = status;
    }

    const updated = await prisma.document.update({
      where: { id: doc.id },
      data: updateData,
    });

    return res.json(updated);
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Document not found' });
    }
    console.error('Failed to update document', error);
    res.status(500).json({ error: 'Failed to update document' });
  }
});

app.delete('/documents/:id', requireAuth, async (req, res) => {
  try {
    const doc = await prisma.document.findFirst({
      where: {
        id: req.params.id,
        ownerId: req.user.id,
      },
    });

    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    await prisma.document.delete({ where: { id: doc.id } });
    res.status(204).send();
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Document not found' });
    }
    console.error('Failed to delete document', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

app.get('/documents/:id/snapshot', requireAuthOrService, async (req, res) => {
  try {
    const isServiceRequest = req.headers['x-service-api-key'] === SERVICE_API_KEY;
    
    let doc;
    if (isServiceRequest) {
      // Service requests can access any document
      doc = await prisma.document.findUnique({
        where: { id: req.params.id },
        select: { snapshot: true, updatedAt: true },
      });
    } else {
      // User requests need permission check
      doc = await prisma.document.findFirst({
        where: {
          id: req.params.id,
          OR: [
            { ownerId: req.user.id },
            { members: { some: { userId: req.user.id } } },
          ],
        },
        select: { snapshot: true, updatedAt: true },
      });
    }

    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (!doc.snapshot) {
      return res.status(204).send();
    }

    return res.json({ snapshot: doc.snapshot, updatedAt: doc.updatedAt });
  } catch (error) {
    console.error('Failed to fetch snapshot', error);
    res.status(500).json({ error: 'Failed to fetch snapshot' });
  }
});

app.put('/documents/:id/snapshot', requireAuthOrService, async (req, res) => {
  try {
    const { snapshot } = req.body || {};
    if (typeof snapshot !== 'string') {
      return res.status(400).json({ error: 'snapshot must be a base64 string' });
    }

    // Check if this is a service request
    const isServiceRequest = req.headers['x-service-api-key'] === SERVICE_API_KEY;
    
    let doc;
    if (isServiceRequest) {
      // Service requests can save to any document (just verify it exists)
      doc = await prisma.document.findUnique({
        where: { id: req.params.id },
      });
    } else {
      // User requests need permission check
      doc = await prisma.document.findFirst({
        where: {
          id: req.params.id,
          OR: [
            { ownerId: req.user.id },
            { members: { some: { userId: req.user.id } } },
          ],
        },
      });
    }

    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const updateData = { snapshot };
    if (!isServiceRequest && req.user) {
      updateData.lastEditedBy = req.user.id;
    }

    const updated = await prisma.document.update({
      where: { id: doc.id },
      data: updateData,
      select: { snapshot: true, updatedAt: true },
    });

    return res.json(updated);
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Document not found' });
    }
    console.error('Failed to save snapshot', error);
    res.status(500).json({ error: 'Failed to save snapshot' });
  }
});


// --- Document Sharing Endpoints ---

// List all members for a document (requires access)
app.get('/documents/:id/members', requireAuth, async (req, res) => {
  try {
    const doc = await findDocumentForUser(req.user.id, req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const members = await prisma.documentMember.findMany({
      where: { documentId: req.params.id },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json(members.map(mapMember));
  } catch (error) {
    console.error('Failed to list members', error);
    res.status(500).json({ error: 'Failed to list members' });
  }
});

// Invite/add a member (OWNER only)
app.post('/documents/:id/members', requireAuth, async (req, res) => {
  try {
    const { email, role } = req.body || {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'email is required' });
    }
    if (!role || !ALLOWED_ROLES.has(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    const doc = await prisma.document.findFirst({
      where: { id: req.params.id, ownerId: req.user.id },
    });
    if (!doc) return res.status(403).json({ error: 'Only owner can invite' });
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Optionally: send invite email, create user as placeholder
      user = await prisma.user.create({
        data: {
          email,
          name: null,
          accentColor: '#54a0ff',
          authProvider: 'GOOGLE',
          authProviderId: `pending-${email}`,
        },
      });
    }
    // Upsert membership
    const member = await prisma.documentMember.upsert({
      where: { documentId_userId: { documentId: doc.id, userId: user.id } },
      update: { role },
      create: { documentId: doc.id, userId: user.id, role },
      include: { user: true },
    });
    res.status(201).json(mapMember(member));
  } catch (error) {
    console.error('Failed to add member', error);
    res.status(500).json({ error: 'Failed to add member' });
  }
});

// Update a member's role (OWNER only, cannot demote self)
app.patch('/documents/:id/members/:memberId', requireAuth, async (req, res) => {
  try {
    const { role } = req.body || {};
    if (!role || !ALLOWED_ROLES.has(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    const doc = await prisma.document.findFirst({
      where: { id: req.params.id, ownerId: req.user.id },
    });
    if (!doc) return res.status(403).json({ error: 'Only owner can change roles' });
    const member = await prisma.documentMember.findUnique({ where: { id: req.params.memberId }, include: { user: true } });
    if (!member || member.documentId !== doc.id) return res.status(404).json({ error: 'Member not found' });
    if (member.userId === req.user.id) return res.status(400).json({ error: 'Owner cannot demote self' });
    const updated = await prisma.documentMember.update({ where: { id: member.id }, data: { role }, include: { user: true } });
    res.json(mapMember(updated));
  } catch (error) {
    console.error('Failed to update member', error);
    res.status(500).json({ error: 'Failed to update member' });
  }
});

// Remove a member (OWNER only, cannot remove self)
app.delete('/documents/:id/members/:memberId', requireAuth, async (req, res) => {
  try {
    const doc = await prisma.document.findFirst({
      where: { id: req.params.id, ownerId: req.user.id },
    });
    if (!doc) return res.status(403).json({ error: 'Only owner can remove members' });
    const member = await prisma.documentMember.findUnique({ where: { id: req.params.memberId } });
    if (!member || member.documentId !== doc.id) return res.status(404).json({ error: 'Member not found' });
    if (member.userId === req.user.id) return res.status(400).json({ error: 'Owner cannot remove self' });
    await prisma.documentMember.delete({ where: { id: member.id } });
    res.status(204).send();
  } catch (error) {
    console.error('Failed to remove member', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

app.listen(port, () => {
  console.log(`📦 Backend API listening on http://localhost:${port}`);
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});


