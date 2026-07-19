import { useState, useEffect } from 'react';

export function useWeather() {
  const [weatherInfo, setWeatherInfo] = useState<any>(null);

  const getWeatherDetails = (code: number) => {
    if (code === 0) return { icon: '☀️', text: 'ฟ้าใส แดดแรง' };
    if (code === 1 || code === 2) return { icon: '🌤️', text: 'มีเมฆบางส่วน' };
    if (code === 3) return { icon: '☁️', text: 'เมฆหนาตึบ' };
    if (code >= 45 && code <= 48) return { icon: '🌫️', text: 'มีหมอก' };
    if (code >= 51 && code <= 67) return { icon: '🌧️', text: 'ฝนตก' };
    if (code >= 80 && code <= 82) return { icon: '⛈️', text: 'ฝนตกหนัก' };
    if (code >= 95) return { icon: '🌩️', text: 'พายุฝนฟ้าคะนอง' };
    return { icon: '🌡️', text: 'สภาพอากาศปกติ' };
  };

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();
    const { signal } = controller;

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(async (position) => {
        if (!isMounted) return;
        const { latitude, longitude } = position.coords;
        try {
          const locRes = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=th`, { signal });
          const locData = await locRes.json();
          const placeName = locData.locality || locData.city || "หน้าไซต์งาน";

          const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&hourly=temperature_2m,weather_code,precipitation_probability,uv_index&timezone=auto&forecast_days=1`, { signal });
          const wData = await weatherRes.json();

          const currentHour = new Date().getHours();
          const nextHours = wData.hourly?.time?.slice(currentHour + 1, currentHour + 5).map((time: string, idx: number) => ({
            time: new Date(time).getHours() + ":00",
            temp: Math.round(wData.hourly.temperature_2m[currentHour + 1 + idx]),
            details: getWeatherDetails(wData.hourly.weather_code[currentHour + 1 + idx]),
            rainProb: wData.hourly.precipitation_probability[currentHour + 1 + idx]
          })) || [];

          const currentUV = wData.hourly?.uv_index?.[currentHour] || 0;
          const willRain = nextHours.some((h: any) => h.rainProb > 50);

          let alert = null;
          if (willRain) alert = { type: 'rain', msg: '🔵 มีโอกาสฝนตกในอีกไม่กี่ชั่วโมง เตรียมคลุมวัสดุ!' };
          else if (currentUV > 8) alert = { type: 'uv-high', msg: '🔴 UV รุนแรงมาก! หลีกเลี่ยงการตากแดดต่อเนื่อง' };
          else if (currentUV > 5) alert = { type: 'uv-med', msg: '🟠 แดดแรง ทาครีมกันแดดและดื่มน้ำบ่อยๆ นะครับ' };

          if (isMounted) {
            setWeatherInfo({
              location: placeName,
              currentTemp: Math.round(wData.current?.temperature_2m || 0),
              currentDetails: getWeatherDetails(wData.current?.weather_code || 0),
              hourly: nextHours,
              alert: alert
            });
          }
        } catch (e: any) {
          if (e?.name !== 'AbortError') {
            console.error("ดึงข้อมูลอากาศไม่สำเร็จ:", e);
            if (isMounted) {
              setWeatherInfo({
                location: "ข้อมูลไม่พร้อม",
                currentTemp: 0,
                currentDetails: { icon: '🌤️', text: 'ไม่สามารถดึงข้อมูลได้' },
                hourly: [],
                alert: null
              });
            }
          }
        }
      }, (error) => {
        if (!isMounted) return;
        console.warn("Geolocation access denied or failed:", error);
        setWeatherInfo({
          location: "Bangkok (ค่าเริ่มต้น)",
          currentTemp: 30,
          currentDetails: { icon: '☀️', text: 'ไม่ได้ระบุตำแหน่ง' },
          hourly: [],
          alert: null
        });
      }, { timeout: 10000, maximumAge: 60000 });
    } else {
      if (isMounted) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setWeatherInfo({
          location: "Bangkok (ค่าเริ่มต้น)",
          currentTemp: 30,
          currentDetails: { icon: '☀️', text: 'เบราว์เซอร์ไม่รองรับ GPS' },
          hourly: [],
          alert: null
        });
      }
    }
    return () => { isMounted = false; controller.abort(); };
  }, []);

  return weatherInfo;
}
