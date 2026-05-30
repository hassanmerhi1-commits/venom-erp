import { useEffect, useState } from "react";
import { dbRead, dbWrite } from "@/lib/db";

export type Role = "admin" | "user";
export type User = { username: string; password: string; role: Role; createdAt: string };

const USERS_KEY = "erp.users.v1";
const LEGACY_SESSION_KEY = "erp.session.v1";

/** Session lives in memory only — app restart always requires login. */
let memorySession: { username: string; role: Role } | null = null;

if (typeof window !== "undefined") {
  try { window.localStorage.removeItem(LEGACY_SESSION_KEY); } catch { /* ignore */ }
}

function readUsers(): User[] {
  if (typeof window === "undefined") return [];
  const list = dbRead<User[]>(USERS_KEY, []);
  if (!list || list.length === 0 || !list.some((u) => u.role === "admin")) {
    const seeded: User[] = [
      ...list.filter((u) => u.username.toLowerCase() !== "admin"),
      { username: "admin", password: "admin", role: "admin", createdAt: new Date().toISOString() },
    ];
    dbWrite(USERS_KEY, seeded);
    return seeded;
  }
  return list;
}

function writeUsers(list: User[]) {
  dbWrite(USERS_KEY, list);
  window.dispatchEvent(new CustomEvent("erp:auth"));
}

export function getSession(): { username: string; role: Role } | null {
  return memorySession;
}

export function login(username: string, password: string): { ok: true } | { ok: false; error: string } {
  const list = readUsers();
  const u = list.find((x) => x.username.toLowerCase() === username.trim().toLowerCase());
  if (!u || u.password !== password) {
    return { ok: false, error: "Utilizador ou palavra-passe inválidos." };
  }
  memorySession = { username: u.username, role: u.role };
  window.dispatchEvent(new CustomEvent("erp:auth"));
  return { ok: true };
}

export function logout() {
  memorySession = null;
  window.dispatchEvent(new CustomEvent("erp:auth"));
}

export function useAuth() {
  const [session, setSession] = useState(() => getSession());
  const [users, setUsers] = useState<User[]>(() => readUsers());
  useEffect(() => {
    const sync = () => {
      setSession(getSession());
      setUsers(readUsers());
    };
    window.addEventListener("erp:auth", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("erp:auth", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return {
    session,
    users,
    addUser: (username: string, password: string, role: Role): { ok: boolean; error?: string } => {
      const u = username.trim();
      if (!u || !password) return { ok: false, error: "Preencha utilizador e palavra-passe." };
      const list = readUsers();
      if (list.some((x) => x.username.toLowerCase() === u.toLowerCase())) return { ok: false, error: "Utilizador já existe." };
      writeUsers([...list, { username: u, password, role, createdAt: new Date().toISOString() }]);
      return { ok: true };
    },
    changePassword: (username: string, newPassword: string): { ok: boolean; error?: string } => {
      if (!newPassword) return { ok: false, error: "Palavra-passe vazia." };
      const list = readUsers();
      const i = list.findIndex((x) => x.username === username);
      if (i === -1) return { ok: false, error: "Utilizador não encontrado." };
      list[i] = { ...list[i], password: newPassword };
      writeUsers(list);
      return { ok: true };
    },
    removeUser: (username: string): { ok: boolean; error?: string } => {
      const list = readUsers();
      const target = list.find((x) => x.username === username);
      if (!target) return { ok: false, error: "Utilizador não encontrado." };
      const admins = list.filter((x) => x.role === "admin");
      if (target.role === "admin" && admins.length <= 1) return { ok: false, error: "Não pode remover o único admin." };
      writeUsers(list.filter((x) => x.username !== username));
      return { ok: true };
    },
  };
}