import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  OperationType,
  auth,
  db,
  googleProvider,
  handleFirestoreError,
} from '../lib/firebase';
import type { ServerKeyUsage, UserProfile } from '../types';

const BOOTSTRAP_ADMIN_EMAIL = 'predimahrobi@gmail.com';

export function generateApiKey(isAdmin: boolean): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let token = '';
  for (let i = 0; i < bytes.length; i++) {
    token += chars[bytes[i] % chars.length];
  }
  return `${isAdmin ? 'kmk_adm_' : 'kmk_usr_'}${token}`;
}

interface AuthContextValue {
  firebaseUser: User | null;
  userProfile: UserProfile | null;
  liveUsage: ServerKeyUsage | null;
  loading: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  regenerateApiKey: () => Promise<void>;
  refreshUsage: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [liveUsage, setLiveUsage] = useState<ServerKeyUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const syncWithBackend = useCallback(async (fbUser: User, profile: UserProfile) => {
    try {
      const idToken = await fbUser.getIdToken();
      const res = await fetch('/api/auth/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          apiKey: profile.apiKey,
          role: profile.role,
          plan: profile.plan,
          dailyLimit: profile.dailyLimit,
          status: profile.status,
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as { status: boolean; data?: ServerKeyUsage };
        if (json.data) {
          setLiveUsage(json.data);
        }
      }
    } catch {
      // Non-blocking backend sync
    }
  }, []);

  const ensureUserProfile = useCallback(
    async (fbUser: User) => {
      const userPath = `users/${fbUser.uid}`;
      const userRef = doc(db, 'users', fbUser.uid);
      const isBootstrapAdmin =
        (fbUser.email || '').toLowerCase() === BOOTSTRAP_ADMIN_EMAIL && fbUser.emailVerified;

      let snap;
      try {
        snap = await getDoc(userRef);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, userPath);
      }

      const safeName = (fbUser.displayName || fbUser.email?.split('@')[0] || 'Developer').slice(0, 120);
      const safePhoto = (fbUser.photoURL || '').slice(0, 500);
      const safeEmail = (fbUser.email || '').slice(0, 254);

      if (!snap.exists()) {
        const newProfile: UserProfile = {
          uid: fbUser.uid,
          email: safeEmail,
          displayName: safeName,
          photoURL: safePhoto,
          role: isBootstrapAdmin ? 'admin' : 'user',
          plan: isBootstrapAdmin ? 'admin_unlimited' : 'free',
          apiKey: generateApiKey(isBootstrapAdmin),
          dailyLimit: isBootstrapAdmin ? -1 : 1000,
          requestsToday: 0,
          requestsTotal: 0,
          status: 'active',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          lastLoginAt: serverTimestamp(),
        };

        try {
          await setDoc(userRef, newProfile);
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, userPath);
        }

        setUserProfile(newProfile);
        await syncWithBackend(fbUser, newProfile);
      } else {
        const existing = snap.data() as UserProfile;
        const updates: Record<string, unknown> = {
          displayName: safeName,
          photoURL: safePhoto,
          lastLoginAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        if (isBootstrapAdmin && existing.role !== 'admin') {
          updates.role = 'admin';
          updates.plan = 'admin_unlimited';
          updates.dailyLimit = -1;
        }

        try {
          await updateDoc(userRef, updates);
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, userPath);
        }

        const merged: UserProfile = {
          ...existing,
          displayName: safeName,
          photoURL: safePhoto,
          role: isBootstrapAdmin ? 'admin' : existing.role,
          plan: isBootstrapAdmin ? 'admin_unlimited' : existing.plan,
          dailyLimit: isBootstrapAdmin ? -1 : existing.dailyLimit,
        };
        setUserProfile(merged);
        await syncWithBackend(fbUser, merged);
      }
    },
    [syncWithBackend]
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        try {
          await ensureUserProfile(user);
          setAuthError(null);
        } catch (err) {
          setAuthError(err instanceof Error ? err.message : 'Gagal memuat profil pengguna.');
        }
      } else {
        setUserProfile(null);
        setLiveUsage(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [ensureUserProfile]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal login dengan Google OAuth.';
      setAuthError(msg);
      throw err;
    }
  }, []);

  const signOutUser = useCallback(async () => {
    await signOut(auth);
    setUserProfile(null);
    setLiveUsage(null);
  }, []);

  const regenerateApiKey = useCallback(async () => {
    if (!firebaseUser || !userProfile) return;
    const isAdmin = userProfile.role === 'admin';
    const nextKey = generateApiKey(isAdmin);
    const userPath = `users/${firebaseUser.uid}`;
    const userRef = doc(db, 'users', firebaseUser.uid);

    try {
      await updateDoc(userRef, {
        apiKey: nextKey,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, userPath);
    }

    const updatedProfile: UserProfile = { ...userProfile, apiKey: nextKey };
    setUserProfile(updatedProfile);
    await syncWithBackend(firebaseUser, updatedProfile);
  }, [firebaseUser, userProfile, syncWithBackend]);

  const refreshUsage = useCallback(async () => {
    if (!firebaseUser) return;
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/user/usage', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.ok) {
        const json = (await res.json()) as { status: boolean; data?: ServerKeyUsage | null };
        if (json.data) {
          setLiveUsage(json.data);
        }
      }
    } catch {
      // Ignore transient network error
    }
  }, [firebaseUser]);

  const getIdToken = useCallback(async () => {
    if (!firebaseUser) return null;
    return firebaseUser.getIdToken();
  }, [firebaseUser]);

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        userProfile,
        liveUsage,
        loading,
        authError,
        signInWithGoogle,
        signOutUser,
        regenerateApiKey,
        refreshUsage,
        getIdToken,
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
