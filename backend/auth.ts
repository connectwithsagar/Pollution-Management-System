import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };

if (!getApps().length && firebaseConfig?.projectId) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const adminAuth = getApps().length ? getAuth() : null;

const JWT_SECRET = process.env.JWT_SECRET || 'aethergrid-dev-ephemeral-secret-2026';
const ADMIN_EMAILS = new Set(['whitesangjr07@gmail.com']);

export interface AuthUser {
  uid: string;
  email: string;
  displayName: string;
  role: 'user' | 'admin';
  provider: 'firebase' | 'local';
}

export interface AuthRequest extends Request {
  authUser?: AuthUser;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (derivedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(derivedBuf, expectedBuf);
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input: string): string {
  const padLen = (4 - (input.length % 4)) % 4;
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
  return Buffer.from(padded, 'base64').toString('utf-8');
}

export interface JwtPayload {
  uid: string;
  email: string;
  displayName: string;
  role: 'user' | 'admin';
  exp: number;
}

export function signJwt(payload: Omit<JwtPayload, 'exp'>, ttlSec = 60 * 60 * 24 * 7): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const fullPayload: JwtPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSec,
  };
  const body = base64UrlEncode(JSON.stringify(fullPayload));
  const sig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest();
  return `${header}.${body}.${base64UrlEncode(sig)}`;
}

export function verifyLocalJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expectedSig = base64UrlEncode(
      crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest()
    );
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }
    const decoded = JSON.parse(base64UrlDecode(body)) as JwtPayload;
    if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export async function resolveAuthToken(token: string): Promise<AuthUser | null> {
  const local = verifyLocalJwt(token);
  if (local) {
    return {
      uid: local.uid,
      email: local.email,
      displayName: local.displayName,
      role: ADMIN_EMAILS.has(local.email.toLowerCase()) ? 'admin' : local.role,
      provider: 'local',
    };
  }

  if (adminAuth) {
    try {
      const decoded = await adminAuth.verifyIdToken(token);
      const email = decoded.email || '';
      return {
        uid: decoded.uid,
        email,
        displayName: decoded.name || email.split('@')[0] || 'User',
        role: ADMIN_EMAILS.has(email.toLowerCase()) ? 'admin' : 'user',
        provider: 'firebase',
      };
    } catch {
      return null;
    }
  }

  return null;
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Missing Bearer token.' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  const user = await resolveAuthToken(token);
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired authentication token.' });
    return;
  }
  req.authUser = user;
  next();
}
