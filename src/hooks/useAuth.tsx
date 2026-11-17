import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleAuthProvider,
  handleFirestoreError,
  OperationType,
} from '../services/firebase.ts';
import { api } from '../services/api.ts';
import type {
  AlertRule,
  AqiStandard,
  CustomMarker,
  MarkerType,
  PollutionAlert,
  SavedLocation,
} from '../types/env.ts';

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  role: 'user' | 'admin';
  authProvider: 'firebase' | 'local';
}

interface AuthContextValue {
  user: AppUser | null;
  authLoading: boolean;
  token: string | null;
  markers: CustomMarker[];
  savedLocations: SavedLocation[];
  alertRules: AlertRule[];
  alerts: PollutionAlert[];
  loginWithGoogle: () => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  createMarker: (payload: {
    name: string;
    description: string;
    markerType: MarkerType;
    lat: number;
    lon: number;
  }) => Promise<CustomMarker>;
  updateMarker: (
    id: string,
    payload: Partial<{
      name: string;
      description: string;
      markerType: MarkerType;
      lat: number;
      lon: number;
    }>
  ) => Promise<void>;
  deleteMarker: (id: string) => Promise<void>;
  saveLocation: (payload: {
    name: string;
    country: string;
    region: string;
    lat: number;
    lon: number;
    isPrimary?: boolean;
  }) => Promise<void>;
  setPrimaryLocation: (id: string) => Promise<void>;
  deleteSavedLocation: (id: string) => Promise<void>;
  createAlertRule: (payload: {
    locationName: string;
    lat: number;
    lon: number;
    metric: string;
    threshold: number;
    enabled: boolean;
    emailNotify: boolean;
  }) => Promise<void>;
  toggleAlertRule: (id: string, enabled: boolean) => Promise<void>;
  deleteAlertRule: (id: string) => Promise<void>;
  updateAlertStatus: (id: string, status: 'active' | 'acknowledged' | 'dismissed') => Promise<void>;
  pushRealtimeAlert: (alert: PollutionAlert) => void;
  preferredStandard: AqiStandard;
  setPreferredStandard: (std: AqiStandard) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const LOCAL_SESSION_KEY = 'aethergrid_local_session_v1';

function tsToIso(val: unknown): string {
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

function sanitizeAlertForFirestore(
  alert: PollutionAlert,
  ownerUid: string,
  statusOverride?: 'active' | 'acknowledged' | 'dismissed'
) {
  const validSourceTypes = new Set(['observed', 'modeled', 'forecast']);
  const validSeverities = new Set(['moderate', 'high', 'critical']);
  const validStatuses = new Set(['active', 'acknowledged', 'dismissed']);

  const safeId = String(alert.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128) || `alt-${crypto.randomUUID().slice(0, 12)}`;
  const safeRuleId = String(alert.ruleId || 'rul-default').slice(0, 128) || 'rul-default';
  const safeLocation = String(alert.locationName || 'Monitored Location').trim().slice(0, 120) || 'Monitored Location';
  const safeMetric = String(alert.metric || 'pm2_5').trim().slice(0, 32) || 'pm2_5';
  const safeSourceType = validSourceTypes.has(alert.sourceType) ? alert.sourceType : 'modeled';
  const safeSourceLabel = String(alert.sourceLabel || 'Open-Meteo CAMS').trim().slice(0, 120) || 'Open-Meteo CAMS';
  const safeSeverity = validSeverities.has(alert.severity) ? alert.severity : 'moderate';
  const candidateStatus = statusOverride ?? alert.status;
  const safeStatus = validStatuses.has(candidateStatus) ? candidateStatus : 'active';
  const safeDedupe = String(alert.dedupeKey || `${safeRuleId}:${safeMetric}`).trim().slice(0, 160) || `${safeRuleId}:${safeMetric}`;

  return {
    id: safeId,
    ownerId: ownerUid,
    ruleId: safeRuleId,
    locationName: safeLocation,
    metric: safeMetric,
    observedValue: Math.max(0, Number.isFinite(Number(alert.observedValue)) ? Number(alert.observedValue) : 0),
    threshold: Math.max(0, Number.isFinite(Number(alert.threshold)) ? Number(alert.threshold) : 0),
    sourceType: safeSourceType,
    sourceLabel: safeSourceLabel,
    severity: safeSeverity,
    status: safeStatus,
    dedupeKey: safeDedupe,
    triggeredAt: serverTimestamp(),
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [markers, setMarkers] = useState<CustomMarker[]>([]);
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>([]);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [alerts, setAlerts] = useState<PollutionAlert[]>([]);
  const [preferredStandard, setPreferredStandard] = useState<AqiStandard>('US_AQI');

  const userRef = useRef<AppUser | null>(null);
  const alertsRef = useRef<PollutionAlert[]>([]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    alertsRef.current = alerts;
  }, [alerts]);

  const refreshLocalData = useCallback(async (jwt: string) => {
    try {
      const [mRes, lRes, aRes] = await Promise.all([
        api.getMarkers(jwt),
        api.getSavedLocations(jwt),
        api.getAlerts(jwt),
      ]);
      setMarkers(mRes.markers);
      setSavedLocations(lRes.locations);
      setAlertRules(aRes.rules);
      setAlerts(aRes.alerts);
    } catch (err) {
      console.error('Failed loading user session data:', err);
    }
  }, []);

  // Restore local JWT session or listen to Firebase Auth state
  useEffect(() => {
    const savedRaw = localStorage.getItem(LOCAL_SESSION_KEY);
    if (savedRaw) {
      try {
        const parsed = JSON.parse(savedRaw) as { token: string; user: AppUser };
        if (parsed.token && parsed.user) {
          setUser(parsed.user);
          setToken(parsed.token);
          void refreshLocalData(parsed.token);
        }
      } catch {
        localStorage.removeItem(LOCAL_SESSION_KEY);
      }
    }

    const unsub = onAuthStateChanged(auth, async (fbUser: FirebaseUser | null) => {
      if (fbUser) {
        localStorage.removeItem(LOCAL_SESSION_KEY);
        const idToken = await fbUser.getIdToken();
        const email = fbUser.email || '';
        const role: 'user' | 'admin' =
          email.toLowerCase() === 'whitesangjr07@gmail.com' ? 'admin' : 'user';
        setUser({
          uid: fbUser.uid,
          email,
          displayName: fbUser.displayName || email.split('@')[0] || 'User',
          role,
          authProvider: 'firebase',
        });
        setToken(idToken);

        // Ensure Firestore user profile exists
        try {
          const userRef = doc(db, 'users', fbUser.uid);
          const snap = await getDoc(userRef);
          if (!snap.exists()) {
            await setDoc(userRef, {
              uid: fbUser.uid,
              email,
              displayName: fbUser.displayName || email.split('@')[0] || 'User',
              role: 'user',
              preferredStandard: 'US_AQI',
              refreshIntervalSec: 300,
              emailAlertsEnabled: false,
              theme: 'dark',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } else {
            const data = snap.data();
            if (data?.preferredStandard === 'EU_AQI' || data?.preferredStandard === 'US_AQI') {
              setPreferredStandard(data.preferredStandard);
            }
          }
        } catch (err) {
          console.warn('Firestore profile sync skipped:', err);
        }
      } else {
        // Only clear if not using local JWT session
        if (!localStorage.getItem(LOCAL_SESSION_KEY)) {
          setUser(null);
          setToken(null);
          setMarkers([]);
          setSavedLocations([]);
          setAlertRules([]);
          setAlerts([]);
        }
      }
      setAuthLoading(false);
    });

    return () => unsub();
  }, [refreshLocalData]);

  // Attach Firestore realtime listeners when signed in via Firebase Auth
  useEffect(() => {
    if (!user || user.authProvider !== 'firebase') return;

    const uid = user.uid;

    const unsubMarkers = onSnapshot(
      query(collection(db, 'markers'), where('ownerId', '==', uid)),
      (snap) => {
        const list: CustomMarker[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ownerId: String(data.ownerId),
            name: String(data.name),
            description: String(data.description || ''),
            markerType: data.markerType as MarkerType,
            lat: Number(data.lat),
            lon: Number(data.lon),
            createdAt: tsToIso(data.createdAt),
            updatedAt: tsToIso(data.updatedAt),
          };
        });
        setMarkers(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'markers')
    );

    const unsubSaved = onSnapshot(
      query(collection(db, 'savedLocations'), where('ownerId', '==', uid)),
      (snap) => {
        const list: SavedLocation[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ownerId: String(data.ownerId),
            name: String(data.name),
            country: String(data.country || ''),
            region: String(data.region || ''),
            lat: Number(data.lat),
            lon: Number(data.lon),
            isPrimary: Boolean(data.isPrimary),
            createdAt: tsToIso(data.createdAt),
          };
        });
        setSavedLocations(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'savedLocations')
    );

    const unsubRules = onSnapshot(
      query(collection(db, 'alertRules'), where('ownerId', '==', uid)),
      (snap) => {
        const list: AlertRule[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ownerId: String(data.ownerId),
            locationName: String(data.locationName),
            lat: Number(data.lat),
            lon: Number(data.lon),
            metric: data.metric,
            threshold: Number(data.threshold),
            enabled: Boolean(data.enabled),
            emailNotify: Boolean(data.emailNotify),
            lastTriggeredAt: String(data.lastTriggeredAt || ''),
            createdAt: tsToIso(data.createdAt),
            updatedAt: tsToIso(data.updatedAt),
          };
        });
        setAlertRules(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'alertRules')
    );

    const unsubAlerts = onSnapshot(
      query(collection(db, 'alerts'), where('ownerId', '==', uid)),
      (snap) => {
        const list: PollutionAlert[] = snap.docs
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              ownerId: String(data.ownerId),
              ruleId: String(data.ruleId),
              locationName: String(data.locationName),
              metric: String(data.metric),
              observedValue: Number(data.observedValue),
              threshold: Number(data.threshold),
              sourceType: data.sourceType,
              sourceLabel: String(data.sourceLabel),
              severity: data.severity,
              status: data.status,
              dedupeKey: String(data.dedupeKey),
              triggeredAt: tsToIso(data.triggeredAt),
            };
          })
          .sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));
        setAlerts(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'alerts')
    );

    return () => {
      unsubMarkers();
      unsubSaved();
      unsubRules();
      unsubAlerts();
    };
  }, [user]);

  const loginWithGoogle = async () => {
    await signInWithPopup(auth, googleAuthProvider);
  };

  const loginWithEmail = async (email: string, password: string) => {
    const res = await api.login(email, password);
    const appUser: AppUser = {
      uid: res.user.uid,
      email: res.user.email,
      displayName: res.user.displayName,
      role: res.user.role,
      authProvider: 'local',
    };
    localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ token: res.token, user: appUser }));
    setUser(appUser);
    setToken(res.token);
    setPreferredStandard(res.user.preferredStandard);
    await refreshLocalData(res.token);
  };

  const registerWithEmail = async (email: string, password: string, displayName: string) => {
    const res = await api.register(email, password, displayName);
    const appUser: AppUser = {
      uid: res.user.uid,
      email: res.user.email,
      displayName: res.user.displayName,
      role: res.user.role,
      authProvider: 'local',
    };
    localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ token: res.token, user: appUser }));
    setUser(appUser);
    setToken(res.token);
    await refreshLocalData(res.token);
  };

  const logout = async () => {
    localStorage.removeItem(LOCAL_SESSION_KEY);
    if (auth.currentUser) {
      await signOut(auth);
    }
    setUser(null);
    setToken(null);
    setMarkers([]);
    setSavedLocations([]);
    setAlertRules([]);
    setAlerts([]);
  };

  const createMarker = async (payload: {
    name: string;
    description: string;
    markerType: MarkerType;
    lat: number;
    lon: number;
  }): Promise<CustomMarker> => {
    if (!user || !token) throw new Error('Please sign in to save custom markers.');

    if (user.authProvider === 'firebase') {
      const id = `mrk-${crypto.randomUUID().slice(0, 12)}`;
      try {
        await setDoc(doc(db, 'markers', id), {
          id,
          ownerId: user.uid,
          name: payload.name.trim().slice(0, 120),
          description: payload.description.trim().slice(0, 500),
          markerType: payload.markerType,
          lat: Number(payload.lat.toFixed(6)),
          lon: Number(payload.lon.toFixed(6)),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `markers/${id}`);
      }
      return {
        id,
        ownerId: user.uid,
        name: payload.name,
        description: payload.description,
        markerType: payload.markerType,
        lat: Number(payload.lat.toFixed(6)),
        lon: Number(payload.lon.toFixed(6)),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    const res = await api.createMarker(token, payload);
    setMarkers((prev) => [...prev, res.marker]);
    return res.marker;
  };

  const updateMarker = async (
    id: string,
    payload: Partial<{
      name: string;
      description: string;
      markerType: MarkerType;
      lat: number;
      lon: number;
    }>
  ) => {
    if (!user || !token) throw new Error('Authentication required.');
    if (user.authProvider === 'firebase') {
      try {
        await updateDoc(doc(db, 'markers', id), {
          ...payload,
          ...(payload.lat !== undefined ? { lat: Number(payload.lat.toFixed(6)) } : {}),
          ...(payload.lon !== undefined ? { lon: Number(payload.lon.toFixed(6)) } : {}),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `markers/${id}`);
      }
      return;
    }
    const res = await api.updateMarker(token, id, payload);
    setMarkers((prev) => prev.map((m) => (m.id === id ? res.marker : m)));
  };

  const deleteMarker = async (id: string) => {
    if (!user || !token) throw new Error('Authentication required.');
    if (user.authProvider === 'firebase') {
      try {
        await deleteDoc(doc(db, 'markers', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `markers/${id}`);
      }
      return;
    }
    await api.deleteMarker(token, id);
    setMarkers((prev) => prev.filter((m) => m.id !== id));
  };

  const saveLocation = async (payload: {
    name: string;
    country: string;
    region: string;
    lat: number;
    lon: number;
    isPrimary?: boolean;
  }) => {
    if (!user || !token) throw new Error('Please sign in to save locations.');
    if (user.authProvider === 'firebase') {
      const id = `loc-${crypto.randomUUID().slice(0, 12)}`;
      try {
        await setDoc(doc(db, 'savedLocations', id), {
          id,
          ownerId: user.uid,
          name: payload.name.slice(0, 120),
          country: payload.country.slice(0, 100),
          region: payload.region.slice(0, 120),
          lat: Number(payload.lat.toFixed(5)),
          lon: Number(payload.lon.toFixed(5)),
          isPrimary: Boolean(payload.isPrimary),
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `savedLocations/${id}`);
      }
      return;
    }
    const res = await api.createSavedLocation(token, payload);
    setSavedLocations((prev) => [...prev, res.location]);
  };

  const setPrimaryLocation = async (id: string) => {
    if (!user || !token) return;
    if (user.authProvider === 'firebase') {
      try {
        for (const loc of savedLocations) {
          await updateDoc(doc(db, 'savedLocations', loc.id), {
            isPrimary: loc.id === id,
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `savedLocations/${id}`);
      }
      return;
    }
    await api.setPrimarySavedLocation(token, id);
    setSavedLocations((prev) => prev.map((l) => ({ ...l, isPrimary: l.id === id })));
  };

  const deleteSavedLocation = async (id: string) => {
    if (!user || !token) return;
    if (user.authProvider === 'firebase') {
      try {
        await deleteDoc(doc(db, 'savedLocations', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `savedLocations/${id}`);
      }
      return;
    }
    await api.deleteSavedLocation(token, id);
    setSavedLocations((prev) => prev.filter((l) => l.id !== id));
  };

  const createAlertRule = async (payload: {
    locationName: string;
    lat: number;
    lon: number;
    metric: string;
    threshold: number;
    enabled: boolean;
    emailNotify: boolean;
  }) => {
    if (!user || !token) throw new Error('Please sign in to create alert rules.');
    const ruleId = `rul-${crypto.randomUUID().slice(0, 12)}`;
    if (user.authProvider === 'firebase') {
      try {
        await setDoc(doc(db, 'alertRules', ruleId), {
          id: ruleId,
          ownerId: user.uid,
          locationName: payload.locationName.slice(0, 120),
          lat: payload.lat,
          lon: payload.lon,
          metric: payload.metric,
          threshold: payload.threshold,
          enabled: payload.enabled,
          emailNotify: payload.emailNotify,
          lastTriggeredAt: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `alertRules/${ruleId}`);
      }
    }
    // Also register with backend worker using the same ruleId so live polling evaluates this rule
    const res = await api.createAlertRule(token, { id: ruleId, ...payload });
    if (user.authProvider === 'local') {
      setAlertRules((prev) => [...prev, res.rule]);
    }
  };

  const toggleAlertRule = async (id: string, enabled: boolean) => {
    if (!user || !token) return;
    if (user.authProvider === 'firebase') {
      try {
        await updateDoc(doc(db, 'alertRules', id), {
          enabled,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `alertRules/${id}`);
      }
      void api.updateAlertRule(token, id, { enabled }).catch(() => {});
      return;
    }
    const res = await api.updateAlertRule(token, id, { enabled });
    setAlertRules((prev) => prev.map((r) => (r.id === id ? res.rule : r)));
  };

  const deleteAlertRule = async (id: string) => {
    if (!user || !token) return;
    if (user.authProvider === 'firebase') {
      try {
        await deleteDoc(doc(db, 'alertRules', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `alertRules/${id}`);
      }
      void api.deleteAlertRule(token, id).catch(() => {});
      return;
    }
    await api.deleteAlertRule(token, id);
    setAlertRules((prev) => prev.filter((r) => r.id !== id));
  };

  const updateAlertStatus = async (
    id: string,
    status: 'active' | 'acknowledged' | 'dismissed'
  ) => {
    if (!user || !token) return;
    if (user.authProvider === 'firebase') {
      const alertRef = doc(db, 'alerts', id);
      try {
        await updateDoc(alertRef, { status });
      } catch (updateErr) {
        const localAlert = alertsRef.current.find((a) => a.id === id);
        if (localAlert) {
          try {
            await setDoc(alertRef, sanitizeAlertForFirestore(localAlert, user.uid, status));
          } catch (createErr) {
            handleFirestoreError(createErr, OperationType.UPDATE, `alerts/${id}`);
          }
        } else {
          handleFirestoreError(updateErr, OperationType.UPDATE, `alerts/${id}`);
        }
      }
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
      void api.updateAlertStatus(token, id, status).catch(() => {});
      return;
    }
    const res = await api.updateAlertStatus(token, id, status);
    setAlerts((prev) => prev.map((a) => (a.id === id ? res.alert : a)));
  };

  const pushRealtimeAlert = useCallback(async (incomingAlert: PollutionAlert) => {
    setAlerts((prev) => {
      if (prev.some((a) => a.id === incomingAlert.id || a.dedupeKey === incomingAlert.dedupeKey)) {
        return prev;
      }
      return [incomingAlert, ...prev];
    });
    const activeUser = userRef.current;
    if (activeUser?.authProvider === 'firebase') {
      try {
        await setDoc(
          doc(db, 'alerts', incomingAlert.id),
          sanitizeAlertForFirestore(incomingAlert, activeUser.uid)
        );
      } catch (err) {
        console.warn('Firestore realtime alert sync deferred:', err);
      }
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        authLoading,
        token,
        markers,
        savedLocations,
        alertRules,
        alerts,
        loginWithGoogle,
        loginWithEmail,
        registerWithEmail,
        logout,
        createMarker,
        updateMarker,
        deleteMarker,
        saveLocation,
        setPrimaryLocation,
        deleteSavedLocation,
        createAlertRule,
        toggleAlertRule,
        deleteAlertRule,
        updateAlertStatus,
        pushRealtimeAlert,
        preferredStandard,
        setPreferredStandard,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
