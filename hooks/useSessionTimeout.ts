import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export function useSessionTimeout(setLoggedInUser: (user: any) => void) {
  useEffect(() => {
    const TIMEOUT_MS = 60 * 60 * 1000;
    
    // 🛡️ เช็ค Session จาก Supabase Auth โดยตรง
    const checkSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        // ถ้าเกิด Error (เช่น Invalid Refresh Token) ให้ล้างข้อมูลทิ้ง
        if (error || !session) {
          setLoggedInUser(null);
          localStorage.removeItem('buildtrack_last_active');
          return;
        }

        const lastActive = localStorage.getItem('buildtrack_last_active');
        if (session && lastActive) {
          if (Date.now() - parseInt(lastActive) < TIMEOUT_MS) {
            setLoggedInUser(session.user.user_metadata);
            localStorage.setItem('buildtrack_last_active', Date.now().toString());
          } else {
            await supabase.auth.signOut();
            setLoggedInUser(null);
            localStorage.removeItem('buildtrack_last_active');
          }
        }
      } catch (err) {
        console.warn("Session check failed:", err);
        setLoggedInUser(null);
        localStorage.removeItem('buildtrack_last_active');
      }
    };
    checkSession();

    // 📡 ฟัง Event จาก Supabase เพื่อจัดการกับ Token Expired และการ Logout อัตโนมัติ
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        setLoggedInUser(null);
        localStorage.removeItem('buildtrack_last_active');
      } else if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
        if (session) {
          setLoggedInUser(session.user.user_metadata);
          localStorage.setItem('buildtrack_last_active', Date.now().toString());
        }
      }
    });

    const updateActivity = () => {
      if (localStorage.getItem('buildtrack_last_active')) {
        const last = parseInt(localStorage.getItem('buildtrack_last_active') || '0');
        if (Date.now() - last > 30000) {
          localStorage.setItem('buildtrack_last_active', Date.now().toString());
        }
      }
    };

    window.addEventListener('mousemove', updateActivity);
    window.addEventListener('keydown', updateActivity);
    window.addEventListener('click', updateActivity);
    window.addEventListener('touchstart', updateActivity);

    const interval = setInterval(async () => {
      const lastAct = localStorage.getItem('buildtrack_last_active');
      if (lastAct && (Date.now() - parseInt(lastAct) > TIMEOUT_MS)) {
        await supabase.auth.signOut();
        setLoggedInUser(null);
        localStorage.removeItem('buildtrack_last_active');
        alert('เซสชันหมดอายุเนื่องจากไม่ได้ใช้งานเกิน 60 นาที กรุณาล็อกอินใหม่ครับ 🔒');
      }
    }, 60000);

    return () => {
      window.removeEventListener('mousemove', updateActivity);
      window.removeEventListener('keydown', updateActivity);
      window.removeEventListener('click', updateActivity);
      window.removeEventListener('touchstart', updateActivity);
      clearInterval(interval);
      authListener.subscription.unsubscribe();
    };
  }, [setLoggedInUser]);
}
