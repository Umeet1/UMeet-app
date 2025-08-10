import { create } from 'zustand';

export type User = {
  id: string;
  phone: string;
  displayName: string;
  avatarUrl?: string | null;
};

type AuthState = {
  user: User | null;
  setUser: (user: User | null) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
}));