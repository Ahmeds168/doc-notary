import { useEffect, useState } from "react";
import { supabase } from "./supabase.js";

/** Current Supabase session (or null). `ready` is false until the stored session is loaded. */
export function useSession() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(!supabase);

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return { session, ready, authConfigured: Boolean(supabase) };
}
