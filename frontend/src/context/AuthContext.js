import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, formatApiError } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = loading, false = logged out
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401) {
        setUser(false); // sessão realmente encerrada
      } else {
        // Erro transitório (servidor reiniciando / rede instável): não desloga, tenta 1x
        try {
          await new Promise((r) => setTimeout(r, 1500));
          const { data } = await api.get("/auth/me");
          setUser(data);
        } catch (err2) {
          if (err2?.response?.status === 401) setUser(false);
          else setUser((prev) => (prev && prev.id ? prev : false));
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    setUser(data);
    return data;
  };

  const register = async (payload) => {
    try {
      const { data } = await api.post("/auth/register", payload);
      setUser(data);
      return data;
    } catch (err) {
      // Se a conta já existe por envio duplicado/blip de rede da 1ª requisição e as
      // credenciais batem, foi este mesmo usuário → conclui como sucesso (sem falso "E-mail já cadastrado").
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;
      if (status === 400 && typeof detail === "string" && detail.toLowerCase().includes("já cadastrad") && payload?.email && payload?.password) {
        try {
          const { data } = await api.post("/auth/login", { email: payload.email, password: payload.password });
          setUser(data);
          return data;
        } catch (_) { /* senha não confere: e-mail pertence a outra pessoa */ }
      }
      throw err;
    }
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch {}
    setUser(false);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export { formatApiError };
