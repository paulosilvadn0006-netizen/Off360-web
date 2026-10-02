import React from "react";
import { toast } from "sonner";

// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
export function startGoogle(role = "consumer", taxi = false) {
  const redirectUrl = `${window.location.origin}/auth/callback?role=${role}${taxi ? "&taxi=1" : ""}`;
  window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
}

export function GoogleBtn({ onClick }) {
  return (
    <button type="button" data-testid="google-btn" onClick={onClick}
      className="flex h-12 items-center justify-center gap-2 rounded-xl border border-off-blue/40 bg-white text-sm font-semibold text-gray-700 transition-transform active:scale-[0.98]">
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.5 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/>
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.5 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
        <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35 26.7 36 24 36c-5.3 0-9.7-3.1-11.3-7.8l-6.5 5C9.6 39.6 16.2 44 24 44z"/>
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.3C41.3 36.3 44 30.7 44 24c0-1.3-.1-2.3-.4-3.5z"/>
      </svg>
      Google
    </button>
  );
}

export function FacebookBtn() {
  return (
    <button type="button" data-testid="facebook-btn" onClick={() => toast("Login com Facebook em breve.")}
      className="flex h-12 items-center justify-center gap-2 rounded-xl border border-off-blue/40 bg-[#1877F2] text-sm font-semibold text-white transition-transform active:scale-[0.98]">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.95.93-1.95 1.89v2.25h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07z"/></svg>
      Facebook
    </button>
  );
}
